// Audit 2026-10-09, A-03 and A-05: the marketing nav must not show "Log in"
// to a person whose refresh token is live. Audit 2026-10-21 A01: callback
// credentials in a fragment are rejected and cleared, never adopted.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://abcdefgh.supabase.co';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon';
const store = new Map();
globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
};
const { getSession, getStoredSession, completeFromFragment, rejectImplicitCallbackFragment,
    completeOAuthFromCode, oauthCallbackError, adoptSession } = await import('../app/lib/authClient.js');

const KEY = 'veyrnox_supabase_session';
const now = () => Math.floor(Date.now() / 1000);
const strip = (t) => t.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
const read = (f) => strip(readFileSync(new URL(`../${f}`, import.meta.url), 'utf8'));

function fakeWindow(href) {
    const calls = [];
    globalThis.window = {
        location: new URL(href),
        history: { replaceState: (_s, _t, url) => { calls.push(url); globalThis.window.location = new URL(url); } },
    };
    return calls;
}

test('getStoredSession answers while the access token is expired; getSession says null', () => {
    store.set(KEY, JSON.stringify({ access_token: 'old', refresh_token: 'r1', expires_at: now() - 600, user: { id: 'u1', email: 'a@b.test' } }));
    assert.equal(getSession(), null, 'expired for a request');
    assert.equal(getStoredSession()?.user?.email, 'a@b.test', 'still a signed-in person for the nav');
    store.clear();
    assert.equal(getStoredSession(), null);
});

test('the marketing nav reads the stored session and refreshes it on mount', () => {
    const src = read('app/veyrnox/_components/NavAuthButtons.js');
    assert.match(src, /accountLabel\(getStoredSession\(\)\)/, 'who is signed in comes from the stored session');
    assert.doesNotMatch(src, /getSession\(\)/, 'getSession() would say null for the hour after expiry');
    assert.match(src, /useEffect\(\(\) => \{ getFreshAccessToken\(\)\.catch\(\(\) => null\); \}, \[\]\);/, 'a refresh runs on mount');
});

for (const fragment of ['access_token=synthetic-access&refresh_token=synthetic-refresh',
    'refresh_token=synthetic-refresh', 'id_token=synthetic-id', '?access_token=',
    '/refresh_token=synthetic-refresh', '%61ccess_token=synthetic-access',
    'error=access_denied&id_token=synthetic-id']) {
    test(`implicit callback rejects ${fragment.split('=')[0]} without auth or BFF requests`, async () => {
        store.clear();
        let requests = 0;
        globalThis.fetch = async () => { requests += 1; throw new Error('No transport permitted'); };
        const replaced = fakeWindow(`https://veyrnox.test/auth/callback?next=%2Fapp#${fragment}`);
        await assert.rejects(completeFromFragment(), { code: 'implicit_flow_unsupported' });
        assert.equal(requests, 0);
        assert.equal(getSession(), null);
        assert.equal(store.size, 0);
        assert.deepEqual(replaced, ['https://veyrnox.test/auth/callback?next=%2Fapp']);
    });
}

test('implicit callback preserves the signed-in account while scrubbing all fragment credentials', async () => {
    const stored = JSON.stringify({ access_token: 'live', refresh_token: 'r1', expires_at: now() + 3000, user: { id: 'u1' } });
    store.set(KEY, stored);
    globalThis.fetch = async () => assert.fail('must not look up or establish an attacker session');
    fakeWindow('https://veyrnox.test/auth/callback#access_token=other&refresh_token=r2');
    await assert.rejects(completeFromFragment(), { code: 'implicit_flow_unsupported' });
    assert.equal(getSession().access_token, 'live');
    assert.equal(store.get(KEY), stored);
    assert.equal(window.location.hash, '');
});

test('a normal callback is left for the PKCE exchange', async () => {
    const replaced = fakeWindow('https://veyrnox.test/auth/callback?code=abc');
    assert.equal(await completeFromFragment(), null);
    assert.deepEqual(replaced, []);
});

test('fragment credentials are still rejected when browser history cannot be updated', async () => {
    fakeWindow('https://veyrnox.test/auth/callback#refresh_token=synthetic-refresh');
    window.history.replaceState = () => { throw new Error('history blocked'); };
    globalThis.fetch = async () => assert.fail('must not adopt fragment credentials');
    await assert.rejects(completeFromFragment(), { code: 'implicit_flow_unsupported' });
});

test('the callback page rejects and scrubs fragment credentials before provider errors or code exchange', () => {
    const src = read('app/auth/callback/page.js');
    const fragment = src.indexOf('rejectImplicitCallbackFragment()');
    const provider = src.indexOf('oauthCallbackError(href)');
    const code = src.indexOf('completeOAuthFromCode()');
    assert.ok(fragment > 0 && provider > fragment && code > provider);
    assert.match(src.slice(fragment, provider), /fail\(t\('callback\.notStarted'/);
});

for (const href of ['https://veyrnox.test/auth/callback#error=access_denied&refresh_token=synthetic-refresh',
    'https://veyrnox.test/auth/callback?error=server_error#id_token=synthetic-id',
    'https://veyrnox.test/auth/callback?code=synthetic-code#?access_token=synthetic-access']) {
    test('actual callback effect refuses mixed fragment credentials before other branches: ' + href.split('#')[1].split('=')[0], () => {
        const replaced = fakeWindow(href);
        adoptSession({ access_token: 'existing-access', expires_in: 3600, user: { id: 'existing-user' } });
        const metadataBefore = store.get(KEY);
        const source = readFileSync(new URL('../app/auth/callback/page.js', import.meta.url), 'utf8');
        const start = source.indexOf('useEffect(() => {') + 'useEffect(() => {'.length;
        const end = source.indexOf('}, [t, localizedHref]);', start);
        assert.ok(start > 0 && end > start, 'extract the actual shipped callback effect');
        let status, failed;
        globalThis.fetch = async () => assert.fail('callback must not contact auth or the BFF');
        runInNewContext(`(() => {${source.slice(start, end)}})()`, {
            window, URL, rejectImplicitCallbackFragment, completeOAuthFromCode, oauthCallbackError,
            safeAuthReturnPath: () => null, localizedHref: value => value, t: key => key,
            MAGIC_VERIFIER_TTL_MS: 900000,
            setStatus: value => { status = value; }, setFailed: value => { failed = value; },
            console: { error() { assert.fail('implicit credentials are handled before provider logging'); } },
        });
        assert.equal(status, 'callback.notStarted');
        assert.equal(failed, true);
        assert.equal(window.location.hash, '');
        assert.equal(replaced.length, 1);
        assert.equal(getSession().user.id, 'existing-user');
        assert.equal(store.get(KEY), metadataBefore);
    });
}
