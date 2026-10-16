import test from 'node:test';
import assert from 'node:assert/strict';
const KEY = 'veyrnox_supabase_session';
const store = new Map();
globalThis.localStorage = { getItem: key => store.get(key) ?? null,
    setItem: (key, value) => store.set(key, value), removeItem: key => store.delete(key) };
process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://auth.test';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon';
const fresh = user => ({ access_token: `${user}-access`, expires_in: 3600, user: { id: user } });
const load = async id => import(`../app/lib/authClient.js?browser-session-test=${id}`);

test('password sign-in waits for HttpOnly persistence and never writes credentials to localStorage', async () => {
    store.clear();
    const auth = await load('password');
    let release;
    globalThis.fetch = async (url, init) => {
        if (String(url) !== '/api/auth/session') return Response.json({ ...fresh('alice'), refresh_token: 'private-refresh' });
        assert.deepEqual(JSON.parse(init.body), { action: 'establish', refresh_token: 'private-refresh' });
        assert.equal(init.credentials, 'same-origin');
        return new Promise(resolve => { release = () => resolve(Response.json(fresh('alice'))); });
    };
    let done = false;
    const pending = auth.signInWithPassword('alice@test.invalid', 'example-password').then(value => { done = true; return value; });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(done, false);
    assert.equal(store.has(KEY), false);
    release();
    await pending;
    assert.equal(auth.getAccessToken(), 'alice-access');
    assert.ok(!store.get(KEY).includes('private-refresh'));
    assert.ok(!store.get(KEY).includes('alice-access'));
    assert.equal(auth.getStoredUserId(), 'alice');
});

test('reload uses token-free display metadata until one shared cookie refresh hydrates memory', async () => {
    store.set(KEY, JSON.stringify({ cookie_session: true, expires_at: 1, user: { id: 'alice' } }));
    const auth = await load('reload');
    assert.equal(auth.getSession(), null);
    assert.equal(auth.getStoredUserId(), 'alice');
    let count = 0;
    globalThis.fetch = async (_url, init) => {
        count += 1;
        assert.deepEqual(JSON.parse(init.body), { action: 'refresh' });
        return Response.json(fresh('alice'));
    };
    assert.deepEqual(await Promise.all([auth.getFreshAccessToken(), auth.getFreshAccessToken()]), ['alice-access', 'alice-access']);
    assert.equal(count, 1);
    assert.equal(auth.getSession().refresh_token, null);
    assert.equal('access_token' in JSON.parse(store.get(KEY)), false);
});

test('cross-tab logout invalidates memory synchronously and does not restore the removed session', async () => {
    const callbacks = new Set();
    globalThis.window = { addEventListener: (_name, cb) => callbacks.add(cb),
        removeEventListener: (_name, cb) => callbacks.delete(cb) };
    const auth = await load('cross-tab');
    auth.adoptSession(fresh('alice'));
    let latest;
    const unsubscribe = auth.onSessionChange(value => { latest = value; });
    globalThis.fetch = () => assert.fail('logout storage event must not rehydrate');
    store.delete(KEY);
    for (const cb of callbacks) cb({ key: KEY, newValue: null });
    assert.equal(auth.getSession(), null);
    assert.equal(latest, null);
    unsubscribe();
    delete globalThis.window;
});

test('multiple subscribers share one cross-tab restore without invalidating its response or broadcasting a loop', async () => {
    const callbacks = new Set();
    globalThis.window = { addEventListener: (_name, cb) => callbacks.add(cb),
        removeEventListener: (_name, cb) => callbacks.delete(cb) };
    const auth = await load('multi-subscriber');
    auth.adoptSession(fresh('alice'));
    const seen = [[], []];
    const off = seen.map(events => auth.onSessionChange(value => events.push(value?.user?.id)));
    assert.equal(callbacks.size, 1);
    const metadata = JSON.stringify({ cookie_session: true, expires_at: 1, user: { id: 'bob' }, revision: 'from-other-tab' });
    store.set(KEY, metadata);
    let calls = 0;
    globalThis.fetch = async () => { calls += 1; return Response.json(fresh('bob')); };
    for (const cb of callbacks) cb({ key: KEY, newValue: metadata });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(auth.getAccessToken(), 'bob-access');
    assert.equal(calls, 1);
    assert.equal(store.get(KEY), metadata, 'refresh does not write a storage event back to the other tab');
    assert.ok(seen.every(events => events.at(-1) === 'bob'));
    off.forEach(unsubscribe => unsubscribe());
    delete globalThis.window;
});

test('signout queues cookie deletion after an outstanding refresh and cannot resurrect its session', async () => {
    store.clear();
    store.set(KEY, JSON.stringify({ cookie_session: true, expires_at: 1, user: { id: 'alice' } }));
    const auth = await load('signout');
    let release;
    const calls = [];
    globalThis.fetch = async (_url, init) => {
        const action = JSON.parse(init.body).action;
        calls.push(action);
        if (action === 'clear') return Response.json({ ok: true });
        return new Promise(resolve => { release = () => resolve(Response.json(fresh('alice'))); });
    };
    const refreshing = auth.getFreshAccessToken();
    await new Promise(resolve => setImmediate(resolve));
    const signingOut = auth.signOut();
    release();
    await refreshing;
    await signingOut;
    assert.equal(auth.getSession(), null);
    assert.equal(store.has(KEY), false);
    assert.deepEqual(calls, ['refresh', 'clear']);
});

test('offline logout survives a new module/reload and only retries cookie deletion', async () => {
    store.clear();
    const auth = await load('offline-logout');
    auth.adoptSession(fresh('alice'));
    globalThis.fetch = async () => { throw new TypeError('offline'); };
    await auth.signOut();
    assert.equal(store.get('veyrnox_session_signed_out'), '1');
    const reloaded = await load('after-offline-logout');
    const actions = [];
    globalThis.fetch = async (_url, init) => {
        actions.push(JSON.parse(init.body).action);
        return Response.json(fresh('alice'));
    };
    assert.equal(await reloaded.getFreshAccessToken(), null);
    assert.equal(reloaded.getStoredUserId(), null);
    assert.deepEqual(actions, ['clear']);
    reloaded.adoptSession(fresh('bob'));
    assert.equal(store.has('veyrnox_session_signed_out'), false, 'an explicit new sign-in permits restore again');
});

test('concurrent sign-ins adopt inside the cookie lock and cannot leave a different cookie account', async () => {
    store.clear();
    const auth = await load('concurrent-signin');
    const cookieAccounts = [];
    globalThis.fetch = async (url, init) => {
        const body = JSON.parse(init.body);
        if (String(url) !== '/api/auth/session') {
            const account = body.email.split('@')[0];
            return Response.json({ ...fresh(account), refresh_token: account });
        }
        cookieAccounts.push(body.refresh_token);
        return Response.json(fresh(body.refresh_token));
    };
    const results = await Promise.allSettled([
        auth.signInWithPassword('alice@test.invalid', 'example-password'),
        auth.signInWithPassword('bob@test.invalid', 'example-password'),
    ]);
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
    assert.equal(results.find(result => result.status === 'rejected').reason.code, 'account_changed');
    assert.deepEqual(cookieAccounts, [auth.getStoredUserId()]);
    assert.equal(auth.getAccessToken(), `${cookieAccounts[0]}-access`);
});

test('blocked metadata storage cannot prevent in-memory sign-in or sign-out', async () => {
    store.clear();
    const auth = await load('blocked-storage');
    const original = globalThis.localStorage;
    globalThis.localStorage = { getItem: () => null,
        setItem: () => { throw new DOMException('blocked', 'SecurityError'); },
        removeItem: () => { throw new DOMException('blocked', 'SecurityError'); } };
    try {
        auth.adoptSession(fresh('alice'));
        assert.equal(auth.getAccessToken(), 'alice-access');
        assert.equal(auth.sessionIsPersisted(), false);
        auth.clearSession();
        assert.equal(auth.getSession(), null);
    } finally { globalThis.localStorage = original; }
});
