import test from 'node:test';
import assert from 'node:assert/strict';
import { createBrowserSessionHandler } from '../lib/browserSession.js';

const cfg = { supabaseUrl: 'https://auth.test', anonKey: 'public-anon' };
const request = (body, headers = {}) => new Request('https://veyrnox.ai/api/auth/session', {
    method: 'POST', headers: { origin: 'https://veyrnox.ai', 'content-type': 'application/json',
        'x-session-request': '1', ...headers }, body: JSON.stringify(body),
});
const session = { access_token: 'access', refresh_token: 'rotated', expires_in: 3600, user: { id: 'user' } };

test('session BFF rejects cross-origin, absent origin, non-JSON and missing custom headers before upstream', async () => {
    const handle = createBrowserSessionHandler(cfg, () => { throw new Error('must not fetch'); });
    for (const headers of [{ origin: 'https://evil.test' }, { origin: '' },
        { 'content-type': 'text/plain' }, { 'x-session-request': '' }, { 'sec-fetch-site': 'cross-site' }]) {
        assert.equal((await handle(request({ action: 'refresh' }, headers))).status, 403);
    }
});

test('establish rotates refresh credentials into a host-only HttpOnly cookie and never returns refresh tokens', async () => {
    let sent;
    const handle = createBrowserSessionHandler(cfg, async (url, init) => {
        sent = { url: String(url), body: JSON.parse(init.body) };
        return Response.json(session);
    });
    const res = await handle(request({ action: 'establish', refresh_token: 'original' }));
    assert.equal(res.status, 200);
    assert.deepEqual(sent.body, { refresh_token: 'original' });
    assert.match(sent.url, /grant_type=refresh_token$/);
    const data = await res.json();
    assert.equal(data.access_token, 'access');
    assert.equal('refresh_token' in data, false);
    assert.match(res.headers.get('set-cookie'), /^__Host-veyrnox_refresh=rotated;/);
    for (const flag of ['HttpOnly', 'Secure', 'SameSite=Strict', 'Path=/']) assert.ok(res.headers.get('set-cookie').includes(flag));
    assert.ok(!res.headers.get('set-cookie').includes('Domain='));
    assert.equal(res.headers.get('cache-control'), 'private, no-store');
});

test('refresh reads only the HttpOnly cookie and logout expires it', async () => {
    let body;
    const handle = createBrowserSessionHandler(cfg, async (_url, init) => {
        body = JSON.parse(init.body); return Response.json(session);
    });
    const refreshed = await handle(request({ action: 'refresh', refresh_token: 'ignored' }, { cookie: '__Host-veyrnox_refresh=cookie-refresh' }));
    assert.equal(refreshed.status, 200);
    assert.deepEqual(body, { refresh_token: 'cookie-refresh' });
    const cleared = await handle(request({ action: 'clear' }));
    assert.match(cleared.headers.get('set-cookie'), /Max-Age=0/);
    assert.equal((await handle(request({ action: 'refresh' }))).status, 401);
});

test('transient upstream failures preserve cookies; definitive invalid refresh expires them', async () => {
    for (const status of [429, 502, 400]) {
        const handle = createBrowserSessionHandler(cfg, async () => Response.json({ error_code: 'refresh_token_not_found', msg: 'private detail' }, { status }));
        const res = await handle(request({ action: 'refresh' }, { cookie: '__Host-veyrnox_refresh=old' }));
        assert.equal(res.status, status);
        assert.equal(Boolean(res.headers.get('set-cookie')), status === 400);
        assert.ok(!(await res.text()).includes('private detail'));
    }
});

test('oversized/invalid actions and ambiguous duplicate cookies fail before upstream', async () => {
    const handle = createBrowserSessionHandler(cfg, () => assert.fail('invalid body reached Auth'));
    for (const body of [{ action: 'establish', refresh_token: 'a'.repeat(5000) }, { action: 'unknown' }]) {
        assert.equal((await handle(request(body))).status, 400);
    }
    const duplicated = await handle(request({ action: 'refresh' }, {
        cookie: '__Host-veyrnox_refresh=one; __Host-veyrnox_refresh=two',
    }));
    assert.equal(duplicated.status, 401);
});

test('Origin comparison honors the actual hostname and port without trusting forwarded headers', async () => {
    const handle = createBrowserSessionHandler(cfg, () => assert.fail('clear does not reach Auth'));
    const local = origin => new Request('http://localhost:3100/api/auth/session', { method: 'POST',
        headers: { origin, 'content-type': 'application/json', 'x-session-request': '1',
            'x-forwarded-host': 'attacker.test' }, body: JSON.stringify({ action: 'clear' }) });
    assert.equal((await handle(local('http://localhost:3100'))).status, 200);
    assert.equal((await handle(local('http://localhost:3000'))).status, 403);
    assert.equal((await handle(local('https://attacker.test'))).status, 403);
});
