import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://auth.test';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon';
const store = new Map();
globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    key: (i) => [...store.keys()][i],
    get length() { return store.size; },
};

const { signOut } = await import('../app/lib/authClient.js');
const KEY = 'veyrnox_supabase_session';
const now = () => Math.floor(Date.now() / 1000);
const seed = (over = {}) => store.set(KEY, JSON.stringify({
    access_token: 'stored', refresh_token: 'r1', expires_at: now() + 3600, user: { id: 'user-1' }, ...over,
}));

/** Record every request; `refresh` and `logout` decide the answers. */
function stub({ refresh, logout } = {}) {
    const calls = [];
    globalThis.fetch = async (url, init) => {
        const u = new URL(url);
        const call = {
            path: u.pathname,
            scope: u.searchParams.get('scope'),
            grant: u.searchParams.get('grant_type'),
            bearer: init.headers.Authorization || null,
            signedInLocally: store.has(KEY),
        };
        calls.push(call);
        if (call.path === '/auth/v1/token') return refresh ? refresh() : assert.fail('unexpected refresh');
        if (call.path === '/auth/v1/logout') return logout ? logout() : new Response(null, { status: 204 });
        return assert.fail(`unexpected request to ${call.path}`);
    };
    return calls;
}
const refreshed = () => Response.json({ access_token: 'fresh', refresh_token: 'r2', expires_in: 3600, user: { id: 'user-1' } });

test('a current access token revokes this device\'s session without a refresh', async () => {
    seed();
    const calls = stub();
    await signOut();
    assert.deepEqual(calls.map((c) => c.path), ['/auth/v1/logout']);
    assert.equal(calls[0].bearer, 'Bearer stored');
    assert.equal(calls[0].scope, 'local', 'the dialog says "this device"; other devices stay signed in');
    assert.equal(calls[0].signedInLocally, false, 'local state is cleared before the request goes out');
    assert.equal(store.has(KEY), false);
});

test('an expired access token is refreshed first, so the revocation is accepted', async () => {
    seed({ expires_at: now() - 7200 });
    const calls = stub({ refresh: refreshed });
    await signOut();
    assert.deepEqual(calls.map((c) => c.path), ['/auth/v1/token', '/auth/v1/logout']);
    assert.equal(calls[0].grant, 'refresh_token');
    assert.equal(calls[1].bearer, 'Bearer fresh', 'the expired token would have been answered 401');
    assert.equal(calls[1].scope, 'local');
    assert.equal(store.has(KEY), false, 'the refreshed session is not kept');
});

test('a refresh Supabase rejects leaves nothing to revoke and still signs out here', async () => {
    seed({ expires_at: now() - 7200 });
    const calls = stub({ refresh: () => Response.json({ error: 'invalid_grant' }, { status: 400 }) });
    await signOut();
    assert.deepEqual(calls.map((c) => c.path), ['/auth/v1/token']);
    assert.equal(store.has(KEY), false);
});

test('a refresh that cannot be reached still signs out here', async () => {
    seed({ expires_at: now() - 7200 });
    const calls = stub({ refresh: () => { throw new TypeError('fetch failed'); } });
    await signOut();
    assert.deepEqual(calls.map((c) => c.path), ['/auth/v1/token'], 'no usable token to send');
    assert.equal(store.has(KEY), false);
});

test('a failed revocation never leaves the browser signed in', async () => {
    seed();
    stub({ logout: () => { throw new TypeError('fetch failed'); } });
    await signOut();
    assert.equal(store.has(KEY), false);
    seed();
    stub({ logout: () => new Response('{}', { status: 503 }) });
    await signOut();
    assert.equal(store.has(KEY), false);
});

test('signed out already: nothing is sent', async () => {
    store.delete(KEY);
    const calls = stub();
    await signOut();
    assert.equal(calls.length, 0);
});

test('the confirmation says what the request does', () => {
    // scope=local ends this session only. "Sign out everywhere" on
    // /app/account is the one that ends the others (scope=global).
    const nav = readFileSync(new URL('../app/veyrnox/_components/NavAuthButtons.js', import.meta.url), 'utf8');
    assert.match(nav, /This ends your session on this device\./);
    const account = readFileSync(new URL('../app/lib/accountSecurity.js', import.meta.url), 'utf8');
    assert.match(account, /\['others', 'global'\]/);
});
