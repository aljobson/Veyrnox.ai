import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('data:text/javascript,' + encodeURIComponent(`export async function resolve(s,c,n){return n(s==='next/server'?'next/server.js':s,c)}`));
const { POST } = await import('../app/api/v1/account/export/route.js');
const { GET } = await import('../app/api/v1/account/export/[exportId]/route.js');
const { EXPORT_SECTIONS } = await import('../lib/privacyExport.js');
const auth = '11111111-1111-4111-8111-111111111111';
const saved = { ...process.env }, savedFetch = globalThis.fetch, savedError = console.error;
let calls, results;
test.beforeEach(() => {
    Object.assign(process.env, { PRIVACY_EXPORT_ENABLED: 'true', ACCOUNT_READ_RATE_LIMIT_ENABLED: 'false', SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'test-role' });
    calls = []; results = {}; console.error = () => {};
    globalThis.fetch = async (url, init) => {
        const name = new URL(url).pathname.split('/').pop(); calls.push({ name, args: JSON.parse(init.body) });
        if (results[name] instanceof Error) throw results[name];
        return Response.json(results[name] ?? { ok: true, rows: [], next: null });
    };
});
test.afterEach(() => {
    globalThis.fetch = savedFetch; console.error = savedError;
    for (const key of ['PRIVACY_EXPORT_ENABLED', 'ACCOUNT_READ_RATE_LIMIT_ENABLED', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']) {
        if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key];
    }
});
const req = (query = '', id = auth, aal = '') => new Request(`https://test/api/v1/account/export/${auth}?${query}`, { headers: { 'x-veyrnox-auth-id': id ?? '', 'x-veyrnox-auth-aal': aal } });
const get = (query = 'section=profile', id = auth, exportId = auth, aal = '') => GET(req(query, id, aal), { params: Promise.resolve({ exportId }) });
const post = (id = auth, aal = '') => POST(req('', id, aal));
async function error(response, status, code) {
    assert.equal(response.status, status); assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal((await response.json()).error, code);
}
test('identity is refused before outbound calls, flag or config', async () => {
    for (const id of [null, '', 'bad']) {
        await error(await post(id), 401, 'not_authenticated'); await error(await get('section=profile', id), 401, 'not_authenticated');
    }
    assert.equal(calls.length, 0);
});
test('only exact true enables; missing config is typed', async () => {
    for (const value of [undefined, 'TRUE', 'false']) {
        if (value === undefined) delete process.env.PRIVACY_EXPORT_ENABLED; else process.env.PRIVACY_EXPORT_ENABLED = value;
        await error(await post(), 404, 'not_found'); await error(await get(), 404, 'not_found');
    }
    process.env.PRIVACY_EXPORT_ENABLED = 'true'; delete process.env.SUPABASE_URL;
    await error(await post(), 503, 'gateway_not_configured'); await error(await get(), 503, 'gateway_not_configured');
    assert.equal(calls.length, 0);
});
test('start exposes only metadata and forwards assurance', async () => {
    results.start_privacy_export = { ok: true, export_id: auth, as_of: 'now', expires_at: 'later', resumed: true, cursor_salt: 'secret' };
    const res = await post(auth, 'aal2');
    assert.equal(res.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await res.json(), { export_id: auth, as_of: 'now', expires_at: 'later', resumed: true, sections: EXPORT_SECTIONS });
    assert.equal(calls[0].args.p_aal, 'aal2'); await post(); assert.equal(calls[1].args.p_aal, 'aal1');
});
test('all start refusals and daily Retry-After', async () => {
    for (const [code, status] of Object.entries({ mfa_required: 403, account_restricted: 403, account_not_found: 404, rate_limited: 429, unknown: 502 })) {
        results.start_privacy_export = { ok: false, error: code, retry_after_seconds: 123 };
        const res = await post(); if (status === 429) assert.equal(res.headers.get('retry-after'), '123');
        await error(res, status, code === 'unknown' ? 'export_unavailable' : code);
    }
});
test('page validates composite, opaque and bigint cursors before any call', async () => {
    const bad = ['section=nope', 'section=profile&after=x', 'section=creations&after=2026-10-20T00:00:00Z',
        'section=creations&key=' + auth, 'section=creations&after=bad&key=' + auth,
        'section=creator_follows&after=2026-10-20T00:00:00Z&key=' + auth, 'section=chat_messages',
        'section=chat_messages&thread=' + auth + '&after=9223372036854775808',
        'section=chat_messages&thread=' + auth + '&after=3&key=' + auth,
        'section=watch_progress&after=2026-10-20T00:00:00Z&key=' + auth];
    for (const query of bad) await error(await get(query), 400, 'invalid_request');
    await error(await get('section=profile', auth, 'bad'), 400, 'invalid_request');
    assert.equal(calls.length, 0);
    await get(`section=chat_messages&thread=${auth}&after=9007199254740993`, auth, auth, 'aal2');
    assert.equal(calls[0].args.p_after, '9007199254740993'); assert.equal(calls[0].args.p_aal, 'aal2');
    assert.equal(calls[0].args.p_key, null); assert.equal('p_page_size' in calls[0].args, false);
    await get(`section=blocks&after=2026-10-20T00:00:00Z&key=${'ab'.repeat(32)}`);
    await get(`section=watch_progress&after=${auth}&key=${auth}`);
});
test('page maps each refusal; ledger reason never leaves Worker', async () => {
    for (const [code, status] of Object.entries({ export_not_found: 404, export_expired: 410, mfa_required: 403, account_restricted: 403, invalid_section: 400, unknown: 502 })) {
        results.read_privacy_export_page = { ok: false, error: code };
        await error(await get(), status, code === 'unknown' ? 'export_unavailable' : code);
    }
    results.read_privacy_export_page = { ok: true, rows: [{ id: auth, delta: 4, reason: 'op-note-secret' }], next: null };
    assert.deepEqual(await (await get('section=credit_history')).json(), { rows: [{ id: auth, delta: 4, kind: 'adjustment' }], next: null });
});
test('limiter distinguishes deleted users, temporary throttles, failure and success', async () => {
    process.env.ACCOUNT_READ_RATE_LIMIT_ENABLED = 'true';
    for (const [rate, status, code] of [
        [{ ok: false, code: 'NOT_FOUND' }, 404, 'export_not_found'],
        [{ ok: false, code: 'RATE_LIMITED', retry_after_seconds: 12 }, 429, 'read_throttled'],
        [new Error('private database text'), 503, 'rate_limit_unavailable'],
    ]) {
        results.consume_account_read_request = rate; calls = [];
        const res = await get(); if (status === 429) assert.equal(res.headers.get('retry-after'), '12');
        await error(res, status, code); assert.equal(calls.length, 1);
    }
    results.consume_account_read_request = { ok: true }; calls = [];
    assert.equal((await get()).status, 200);
    assert.deepEqual(calls.map(c => c.name), ['consume_account_read_request', 'read_privacy_export_page']);
});
test('thrown RPCs do not expose text in answers or logs', async () => {
    const logged = []; console.error = (...args) => logged.push(args);
    results.start_privacy_export = results.read_privacy_export_page = new Error('secret database payload');
    await error(await post(), 502, 'export_unavailable'); await error(await get(), 502, 'export_unavailable');
    assert.deepEqual(logged, [['export_unavailable'], ['export_unavailable']]);
});
