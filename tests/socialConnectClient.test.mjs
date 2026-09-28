import test from 'node:test';
import assert from 'node:assert/strict';

// authClient (which gatewayFetch depends on) reads localStorage; provide a
// live, never-expiring session so gatewayFetch never needs a refresh call.
const localStore = new Map();
globalThis.localStorage = {
    getItem: (k) => (localStore.has(k) ? localStore.get(k) : null),
    setItem: (k, v) => localStore.set(k, String(v)),
    removeItem: (k) => localStore.delete(k),
};
localStore.set('veyrnox_supabase_session', JSON.stringify({
    access_token: 'live-token', refresh_token: 'r1', expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: 'user-1' },
}));

const sessionStore = new Map();
globalThis.sessionStorage = {
    getItem: (k) => (sessionStore.has(k) ? sessionStore.get(k) : null),
    setItem: (k, v) => sessionStore.set(k, String(v)),
    removeItem: (k) => sessionStore.delete(k),
};

let assigned = null;
let replaced = null;
globalThis.window = {
    location: {
        href: 'https://veyrnox.ai/social/connect/callback',
        assign: (url) => { assigned = url; },
        replace: (url) => { replaced = url; },
    },
    dispatchEvent: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
};
globalThis.CustomEvent = class CustomEvent { constructor(type, opts) { this.type = type; Object.assign(this, opts); } };

const {
    NETWORKS, connectInstagram, completeInstagramConnect, listSocialAccounts, disconnectSocialAccount,
} = await import('../app/lib/socialConnectClient.js');

const PKCE_KEY = 'veyrnox_social_pkce_verifier';

function stubFetch(handler) {
    const calls = [];
    globalThis.fetch = async (url, init) => {
        calls.push({ url: String(url), init });
        return handler(calls.length, url, init);
    };
    return calls;
}
const okJson = (obj) => new Response(JSON.stringify(obj), { status: 200, headers: { 'content-type': 'application/json' } });

test('NETWORKS lists all five v1 networks with only Instagram live', () => {
    assert.deepEqual(NETWORKS.map((n) => n.key), ['instagram', 'twitter', 'tiktok', 'linkedin', 'youtube']);
    assert.deepEqual(NETWORKS.filter((n) => n.live).map((n) => n.key), ['instagram']);
});

test('listSocialAccounts calls the gateway with a bearer token', async () => {
    const calls = stubFetch(() => okJson({ brand_id: 'b1', accounts: [] }));
    const res = await listSocialAccounts();
    assert.deepEqual(res.accounts, []);
    assert.equal(calls[0].url, '/api/v1/social/accounts');
    assert.equal(calls[0].init.headers.Authorization, 'Bearer live-token');
});

test('connectInstagram stores a PKCE verifier and navigates to the authorize URL', async () => {
    sessionStore.clear(); assigned = null;
    let sentChallenge = null;
    stubFetch((_, url, init) => {
        sentChallenge = JSON.parse(init.body).codeChallenge;
        return okJson({ authorizeUrl: 'https://www.facebook.com/v21.0/dialog/oauth?client_id=1' });
    });
    await connectInstagram();
    assert.equal(assigned, 'https://www.facebook.com/v21.0/dialog/oauth?client_id=1');
    const verifier = sessionStore.get(PKCE_KEY);
    assert.ok(verifier && verifier.length >= 43, 'a verifier was stashed for the callback to prove it holds');
    assert.ok(sentChallenge && sentChallenge !== verifier, 'only the S256 challenge is sent, never the verifier itself');
});

test('completeInstagramConnect returns null when opened without a code (not a real callback)', async () => {
    window.location.href = 'https://veyrnox.ai/social/connect/callback';
    assert.equal(await completeInstagramConnect(), null);
});

test('completeInstagramConnect fails cleanly when this browser never started the flow', async () => {
    sessionStore.clear();
    window.location.href = 'https://veyrnox.ai/social/connect/callback?code=abc&state=xyz';
    const result = await completeInstagramConnect();
    assert.deepEqual(result, { ok: false, code: 'VERIFIER_MISSING' });
});

test('completeInstagramConnect sends the code, state and stashed verifier, then clears it', async () => {
    sessionStore.set(PKCE_KEY, 'stashed-verifier-value-that-is-long-enough');
    window.location.href = 'https://veyrnox.ai/social/connect/callback?code=auth-code&state=signed-state';
    let sentBody = null;
    stubFetch((_, url, init) => {
        sentBody = JSON.parse(init.body);
        return okJson({ ok: true, account: { id: 'acc-1', network: 'instagram', display_name: '@creator' } });
    });
    const result = await completeInstagramConnect();
    assert.equal(result.ok, true);
    assert.equal(result.account.id, 'acc-1');
    assert.deepEqual(sentBody, { code: 'auth-code', state: 'signed-state', codeVerifier: 'stashed-verifier-value-that-is-long-enough' });
    assert.equal(sessionStore.has(PKCE_KEY), false, 'the one-time verifier is not left behind');
});

test('completeInstagramConnect surfaces an expected conflict (no linked account) rather than throwing', async () => {
    sessionStore.set(PKCE_KEY, 'stashed-verifier-value-that-is-long-enough');
    window.location.href = 'https://veyrnox.ai/social/connect/callback?code=auth-code&state=signed-state';
    stubFetch(() => new Response(JSON.stringify({ ok: false, code: 'NO_LINKED_INSTAGRAM_ACCOUNT' }), {
        status: 409, headers: { 'content-type': 'application/json' },
    }));
    const result = await completeInstagramConnect();
    assert.deepEqual(result, { ok: false, code: 'NO_LINKED_INSTAGRAM_ACCOUNT' });
});

test('disconnectSocialAccount calls DELETE on the account path', async () => {
    const calls = stubFetch(() => okJson({ ok: true }));
    const res = await disconnectSocialAccount('acc-1');
    assert.deepEqual(res, { ok: true });
    assert.equal(calls[0].url, '/api/v1/social/accounts/acc-1');
    assert.equal(calls[0].init.method, 'DELETE');
});
