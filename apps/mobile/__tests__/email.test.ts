import { emailAuthMessage, validateEmailForm } from '../src/lib/auth/emailForm';
import { allowTurnstileNavigation, parseTurnstileMessage, turnstileHtml } from '../src/lib/auth/turnstile';
import { signInWithPassword, signUpWithPassword } from '../src/lib/auth/supabaseAuth';

jest.mock('expo-crypto', () => ({}));

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
    test('sign-up with autoconfirm returns a session', async () => {
        fetchMock.mockResolvedValue(new Response(JSON.stringify(tokens), { status: 200 }));
        await expect(signUpWithPassword('a@b.co', 'pw123456', 'cap')).resolves.toMatchObject({ accessToken: 'a' });
    });
    test('a rejected captcha is a typed error', async () => {
        fetchMock.mockResolvedValue(new Response(JSON.stringify({ error_code: 'captcha_failed' }), { status: 400 }));
        await expect(signInWithPassword('a@b.co', 'pw', 'bad')).rejects.toMatchObject({ code: 'captcha_failed' });
    });
});
