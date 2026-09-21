import test from 'node:test';
import assert from 'node:assert/strict';

// ADR-0026: once Supabase Attack Protection is on, these three calls are
// rejected without a CAPTCHA token. The token has to reach the body in the
// field GoTrue reads, and must not appear when there is none — an empty
// gotrue_meta_security would be sent on every request of a build without a
// Turnstile key.
process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://abcdefgh.supabase.co';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon';
const store = new Map();
globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
};

const { signInWithPassword, signUp, sendMagicLink } = await import('../app/lib/authClient.js');

function capture(response = {}) {
    const calls = [];
    globalThis.fetch = async (url, init) => {
        calls.push({ url: String(url), body: JSON.parse(init.body) });
        return new Response(JSON.stringify(response), { status: 200, headers: { 'content-type': 'application/json' } });
    };
    return calls;
}

const session = { access_token: 'a', refresh_token: 'r', expires_in: 3600 };

test('each gated call carries the token where Supabase reads it', async () => {
    let calls = capture(session);
    await signInWithPassword('a@b.co', 'password1', 'tok-1');
    assert.match(calls[0].url, /grant_type=password$/);
    assert.deepEqual(calls[0].body.gotrue_meta_security, { captcha_token: 'tok-1' });

    calls = capture({});
    await signUp('a@b.co', 'password1', 'tok-2');
    assert.match(calls[0].url, /\/auth\/v1\/signup$/);
    assert.deepEqual(calls[0].body.gotrue_meta_security, { captcha_token: 'tok-2' });

    calls = capture({});
    await sendMagicLink('a@b.co', 'tok-3');
    assert.match(calls[0].url, /\/auth\/v1\/otp$/);
    assert.deepEqual(calls[0].body.gotrue_meta_security, { captcha_token: 'tok-3' });
});

test('without a token the body is exactly what it was before', async () => {
    let calls = capture(session);
    await signInWithPassword('a@b.co', 'password1');
    assert.deepEqual(calls[0].body, { email: 'a@b.co', password: 'password1' });

    calls = capture({});
    await signUp('a@b.co', 'password1');
    assert.deepEqual(calls[0].body, { email: 'a@b.co', password: 'password1' });

    calls = capture({});
    await sendMagicLink('a@b.co');
    assert.deepEqual(calls[0].body, { email: 'a@b.co', create_user: true });
});
