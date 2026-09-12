import test from 'node:test';
import assert from 'node:assert/strict';

// authClient reads NEXT_PUBLIC_* at call time and talks to localStorage +
// fetch. Provide all three in-process; no browser needed.
process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://abcdefgh.supabase.co';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon';
const store = new Map();
globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
};

const { getFreshAccessToken, getSession } = await import('../app/lib/authClient.js');
const KEY = 'veyrnox_supabase_session';
const now = () => Math.floor(Date.now() / 1000);

function seed(over = {}) {
    store.set(KEY, JSON.stringify({ access_token: 'old', refresh_token: 'r1', expires_at: now() + 3600, user: null, ...over }));
}
function stubRefresh(handler) {
    const calls = [];
    globalThis.fetch = async (url, init) => {
        calls.push({ url: String(url), body: JSON.parse(init.body) });
        return handler(calls.length);
    };
    return calls;
}
const okJson = (obj) => new Response(JSON.stringify(obj), { status: 200, headers: { 'content-type': 'application/json' } });

test('fresh token returned without a network call', async () => {
    seed();
    const calls = stubRefresh(() => { throw new Error('should not fetch'); });
    assert.equal(await getFreshAccessToken(), 'old');
    assert.equal(calls.length, 0);
});

test('near-expiry token is refreshed and persisted', async () => {
    seed({ expires_at: now() + 30 });
    const calls = stubRefresh(() => okJson({ access_token: 'new', refresh_token: 'r2', expires_in: 3600 }));
    assert.equal(await getFreshAccessToken(), 'new');
    assert.equal(calls.length, 1);
    assert.match(calls[0].url, /grant_type=refresh_token$/);
    assert.deepEqual(calls[0].body, { refresh_token: 'r1' });
    assert.equal(getSession().refresh_token, 'r2');
});

test('already-expired token still refreshes (getSession alone would say null)', async () => {
    seed({ expires_at: now() - 600 });
    assert.equal(getSession(), null);
    stubRefresh(() => okJson({ access_token: 'new', refresh_token: 'r2', expires_in: 3600 }));
    assert.equal(await getFreshAccessToken(), 'new');
});

test('concurrent callers share one refresh', async () => {
    seed({ expires_at: now() + 10 });
    const calls = stubRefresh(() => okJson({ access_token: 'new', refresh_token: 'r2', expires_in: 3600 }));
    const [a, b, c] = await Promise.all([getFreshAccessToken(), getFreshAccessToken(), getFreshAccessToken()]);
    assert.deepEqual([a, b, c], ['new', 'new', 'new']);
    assert.equal(calls.length, 1);
});

test('rejected refresh clears the session and resolves null', async () => {
    seed({ expires_at: now() + 10 });
    stubRefresh(() => new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400, headers: { 'content-type': 'application/json' } }));
    assert.equal(await getFreshAccessToken(), null);
    assert.equal(store.has(KEY), false);
});

test('a 429 from the token endpoint keeps the session and the still-valid token', async () => {
    seed({ expires_at: now() + 10 });
    stubRefresh(() => new Response(JSON.stringify({ error: 'over_request_rate_limit' }), { status: 429, headers: { 'content-type': 'application/json' } }));
    assert.equal(await getFreshAccessToken(), 'old');
    assert.equal(store.has(KEY), true);
    assert.equal(getSession().refresh_token, 'r1');
});

test('no refresh token: expired → null, valid → token', async () => {
    seed({ refresh_token: null, expires_at: now() - 600 });
    assert.equal(await getFreshAccessToken(), null);
    seed({ refresh_token: null, expires_at: now() + 10 });
    assert.equal(await getFreshAccessToken(), 'old');
});

test('sign-out during an in-flight refresh does not resurrect the session', async () => {
    seed({ expires_at: now() + 10 });
    let release;
    stubRefresh(() => new Promise((r) => { release = () => r(okJson({ access_token: 'new', refresh_token: 'r2', expires_in: 3600 })); }));
    const pending = getFreshAccessToken();
    await new Promise((r) => setTimeout(r, 0));
    store.delete(KEY); // user signed out meanwhile
    release();
    assert.equal(await pending, null);
    assert.equal(store.has(KEY), false);
});

test('transient 5xx / network failure keeps a still-valid session', async () => {
    seed({ expires_at: now() + 30 });
    stubRefresh(() => new Response('bad gateway', { status: 502 }));
    assert.equal(await getFreshAccessToken(), 'old');
    assert.equal(getSession().access_token, 'old');
    stubRefresh(() => { throw new TypeError('fetch failed'); });
    assert.equal(await getFreshAccessToken(), 'old');
    // But an already-expired token with a failed refresh is unusable.
    seed({ expires_at: now() - 600 });
    assert.equal(await getFreshAccessToken(), null);
    assert.equal(store.has(KEY), true, 'session kept for the next retry');
});
