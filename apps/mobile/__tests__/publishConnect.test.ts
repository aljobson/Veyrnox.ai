import { ApiError, type ApiClient } from '../src/lib/api';
import {
    CONNECT_NETWORKS,
    RETURN_URL,
    allowedAuthorizeUrl,
    connectErrorKey,
    parseReturn,
    runConnect,
    type AuthSession,
} from '../src/lib/publishConnect';

const AUTH = 'https://provider.example/oauth/authorize?client_id=abc&state=SIGNED.STATE_1&code_challenge=xyz';
const apiWith = (impl: (path: string, init?: RequestInit) => unknown) => {
    const request = jest.fn(async (p: string, i?: RequestInit) => {
        const r = impl(p, i);
        if (r instanceof Error) throw r;
        return r;
    });
    return { api: { request } as unknown as ApiClient, request };
};
const body = (r: jest.Mock, i: number) => JSON.parse(String((r.mock.calls[i][1] as RequestInit).body));

describe('networks and the return address', () => {
    test('offers the four released networks, in that order', () => {
        expect(CONNECT_NETWORKS.map((n) => n.key)).toEqual(['youtube', 'linkedin', 'twitter', 'tiktok']);
    });
    test('the return address is the app\'s fixed scheme', () => {
        expect(RETURN_URL).toBe('ai.veyrnox.app://social/callback');
    });
});

describe('allowedAuthorizeUrl', () => {
    test('https only; anything else is refused', () => {
        expect(allowedAuthorizeUrl(AUTH, false)).toBe(AUTH);
        for (const bad of ['http://provider.example/x', 'javascript:alert(1)', 'ai.veyrnox.app://x', 'file:///etc/passwd', 'not a url', '', null, 7]) {
            expect(allowedAuthorizeUrl(bad, false)).toBeNull();
        }
    });
    test('plain http is allowed for localhost only in a dev build', () => {
        expect(allowedAuthorizeUrl('http://localhost:8799/p?state=a', true)).toBe('http://localhost:8799/p?state=a');
        expect(allowedAuthorizeUrl('http://localhost:8799/p?state=a', false)).toBeNull();
        expect(allowedAuthorizeUrl('http://evil.example/p', true)).toBeNull();
        expect(allowedAuthorizeUrl('http://localhost.evil.example/p', true)).toBeNull();
    });
});

describe('parseReturn', () => {
    const ok = (q: string) => `${RETURN_URL}?${q}`;
    test('a code and a matching state is a code', () => {
        expect(parseReturn(ok('network=twitter&code=C0DE&state=SIGNED.STATE_1'), 'twitter', AUTH)).toEqual({ kind: 'code', code: 'C0DE', state: 'SIGNED.STATE_1' });
    });
    test('an error word is an error, with only the safe words kept', () => {
        expect(parseReturn(ok('network=twitter&error=access_denied'), 'twitter', AUTH)).toEqual({ kind: 'error', error: 'access_denied' });
        expect(parseReturn(ok('network=twitter&error=weird%20<b>text'), 'twitter', AUTH)).toEqual({ kind: 'error', error: 'invalid_request' });
    });
    test('a different network, a different state, a missing state, or another address is invalid', () => {
        expect(parseReturn(ok('network=youtube&code=C&state=SIGNED.STATE_1'), 'twitter', AUTH).kind).toBe('invalid');
        expect(parseReturn(ok('network=twitter&code=C&state=OTHER'), 'twitter', AUTH).kind).toBe('invalid');
        expect(parseReturn(ok('network=twitter&code=C'), 'twitter', AUTH).kind).toBe('invalid');
        expect(parseReturn('https://veyrnox.ai/social/callback?network=twitter&code=C&state=SIGNED.STATE_1', 'twitter', AUTH).kind).toBe('invalid');
        expect(parseReturn('ai.veyrnox.app://auth/callback?code=C&state=SIGNED.STATE_1', 'twitter', AUTH).kind).toBe('invalid');
        expect(parseReturn('garbage', 'twitter', AUTH).kind).toBe('invalid');
    });
    test('a code that is empty, too long or not printable is invalid', () => {
        expect(parseReturn(ok('network=twitter&code=&state=SIGNED.STATE_1'), 'twitter', AUTH).kind).toBe('invalid');
        expect(parseReturn(ok(`network=twitter&code=${'a'.repeat(2049)}&state=SIGNED.STATE_1`), 'twitter', AUTH).kind).toBe('invalid');
        expect(parseReturn(ok('network=twitter&code=a%00b&state=SIGNED.STATE_1'), 'twitter', AUTH).kind).toBe('invalid');
    });
});

describe('runConnect', () => {
    const pkce = { verifier: 'v'.repeat(64), challenge: 'c'.repeat(43) };
    const account = { id: 'acc-9', network: 'twitter', display_name: 'Studio', avatar_url: null, status: 'active' };
    const openOk: AuthSession = async (_u, r) => ({ type: 'success', url: `${r}?network=twitter&code=CODE1&state=SIGNED.STATE_1` });

    test('asks for the authorize link with the challenge and client mobile, opens it, then finishes with the verifier', async () => {
        const { api, request } = apiWith((p) => (p.endsWith('/connect') ? { authorizeUrl: AUTH } : { ok: true, account }));
        const open = jest.fn(openOk);
        const out = await runConnect(api, 'twitter', { open, pkce: async () => pkce, dev: false });
        expect(out).toEqual({ kind: 'connected', account: { id: 'acc-9', network: 'twitter', displayName: 'Studio' } });
        expect(request.mock.calls[0][0]).toBe('/api/v1/social/accounts/twitter/connect');
        expect(body(request, 0)).toEqual({ codeChallenge: pkce.challenge, client: 'mobile' });
        expect(open).toHaveBeenCalledWith(AUTH, RETURN_URL);
        expect(request.mock.calls[1][0]).toBe('/api/v1/social/accounts/twitter/callback');
        expect(body(request, 1)).toEqual({ code: 'CODE1', state: 'SIGNED.STATE_1', codeVerifier: pkce.verifier, client: 'mobile' });
    });
    test('the verifier is never sent on the first call or opened in the browser', async () => {
        const { api, request } = apiWith((p) => (p.endsWith('/connect') ? { authorizeUrl: AUTH } : { ok: true, account }));
        const open = jest.fn(openOk);
        await runConnect(api, 'twitter', { open, pkce: async () => pkce, dev: false });
        expect(JSON.stringify(request.mock.calls[0])).not.toContain(pkce.verifier);
        expect(JSON.stringify(open.mock.calls)).not.toContain(pkce.verifier);
    });
    test('closing the browser is cancelled, and nothing is sent to finish', async () => {
        const { api, request } = apiWith(() => ({ authorizeUrl: AUTH }));
        const out = await runConnect(api, 'twitter', { open: async () => ({ type: 'cancel' }), pkce: async () => pkce, dev: false });
        expect(out).toEqual({ kind: 'cancelled' });
        expect(request).toHaveBeenCalledTimes(1);
    });
    test('the provider saying no (access_denied) is cancelled; any other error word is an error', async () => {
        const { api } = apiWith(() => ({ authorizeUrl: AUTH }));
        const deny: AuthSession = async (_u, r) => ({ type: 'success', url: `${r}?network=twitter&error=access_denied` });
        const odd: AuthSession = async (_u, r) => ({ type: 'success', url: `${r}?network=twitter&error=invalid_request` });
        expect(await runConnect(api, 'twitter', { open: deny, pkce: async () => pkce, dev: false })).toEqual({ kind: 'cancelled' });
        expect(await runConnect(api, 'twitter', { open: odd, pkce: async () => pkce, dev: false })).toEqual({ kind: 'error', key: 'connect.err.provider' });
    });
    test('a return with the wrong state is refused without calling the server again', async () => {
        const { api, request } = apiWith(() => ({ authorizeUrl: AUTH }));
        const bad: AuthSession = async (_u, r) => ({ type: 'success', url: `${r}?network=twitter&code=C&state=FORGED` });
        const out = await runConnect(api, 'twitter', { open: bad, pkce: async () => pkce, dev: false });
        expect(out).toEqual({ kind: 'error', key: 'connect.err.return' });
        expect(request).toHaveBeenCalledTimes(1);
    });
    test('an authorize link that is not https is refused and never opened', async () => {
        const { api } = apiWith(() => ({ authorizeUrl: 'http://evil.example/x?state=a' }));
        const open = jest.fn(openOk);
        const out = await runConnect(api, 'twitter', { open, pkce: async () => pkce, dev: false });
        expect(out).toEqual({ kind: 'error', key: 'connect.err.link' });
        expect(open).not.toHaveBeenCalled();
    });
    test('server refusals on either call become plain keys', async () => {
        const refuse = (status: number, code: string) => apiWith((p) => (p.endsWith('/connect') ? { authorizeUrl: AUTH } : new ApiError(status, code, { error: code })));
        const run = (e: ReturnType<typeof refuse>) => runConnect(e.api, 'twitter', { open: openOk, pkce: async () => pkce, dev: false });
        expect(await run(refuse(409, 'ACCOUNT_LIMIT'))).toEqual({ kind: 'error', key: 'connect.err.limit' });
        expect(await run(refuse(400, 'invalid_state'))).toEqual({ kind: 'error', key: 'connect.err.state' });
        expect(await run(refuse(502, 'connect_failed'))).toEqual({ kind: 'error', key: 'connect.err.failed' });
        const down = apiWith(() => new ApiError(404, 'network_unavailable', { error: 'network_unavailable' }));
        expect(await runConnect(down.api, 'twitter', { open: openOk, pkce: async () => pkce, dev: false })).toEqual({ kind: 'error', key: 'connect.err.unavailable' });
    });
    test('a finished answer with no account is an error, not a success', async () => {
        const { api } = apiWith((p) => (p.endsWith('/connect') ? { authorizeUrl: AUTH } : { ok: true }));
        expect(await runConnect(api, 'twitter', { open: openOk, pkce: async () => pkce, dev: false })).toEqual({ kind: 'error', key: 'common.error' });
    });
});

describe('connectErrorKey', () => {
    const k = (s: number, body: Record<string, unknown>) => connectErrorKey(new ApiError(s, String(body.error ?? body.code ?? 'x'), body));
    test('maps typed answers, including the ones that carry `code` instead of `error`', () => {
        expect(k(409, { ok: false, code: 'ACCOUNT_LIMIT', limit: 1 })).toBe('connect.err.limit');
        expect(k(409, { ok: false, code: 'NO_YOUTUBE_CHANNEL' })).toBe('connect.err.noChannel');
        expect(k(404, { error: 'network_unavailable' })).toBe('connect.err.unavailable');
        expect(k(400, { error: 'invalid_state' })).toBe('connect.err.state');
        expect(k(503, { error: 'twitter_not_configured' })).toBe('connect.err.later');
        expect(k(429, { error: 'rate_limited' })).toBe('connect.err.rate');
        expect(k(0, { error: 'network' })).toBe('connect.err.network');
        expect(k(502, { error: 'internal' })).toBe('common.error');
        expect(connectErrorKey(new Error('x'))).toBe('common.error');
    });
});
