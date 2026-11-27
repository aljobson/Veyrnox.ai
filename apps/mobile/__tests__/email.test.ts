import { emailAuthMessage, validateEmailForm } from '../src/lib/auth/emailForm';
import { allowTurnstileNavigation, parseTurnstileMessage, turnstileHtml } from '../src/lib/auth/turnstile';
import { requestEmailCode, resendSignupEmail, signInWithPassword, signUpWithPassword, verifyEmailCode } from '../src/lib/auth/supabaseAuth';
import { readConfirmVerifier } from '../src/lib/auth/confirmStore';
import { OAUTH_BRIDGE_URL } from '../src/lib/config';

jest.mock('expo-crypto', () => ({
    getRandomBytes: (n: number) => new Uint8Array(n).fill(7),
    digestStringAsync: async () => 'ZGlnZXN0',
    CryptoDigestAlgorithm: { SHA256: 'SHA256' },
    CryptoEncoding: { BASE64: 'base64' },
}));
const mockStore = new Map<string, string>();
jest.mock('expo-secure-store', () => ({
    AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 1,
    getItemAsync: async (k: string) => mockStore.get(k) ?? null,
    setItemAsync: async (k: string, v: string) => { mockStore.set(k, v); },
    deleteItemAsync: async (k: string) => { mockStore.delete(k); },
}));

describe('email form', () => {
    test('validates shape and password length only when creating', () => {
        expect(validateEmailForm('nope', 'x', false)).toMatch(/valid email/);
        expect(validateEmailForm('a@b.co', '', false)).toMatch(/password/);
        expect(validateEmailForm('a@b.co', 'short', false)).toBeNull();
        expect(validateEmailForm('a@b.co', 'short', true)).toMatch(/8 characters/);
        expect(validateEmailForm(' a@b.co ', 'longenough', true)).toBeNull();
    });
    test('maps known codes and falls back', () => {
        expect(emailAuthMessage('invalid_credentials')).toMatch(/do not match/);
        expect(emailAuthMessage('???')).toMatch(/Something went wrong/);
    });
});

const BASE = 'https://veyrnox.ai';

describe('turnstile bridge', () => {
    test('accepts only well-formed messages', () => {
        expect(parseTurnstileMessage('{"type":"token","token":"abc"}')).toEqual({ type: 'token', token: 'abc' });
        expect(parseTurnstileMessage('{"type":"error","code":"110200"}')).toEqual({ type: 'error', code: '110200' });
        expect(parseTurnstileMessage('{"type":"expired"}')).toEqual({ type: 'expired' });
        expect(parseTurnstileMessage('{"type":"interactive","on":true}')).toEqual({ type: 'interactive', on: true });
        expect(parseTurnstileMessage('{"type":"interactive"}')).toBeNull();
        expect(parseTurnstileMessage('{"type":"ready"}')).toEqual({ type: 'ready' });
        expect(parseTurnstileMessage('{"type":"token","token":""}')).toBeNull();
        expect(parseTurnstileMessage('{"type":"token"}')).toBeNull();
        expect(parseTurnstileMessage('not json')).toBeNull();
        expect(parseTurnstileMessage('{"type":"evil"}')).toBeNull();
    });
    test('refuses site keys that could break out of the script', () => {
        expect(() => turnstileHtml("x');alert(1);('")).toThrow();
        expect(turnstileHtml('0x4AAAAAAE-nahDRUDwD5HEx')).toContain('sitekey');
    });
    test('navigation stays on Cloudflare', () => {
        expect(allowTurnstileNavigation('about:blank', BASE)).toBe(true);
        expect(allowTurnstileNavigation('about:srcdoc', BASE)).toBe(true);
        expect(allowTurnstileNavigation('https://challenges.cloudflare.com/cdn-cgi/x', BASE)).toBe(true);
        expect(allowTurnstileNavigation('https://evil.example/', BASE)).toBe(false);
        expect(allowTurnstileNavigation('http://challenges.cloudflare.com/', BASE)).toBe(false);
        expect(allowTurnstileNavigation('not a url', BASE)).toBe(false);
        expect(allowTurnstileNavigation('https://veyrnox.ai/', BASE)).toBe(true);
        expect(allowTurnstileNavigation('https://veyrnox.ai/other', BASE)).toBe(false);
    });
});

describe('password grants', () => {
    const fetchMock = jest.fn();
    beforeEach(() => {
        fetchMock.mockReset();
        globalThis.fetch = fetchMock as unknown as typeof fetch;
    });
    const tokens = { access_token: 'a', refresh_token: 'r', expires_in: 3600 };

    test('sign-in sends the captcha token with the credentials', async () => {
        fetchMock.mockResolvedValue(new Response(JSON.stringify(tokens), { status: 200 }));
        await signInWithPassword('a@b.co', 'pw123456', 'cap');
        const [url, init] = fetchMock.mock.calls[0];
        expect(url).toContain('/auth/v1/token?grant_type=password');
        expect(JSON.parse(init.body)).toEqual({ email: 'a@b.co', password: 'pw123456', gotrue_meta_security: { captcha_token: 'cap' } });
    });
    test('sign-up with confirmation on returns no session', async () => {
        fetchMock.mockResolvedValue(new Response(JSON.stringify({ id: 'u', email: 'a@b.co' }), { status: 200 }));
        await expect(signUpWithPassword('a@b.co', 'pw123456', 'cap')).resolves.toBeNull();
        expect(fetchMock.mock.calls[0][0]).toContain('/auth/v1/signup');
    });
    test('the confirmation link returns to the app through the site bridge, with a PKCE challenge', async () => {
        fetchMock.mockResolvedValue(new Response(JSON.stringify({ id: 'u' }), { status: 200 }));
        await signUpWithPassword('a@b.co', 'pw123456', 'cap');
        const [url, init] = fetchMock.mock.calls[0];
        expect(new URL(url).searchParams.get('redirect_to')).toBe(OAUTH_BRIDGE_URL);
        const body = JSON.parse(init.body);
        expect(body.code_challenge).toEqual(expect.any(String));
        expect(body.code_challenge_method).toBe('s256');
        await expect(readConfirmVerifier()).resolves.toEqual(expect.any(String));
    });
    test('a resend keeps the same challenge so the first email still works', async () => {
        fetchMock.mockResolvedValue(new Response(JSON.stringify({ id: 'u' }), { status: 200 }));
        await signUpWithPassword('a@b.co', 'pw123456', 'cap');
        await resendSignupEmail('a@b.co', 'cap2');
        const [first, second] = fetchMock.mock.calls.map((c) => JSON.parse(c[1].body).code_challenge);
        expect(second).toBe(first);
        expect(new URL(fetchMock.mock.calls[1][0]).searchParams.get('redirect_to')).toBe(OAUTH_BRIDGE_URL);
    });
    test('sign-up with autoconfirm returns a session', async () => {
        fetchMock.mockResolvedValue(new Response(JSON.stringify(tokens), { status: 200 }));
        await expect(signUpWithPassword('a@b.co', 'pw123456', 'cap')).resolves.toMatchObject({ accessToken: 'a' });
    });
    test('a rejected captcha is a typed error', async () => {
        fetchMock.mockResolvedValue(new Response(JSON.stringify({ error_code: 'captcha_failed' }), { status: 400 }));
        await expect(signInWithPassword('a@b.co', 'pw', 'bad')).rejects.toMatchObject({ code: 'captcha_failed' });
    });
});

describe('six-digit email grants', () => {
    const fetchMock = jest.fn();
    beforeEach(() => { fetchMock.mockReset(); globalThis.fetch = fetchMock as unknown as typeof fetch; });
    test('requests a code for an existing account with captcha and never creates a user', async () => {
        fetchMock.mockResolvedValue(new Response('{}', { status: 200 }));
        await requestEmailCode('person@example.test', 'proof');
        const [url, init] = fetchMock.mock.calls[0];
        expect(url).toContain('/auth/v1/otp');
        expect(JSON.parse(init.body)).toEqual({ email: 'person@example.test', create_user: false, gotrue_meta_security: { captcha_token: 'proof' } });
    });
    test('verifies the six-digit code through the email grant and returns a normal session', async () => {
        fetchMock.mockResolvedValue(new Response(JSON.stringify({ access_token: 'a', refresh_token: 'r', expires_in: 3600 }), { status: 200 }));
        await expect(verifyEmailCode('person@example.test', '123456')).resolves.toMatchObject({ accessToken: 'a', refreshToken: 'r' });
        const [url, init] = fetchMock.mock.calls[0];
        expect(url).toContain('/auth/v1/token?grant_type=email');
        expect(JSON.parse(init.body)).toEqual({ email: 'person@example.test', token: '123456', type: 'email' });
    });
});
