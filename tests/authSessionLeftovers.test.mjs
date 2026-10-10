// Audit 2026-10-09, A-03 and A-05: the marketing nav must not show "Log in"
// to a person whose refresh token is live, and the callback page must take
// tokens out of a URL fragment and clear them.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://abcdefgh.supabase.co';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon';
const store = new Map();
globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
};
const { getSession, getStoredSession, completeFromFragment } = await import('../app/lib/authClient.js');

const KEY = 'veyrnox_supabase_session';
const now = () => Math.floor(Date.now() / 1000);
const jwt = (claims) => `h.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.s`;
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

test('completeFromFragment: tokens in the fragment become the session, the user is fetched, and the fragment is cleared', async () => {
    store.clear();
    const replaced = fakeWindow('https://veyrnox.test/auth/callback#access_token=' + jwt({ email: 'new@b.test' }) + '&refresh_token=r9&expires_in=3600&token_type=bearer&type=signup');
    const fetched = [];
    globalThis.fetch = async (url, init) => {
        fetched.push({ url: String(url), auth: init?.headers?.Authorization });
        return Response.json({ id: 'u9', email: 'new@b.test' });
    };
    const s = await completeFromFragment();
    assert.equal(s.refresh_token, 'r9');
    assert.ok(s.expires_at >= now() + 3590 && s.expires_at <= now() + 3600, 'expiry from expires_in');
    assert.deepEqual(s.user, { id: 'u9', email: 'new@b.test' });
    assert.equal(fetched.length, 1);
    assert.match(fetched[0].url, /\/auth\/v1\/user$/);
    assert.equal(fetched[0].auth, `Bearer ${s.access_token}`);
    assert.deepEqual(replaced, ['https://veyrnox.test/auth/callback'], 'the fragment is gone from the address bar');
    assert.equal(JSON.parse(store.get(KEY)).refresh_token, 'r9', 'persisted like any sign-in');
});

test('completeFromFragment: nothing to take, a live session, or a user lookup that fails', async () => {
    store.clear();
    let replaced = fakeWindow('https://veyrnox.test/auth/callback?code=abc');
    assert.equal(await completeFromFragment(), null, 'no fragment tokens: not this flow');
    assert.deepEqual(replaced, [], 'and nothing to clear');

    // A still-valid session is kept; the fragment is still cleared.
    store.set(KEY, JSON.stringify({ access_token: 'live', refresh_token: 'r1', expires_at: now() + 3000, user: { id: 'u1' } }));
    replaced = fakeWindow('https://veyrnox.test/auth/callback#access_token=other&refresh_token=r2');
    const kept = await completeFromFragment();
    assert.equal(kept.access_token, 'live');
    assert.deepEqual(replaced, ['https://veyrnox.test/auth/callback']);

    // The user lookup failing leaves user null; the tokens are still adopted.
    store.clear();
    fakeWindow('https://veyrnox.test/auth/callback#access_token=' + jwt({ email: 'x@b.test' }) + '&refresh_token=r3&expires_at=' + (now() + 1200));
    globalThis.fetch = async () => { throw new Error('offline'); };
    const s = await completeFromFragment();
    assert.equal(s.user, null);
    assert.equal(s.expires_at, now() + 1200, 'expires_at wins when given');
    assert.equal(s.refresh_token, 'r3');
});

test('the callback page takes the fragment path before it looks for a code', () => {
    const src = read('app/auth/callback/page.js');
    const fragment = src.indexOf('completeFromFragment()');
    const code = src.indexOf('completeOAuthFromCode()');
    assert.ok(fragment > 0 && code > fragment, 'fragment first, then the PKCE code');
    assert.match(src, /has\("access_token"\)/);
});
