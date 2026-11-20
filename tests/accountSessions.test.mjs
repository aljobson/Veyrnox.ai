import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describeSessionDevice } from '../lib/sessionDeviceLabel.js';
import { DELETE, GET } from '../app/api/v1/account/sessions/route.js';

const ID = '11111111-1111-4111-8111-111111111111';
const SID = '22222222-2222-4222-8222-222222222222';
const hdr = (extra = {}) => ({ 'x-veyrnox-auth-id': ID, ...extra });

test('labels browsers and apps without exposing the raw user agent', () => {
    const chrome = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0 Safari/537.36';
    assert.deepEqual(describeSessionDevice(chrome), { kind: 'browser', browser: 'Chrome', system: 'macOS' });
    assert.equal(describeSessionDevice('Veyrnox/60 CFNetwork/1494 Darwin/23.0').kind, 'app_ios');
    assert.equal(describeSessionDevice('okhttp/4.12.0').kind, 'app_android');
    assert.deepEqual(describeSessionDevice(''), { kind: 'unknown', browser: null, system: null });
    assert.equal(describeSessionDevice(null).kind, 'unknown');
});

test('both verbs refuse a request with no verified identity', async () => {
    assert.equal((await GET(new Request('http://x/api/v1/account/sessions'))).status, 401);
    assert.equal((await DELETE(new Request('http://x/api/v1/account/sessions', { method: 'DELETE' }))).status, 401);
});

test('DELETE refuses cross-site requests and bad bodies before touching the database', async () => {
    const mk = (headers, body) => new Request('http://x/api/v1/account/sessions', { method: 'DELETE', headers: hdr(headers), body });
    assert.equal((await DELETE(mk({ origin: 'http://evil' }, '{}'))).status, 403);
    assert.equal((await DELETE(mk({ 'sec-fetch-site': 'cross-site' }, '{}'))).status, 403);
    process.env.SUPABASE_URL = 'http://127.0.0.1:1';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test';
    assert.equal((await DELETE(mk({}, 'nope'))).status, 400);
    const bad = await DELETE(mk({}, JSON.stringify({ id: "x' OR 1=1" })));
    assert.equal(bad.status, 400);
    assert.equal((await bad.json()).error, 'id_invalid');
});

test('GET maps rows to labels, drops the user agent and answers 503 when the RPC is missing', async () => {
    process.env.SUPABASE_URL = 'http://127.0.0.1:1';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test';
    const real = globalThis.fetch;
    try {
        globalThis.fetch = async (url, init) => {
            assert.match(String(url), /rpc\/list_account_sessions$/);
            assert.equal(JSON.parse(init.body).p_auth_id, ID);
            return Response.json([{ id: SID, user_agent: 'okhttp/4', created_at: '2026-11-01T10:00:00', last_used: '2026-11-19T10:00:00' }, { id: 'bad' }]);
        };
        const res = await GET(new Request('http://x/api/v1/account/sessions', { headers: hdr() }));
        const body = await res.json();
        assert.equal(res.headers.get('cache-control'), 'no-store');
        assert.equal(body.sessions.length, 1);
        assert.equal(body.sessions[0].device.kind, 'app_android');
        assert.equal(JSON.stringify(body).includes('okhttp'), false);
        assert.equal(body.sessions[0].last_used, '2026-11-19T10:00:00.000Z');
        globalThis.fetch = async () => Response.json({ code: 'PGRST202' }, { status: 404 });
        assert.equal((await GET(new Request('http://x/api/v1/account/sessions', { headers: hdr() }))).status, 503);
    } finally { globalThis.fetch = real; }
});

test('the account page keeps both bulk buttons and mounts the per-device list', () => {
    const page = readFileSync(new URL('../app/veyrnox/app/account/page.js', import.meta.url), 'utf8');
    assert.match(page, /account-sign-out-others/);
    assert.match(page, /signOutEverywhere/);
    assert.match(page, /<DevicesPanel /);
});

test('the migration is service-role only with a locked search path', () => {
    const sql = readFileSync(new URL('../packages/db/schema/supabase/0565_account_sessions.sql', import.meta.url), 'utf8');
    assert.equal((sql.match(/SECURITY DEFINER SET search_path=''/g) || []).length, 2);
    assert.match(sql, /REVOKE ALL ON FUNCTION public\.list_account_sessions\(TEXT\) FROM PUBLIC,anon,authenticated/);
    assert.match(sql, /REVOKE ALL ON FUNCTION public\.revoke_account_session\(TEXT, TEXT\) FROM PUBLIC,anon,authenticated/);
    assert.match(sql, /WHERE id = p_session_id::uuid AND user_id = p_auth_id::uuid/);
    assert.equal(/\bip\b/i.test(sql.replace(/--.*$/gm, '')), false);
});
