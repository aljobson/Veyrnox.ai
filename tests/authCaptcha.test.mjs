import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// With Supabase CAPTCHA on, GoTrue rejects /signup, /token?grant_type=password
// and /otp unless the body carries gotrue_meta_security.captcha_token. A call
// that drops the token breaks that auth path for everyone (ADR-0026).

process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://abcdefgh.supabase.co';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon';
const store = new Map();
globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
};
globalThis.window = { dispatchEvent() {}, location: { origin: 'https://veyrnox.test' } };
globalThis.sessionStorage = globalThis.localStorage;
globalThis.CustomEvent = class { constructor(t, i) { this.type = t; this.detail = i?.detail; } };

const { signUp, signInWithPassword, sendMagicLink } = await import('../app/lib/authClient.js');

function capture() {
    const calls = [];
    globalThis.fetch = async (url, init) => {
        calls.push({ path: new URL(String(url)).pathname + new URL(String(url)).search, body: JSON.parse(init.body) });
        return new Response(JSON.stringify({ access_token: 'a', refresh_token: 'r', expires_in: 3600 }), { status: 200 });
    };
    return calls;
}

const CASES = [
    ['/auth/v1/signup', (t) => signUp('a@b.co', 'password1', t)],
    ['/auth/v1/token?grant_type=password', (t) => signInWithPassword('a@b.co', 'password1', t)],
    ['/auth/v1/otp?redirect_to=https%3A%2F%2Fveyrnox.test%2Fauth%2Fcallback', (t) => sendMagicLink('a@b.co', t)],
];

for (const [path, call] of CASES) {
    test(`${path} carries the captcha token when there is one`, async () => {
        const calls = capture();
        await call('tok-123');
        assert.equal(calls[0].path, path);
        assert.deepEqual(calls[0].body.gotrue_meta_security, { captcha_token: 'tok-123' });
    });

    test(`${path} sends no captcha field when there is no token`, async () => {
        // Site key empty = today's behaviour, byte for byte.
        const calls = capture();
        await call(undefined);
        assert.ok(!('gotrue_meta_security' in calls[0].body));
    });
}

test('AuthGate passes the widget token to every email auth call', () => {
    const src = readFileSync(new URL('../components/AuthGate.jsx', import.meta.url), 'utf8');
    assert.match(src, /signUp\(email, password, captcha\)/);
    assert.match(src, /signInWithPassword\(email, password, captcha\)/);
    assert.match(src, /sendMagicLink\(email, captcha\)/);
});

test('the site key is a public Turnstile site key', async () => {
    // Public by design; empty is the off switch. Turnstile secret keys also
    // start with 0x, so this cannot tell the two apart. It only catches a
    // wrong kind of value; keeping the secret out is a review job.
    process.env.APP_ENV = 'production';
    const { default: cfg } = await import('../next.config.mjs');
    const key = cfg.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
    assert.equal(typeof key, 'string');
    assert.ok(key === '' || /^0x[0-9A-Za-z_-]+$/.test(key), 'site keys start with 0x');
});
