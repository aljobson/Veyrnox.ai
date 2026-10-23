import { AUTH_REDIRECT_URL, OAUTH_BRIDGE_URL } from '../src/lib/config';
import { AuthError, authorizeUrl, exchangeAuthCode, refreshSession, signInWithIdToken } from '../src/lib/auth/supabaseAuth';
import { toBase64Url } from '../src/lib/auth/pkce';

jest.mock('expo-crypto', () => ({}));

const tokens = { access_token: 'a', refresh_token: 'r', expires_in: 3600 };

describe('sign-in redirects', () => {
    test('OAuth goes through the site bridge and ends on the app address', () => {
        expect(OAUTH_BRIDGE_URL).toMatch(/^https:\/\/[^/]+\/auth\/mobile$/);
        expect(AUTH_REDIRECT_URL).toBe('ai.veyrnox.app://auth/callback');
    });
});

describe('supabase auth', () => {
    const fetchMock = jest.fn();
    beforeEach(() => {
        fetchMock.mockReset();
        globalThis.fetch = fetchMock as unknown as typeof fetch;
    });

    test('Google authorize url carries PKCE and always asks which account to use', () => {
        const url = new URL(authorizeUrl('google', 'chal', 'ai.veyrnox.app://auth/callback'));
        expect(url.pathname).toBe('/auth/v1/authorize');
        expect(url.searchParams.get('provider')).toBe('google');
        expect(url.searchParams.get('prompt')).toBe('select_account');
        expect(url.searchParams.get('code_challenge')).toBe('chal');
        expect(url.searchParams.get('code_challenge_method')).toBe('s256');
        expect(url.searchParams.get('redirect_to')).toBe('ai.veyrnox.app://auth/callback');
    });

    test('Apple authorize url does not receive Google-only prompt parameters', () => {
        const url = new URL(authorizeUrl('apple', 'chal', 'ai.veyrnox.app://auth/callback'));
        expect(url.searchParams.get('provider')).toBe('apple');
        expect(url.searchParams.has('prompt')).toBe(false);
    });

    test('exchanges a PKCE code for a session with an absolute expiry', async () => {
        fetchMock.mockResolvedValue(new Response(JSON.stringify(tokens), { status: 200 }));
        const session = await exchangeAuthCode('code', 'verifier');
        expect(session).toMatchObject({ accessToken: 'a', refreshToken: 'r' });
        expect(session.expiresAt).toBeGreaterThan(Date.now() + 3_500_000);
        const [url, init] = fetchMock.mock.calls[0];
        expect(url).toContain('grant_type=pkce');
        expect(JSON.parse(init.body)).toEqual({ auth_code: 'code', code_verifier: 'verifier' });
        expect(init.headers.apikey).toMatch(/^sb_publishable_/);
    });

    test('sends the raw nonce with an Apple identity token', async () => {
        fetchMock.mockResolvedValue(new Response(JSON.stringify(tokens), { status: 200 }));
        await signInWithIdToken('apple', 'idt', 'raw-nonce');
        expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ provider: 'apple', id_token: 'idt', nonce: 'raw-nonce' });
    });

    test('rejected grants throw a typed error', async () => {
        fetchMock.mockResolvedValue(new Response(JSON.stringify({ error_code: 'refresh_token_not_found' }), { status: 400 }));
        await expect(refreshSession('old')).rejects.toMatchObject({ status: 400, code: 'refresh_token_not_found' });
    });

    test('a malformed success body is an error, not a session', async () => {
        fetchMock.mockResolvedValue(new Response(JSON.stringify({ access_token: 'a' }), { status: 200 }));
        await expect(refreshSession('r')).rejects.toBeInstanceOf(AuthError);
    });

    test('network failure is status 0', async () => {
        fetchMock.mockRejectedValue(new TypeError('offline'));
        await expect(refreshSession('r')).rejects.toMatchObject({ status: 0, code: 'network' });
    });

    test('base64url strips padding and swaps the unsafe characters', () => {
        expect(toBase64Url('a+b/c==')).toBe('a-b_c');
    });
});

import { passkeySignInOptions, passkeySignInVerify } from '../src/lib/auth/supabaseAuth';

describe('passkey authentication transport', () => {
    test('options carries the single-use captcha and verify adopts a normal token response', async () => {
        const options = { challenge_id: 'challenge', options: { challenge: 'base64' } };
        const fetchMock = jest.fn().mockResolvedValueOnce(new Response(JSON.stringify(options), { status: 200 }))
            .mockResolvedValueOnce(new Response(JSON.stringify(tokens), { status: 200 }));
        globalThis.fetch = fetchMock;
        expect(await passkeySignInOptions('captcha')).toEqual(options);
        expect(fetchMock.mock.calls[0][0]).toContain('/auth/v1/passkeys/authentication/options');
        expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ gotrue_meta_security: { captcha_token: 'captcha' } });
        expect(await passkeySignInVerify('challenge', { id: 'credential' }, 1000)).toEqual({ accessToken: 'a', refreshToken: 'r', expiresAt: 3601000 });
        expect(fetchMock.mock.calls[1][0]).toContain('/auth/v1/passkeys/authentication/verify');
        expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ challenge_id: 'challenge', credential: { id: 'credential' } });
    });
    test('captcha rejection preserves the typed status and code', async () => {
        globalThis.fetch = jest.fn().mockResolvedValue(new Response(JSON.stringify({ error_code: 'captcha_failed' }), { status: 400 }));
        await expect(passkeySignInOptions('bad')).rejects.toEqual(new AuthError(400, 'captcha_failed'));
    });
});
