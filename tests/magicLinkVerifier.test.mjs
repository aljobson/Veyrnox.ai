import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// The emailed link opens in a new tab. A tab has its own sessionStorage and
// shares localStorage with the rest of the browser, so each "tab" below gets a
// fresh sessionStorage and the one localStorage.
process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://auth.test';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon';
const storage = () => {
    const m = new Map();
    return {
        getItem: (k) => (m.has(k) ? m.get(k) : null),
        setItem: (k, v) => m.set(k, String(v)),
        removeItem: (k) => m.delete(k),
        key: (i) => [...m.keys()][i],
        get length() { return m.size; },
        keys: () => [...m.keys()],
    };
};
globalThis.localStorage = storage();
function openTab(href) {
    globalThis.sessionStorage = storage();
    globalThis.window = { location: { origin: 'https://veyrnox.test', href, assign(url) { this.assigned = url; } } };
}
const visit = (href) => { globalThis.window.location.href = href; };

const { sendMagicLink, signInWithOAuth, completeOAuthFromCode, clearSession, getSession } = await import('../app/lib/authClient.js');

const MAGIC_KEY = 'veyrnox_pkce_magic_verifier';
const OAUTH_KEY = 'veyrnox_pkce_verifier';
const CALLBACK = 'https://veyrnox.test/auth/callback?code=one-time-code';
const sha256 = async (text) => Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))).toString('base64url');

/** Ask for a link and return the challenge Supabase was given. */
async function requestLink() {
    let challenge;
    globalThis.fetch = async (url, init) => {
        assert.equal(new URL(url).pathname, '/auth/v1/otp');
        challenge = JSON.parse(init.body).code_challenge;
        return Response.json({});
    };
    await sendMagicLink('user@test.invalid');
    return challenge;
}
/** Answer the code exchange and record what it was sent. */
function stubExchange() {
    const calls = [];
    globalThis.fetch = async (url, init) => {
        const u = new URL(url);
        assert.equal(u.pathname, '/auth/v1/token');
        assert.equal(u.searchParams.get('grant_type'), 'pkce');
        calls.push(JSON.parse(init.body));
        return Response.json({ access_token: 'token', refresh_token: 'refresh', expires_in: 3600, user: { id: 'user-1' } });
    };
    return calls;
}
const noRequest = () => { globalThis.fetch = () => assert.fail('nothing should have been sent'); };

test.afterEach(() => { clearSession(); localStorage.removeItem(MAGIC_KEY); });

test('a magic link opened in a new tab signs in with the verifier this browser kept', async () => {
    openTab('https://veyrnox.test/');
    const challenge = await requestLink();
    assert.deepEqual(sessionStorage.keys(), [], 'a per-tab copy is no use to the tab the email opens');
    assert.ok(localStorage.getItem(MAGIC_KEY), 'kept where the new tab can read it');

    openTab(CALLBACK);
    const calls = stubExchange();
    const session = await completeOAuthFromCode();
    assert.equal(session.user.id, 'user-1');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].auth_code, 'one-time-code');
    assert.equal(await sha256(calls[0].code_verifier), challenge);
    assert.equal(localStorage.getItem(MAGIC_KEY), null, 'single use');
});

test('the kept verifier is good for 15 minutes and ignored after that', async (t) => {
    t.mock.timers.enable({ apis: ['Date'], now: Date.now() });
    openTab('https://veyrnox.test/');
    await requestLink();
    t.mock.timers.tick(14 * 60 * 1000);
    openTab(CALLBACK);
    stubExchange();
    assert.ok(await completeOAuthFromCode(), 'still valid at 14 minutes');
    clearSession();

    openTab('https://veyrnox.test/');
    await requestLink();
    t.mock.timers.tick(16 * 60 * 1000);
    openTab(CALLBACK);
    noRequest();
    assert.equal(await completeOAuthFromCode(), null);
    assert.equal(localStorage.getItem(MAGIC_KEY), null, 'an expired verifier is removed, not left behind');
});

test('a failed exchange still uses the verifier up', async () => {
    // A verifier left by an abandoned request is only ever sent with the code
    // on the callback URL; Supabase refuses a pair that does not belong together.
    openTab('https://veyrnox.test/');
    await requestLink();
    openTab('https://veyrnox.test/auth/callback?code=someone-elses-code');
    globalThis.fetch = async () => Response.json({ error: 'invalid_grant' }, { status: 400 });
    await assert.rejects(completeOAuthFromCode(), { status: 400 });
    assert.equal(getSession(), null);
    assert.equal(localStorage.getItem(MAGIC_KEY), null);
});

test('a callback this browser never asked for is refused without a request', async () => {
    openTab(CALLBACK);
    noRequest();
    assert.equal(await completeOAuthFromCode(), null);
    localStorage.setItem(MAGIC_KEY, '{not json');
    assert.equal(await completeOAuthFromCode(), null);
});

test('OAuth keeps its verifier in the tab that started it', async () => {
    openTab('https://veyrnox.test/');
    await signInWithOAuth('google');
    const challenge = new URL(window.location.assigned).searchParams.get('code_challenge');
    assert.ok(sessionStorage.getItem(OAUTH_KEY));
    assert.equal(localStorage.getItem(MAGIC_KEY), null, 'the provider redirect never leaves the tab');

    const startedIn = { sessionStorage: globalThis.sessionStorage, window: globalThis.window };
    openTab(CALLBACK);
    noRequest();
    assert.equal(await completeOAuthFromCode(), null, 'another tab cannot finish it');

    Object.assign(globalThis, startedIn);
    visit(CALLBACK);
    const calls = stubExchange();
    assert.ok(await completeOAuthFromCode());
    assert.equal(await sha256(calls[0].code_verifier), challenge);
    assert.equal(sessionStorage.getItem(OAUTH_KEY), null);
});

test('asking for a link after an abandoned OAuth start uses the link\'s verifier', async () => {
    openTab('https://veyrnox.test/');
    await signInWithOAuth('google');
    const challenge = await requestLink();
    visit(CALLBACK); // the link pasted into the same tab
    const calls = stubExchange();
    assert.ok(await completeOAuthFromCode());
    assert.equal(await sha256(calls[0].code_verifier), challenge);
});

test('the callback page says what to do when the link was opened elsewhere or too late', () => {
    const page = readFileSync(new URL('../app/auth/callback/page.js', import.meta.url), 'utf8');
    assert.match(page, /was not started in this browser, or its link is more than \$\{Math\.round\(MAGIC_VERIFIER_TTL_MS \/ 60000\)\} minutes old/);
    assert.match(page, /fail\(NOT_STARTED_HERE\)/);
    assert.doesNotMatch(page, /different browser or tab/, 'a new tab is how an emailed link normally opens');
});
