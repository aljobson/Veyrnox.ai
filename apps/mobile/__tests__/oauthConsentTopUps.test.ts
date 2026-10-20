import { AuthError } from '../src/lib/auth/supabaseAuth';
import { consentErrorKey, decide, fetchRequest, parseRequest, safeRedirect, validAuthorizationId } from '../src/lib/oauthConsent';
import { dollars, merge, parsePage, statusKey } from '../src/lib/topUps';
import { mapAppLink } from '../src/lib/appLinks';

const ID = 'abc12345-def6-7890-abcd-ef1234567890';
const UID = '123e4567-e89b-42d3-a456-426614174000';

describe('consent request', () => {
    test('reads the client under either name, scopes as list or string, and flags a publish scope', () => {
        expect(parseRequest({ client: { client_name: 'Desk', client_uri: 'https://desk.example' }, scope: 'read generate', redirect_uri: 'https://desk.example/cb' })).toEqual({
            name: 'Desk', website: 'https://desk.example/', redirect: 'https://desk.example/cb', scopes: ['read', 'generate'], publish: false,
        });
        expect(parseRequest({ client_metadata: { name: 'Two' }, scopes: ['read', 'publish:schedule'] })).toMatchObject({ name: 'Two', publish: true });
        expect(parseRequest(null)).toEqual({ name: null, website: null, redirect: null, scopes: [], publish: false });
    });
    test('a website that is not https is dropped', () => {
        expect(parseRequest({ client: { client_uri: 'http://x.example' } }).website).toBeNull();
    });
    test('ids are checked before any request', () => {
        expect(validAuthorizationId(ID)).toBe(true);
        expect(validAuthorizationId('../x')).toBe(false);
        expect(validAuthorizationId('short')).toBe(false);
        expect(validAuthorizationId(5)).toBe(false);
    });
});

describe('where the decision sends the person', () => {
    test('opens https and the assistant\'s own app scheme', () => {
        expect(safeRedirect('https://app.example/cb?code=1')).toBe('https://app.example/cb?code=1');
        expect(safeRedirect('myassistant://auth/callback?code=1')).toBe('myassistant://auth/callback?code=1');
        expect(safeRedirect('http://localhost:8080/cb')).toBe('http://localhost:8080/cb');
    });
    test('refuses scripts, data, files, plain http elsewhere and junk', () => {
        for (const bad of ['javascript:alert(1)', 'data:text/html,x', 'file:///etc/passwd', 'http://evil.example/cb', 'intent://x#Intent;end', 'not a url', '', 'https://x.example/' + 'a'.repeat(2100)]) {
            expect(safeRedirect(bad)).toBeNull();
        }
        expect(safeRedirect(5)).toBeNull();
    });
});

describe('consent calls', () => {
    const fetchMock = jest.fn();
    const token = async () => 'tok';
    const res = (status: number, body: unknown) => ({ status, ok: status < 300, text: async () => JSON.stringify(body) }) as unknown as Response;
    beforeEach(() => {
        fetchMock.mockReset();
        globalThis.fetch = fetchMock as unknown as typeof fetch;
    });
    test('loads the request by id', async () => {
        fetchMock.mockResolvedValue(res(200, { client: { name: 'Desk' } }));
        expect((await fetchRequest(token, ID)).name).toBe('Desk');
        expect(String(fetchMock.mock.calls[0][0])).toContain(`/auth/v1/oauth/authorizations/${ID}`);
    });
    test('sends approve or deny and returns the safe address', async () => {
        fetchMock.mockResolvedValue(res(200, { redirect_url: 'https://desk.example/cb?code=1' }));
        expect(await decide(token, ID, 'approve')).toBe('https://desk.example/cb?code=1');
        const init = fetchMock.mock.calls[0][1] as RequestInit;
        expect(String(fetchMock.mock.calls[0][0])).toContain(`/${ID}/consent`);
        expect(JSON.parse(String(init.body))).toEqual({ action: 'approve' });
    });
    test('an unsafe or missing address after the decision is an error, never opened', async () => {
        fetchMock.mockResolvedValue(res(200, { redirect_url: 'javascript:alert(1)' }));
        await expect(decide(token, ID, 'deny')).rejects.toMatchObject({ code: 'no_redirect' });
        fetchMock.mockResolvedValue(res(200, {}));
        await expect(decide(token, ID, 'deny')).rejects.toMatchObject({ code: 'no_redirect' });
    });
    test('a bad id sends nothing', async () => {
        await expect(fetchRequest(token, '../x')).rejects.toMatchObject({ status: 400 });
        await expect(decide(token, 'x', 'approve')).rejects.toMatchObject({ status: 400 });
        expect(fetchMock).not.toHaveBeenCalled();
    });
    test('wording', () => {
        expect(consentErrorKey(new AuthError(0, 'network'))).toBe('oac.err.network');
        expect(consentErrorKey(new AuthError(404, 'x'))).toBe('oac.err.gone');
        expect(consentErrorKey(new AuthError(410, 'x'))).toBe('oac.err.gone');
        expect(consentErrorKey(new AuthError(502, 'no_redirect'))).toBe('oac.err.redirect');
        expect(consentErrorKey(new AuthError(500, 'x'))).toBe('oauth.saveError');
    });
});

describe('opening a consent link', () => {
    test('a valid web link opens the consent screen with the id encoded', () => {
        expect(mapAppLink(`https://veyrnox.ai/oauth/consent?authorization_id=${ID}`)).toBe(`/oauth-consent?authorization_id=${ID}`);
    });
    test('a missing, odd or extra-path link falls back to Home', () => {
        expect(mapAppLink('https://veyrnox.ai/oauth/consent')).toBe('/');
        expect(mapAppLink('https://veyrnox.ai/oauth/consent?authorization_id=../../x')).toBe('/');
        expect(mapAppLink(`https://veyrnox.ai/oauth/consent/extra?authorization_id=${ID}`)).toBe('/');
        expect(mapAppLink(`https://evil.example/oauth/consent?authorization_id=${ID}`)).toBe(`https://evil.example/oauth/consent?authorization_id=${ID}`);
    });
});

describe('purchase history', () => {
    test('reads rows and the cursor; drops bad rows and a cursor with a bad id', () => {
        const page = parsePage({ top_ups: [{ id: 'a', credits: 100, price_usd_cents: 499, status: 'credited', created_at: '2026-01-01T00:00:00Z' }, { id: 'b' }, null, { id: 'c', credits: 5, status: 'pending', created_at: 'x' }], next: { before: '2026-01-01T00:00:00Z', before_id: UID } });
        expect(page.items).toEqual([
            { id: 'a', credits: 100, priceCents: 499, status: 'credited', createdAt: '2026-01-01T00:00:00Z' },
            { id: 'c', credits: 5, priceCents: null, status: 'pending', createdAt: 'x' },
        ]);
        expect(page.next).toEqual({ before: '2026-01-01T00:00:00Z', beforeId: UID });
        expect(parsePage({ top_ups: [], next: { before: 'x', before_id: 'bad' } }).next).toBeNull();
        expect(parsePage(undefined)).toEqual({ items: [], next: null });
    });
    test('a later page that repeats a row adds nothing', () => {
        const a = { id: 'a', credits: 1, priceCents: null, status: 'credited', createdAt: 'x' };
        const b = { ...a, id: 'b' };
        expect(merge([a], [a, b])).toEqual([a, b]);
    });
    test('formats price and status; an unknown status reads as updated', () => {
        expect(dollars(499)).toBe('$4.99');
        expect(dollars(5)).toBe('$0.05');
        expect(statusKey('pending')).toBe('topup.status.pending');
        expect(statusKey('credited')).toBe('topup.status.credited');
        expect(statusKey('refunded')).toBe('topup.status.other');
    });
});
