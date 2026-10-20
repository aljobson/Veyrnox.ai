import { ApiError } from '../src/lib/api';
import { createKey, createWebhook, devErrorKey, fetchLogs, keyLive, keyProblem, parseKeys, parseLogs, parseWebhooks, revokeKey, revokeWebhook, validWebhookUrl, webhookProblem } from '../src/lib/publishDeveloper';

const ID = '123e4567-e89b-42d3-a456-426614174000';
const apiWith = (result: unknown) => {
    const request = jest.fn(async () => result);
    return { api: { request } as never, request };
};
const call = (request: jest.Mock, i = 0) => ({ path: request.mock.calls[i][0] as string, init: (request.mock.calls[i][1] ?? {}) as RequestInit });

describe('reading the lists', () => {
    test('keys: the fields the web shows; rows with no id are dropped', () => {
        expect(parseKeys({ keys: [{ id: 'k', label: 'CI', key_prefix: 'vxk_ab', scopes: ['posts:read', 3], expires_at: '2027-01-01T00:00:00Z', last_used_at: null, revoked_at: null }, { label: 'x' }, null] })).toEqual([
            { id: 'k', label: 'CI', prefix: 'vxk_ab', scopes: ['posts:read'], expiresAt: '2027-01-01T00:00:00Z', lastUsedAt: null, revokedAt: null },
        ]);
        expect(parseKeys(undefined)).toEqual([]);
    });
    test('webhooks and deliveries', () => {
        const r = parseWebhooks({ endpoints: [{ id: 'e', label: 'Hook', url: 'https://x.example/h', events: ['post.failed'], active: false }], deliveries: [{ id: 'd', event_type: 'post.failed', endpoint_label: 'Hook', outcome: 'failed', attempts: 3, last_status: 500, last_error: 'http_500' }, { nope: 1 }] });
        expect(r.endpoints[0]).toMatchObject({ id: 'e', active: false });
        expect(r.deliveries).toEqual([{ id: 'd', event: 'post.failed', endpoint: 'Hook', outcome: 'failed', attempts: 3, status: 500, error: 'http_500' }]);
        expect(parseWebhooks(null)).toEqual({ endpoints: [], deliveries: [] });
    });
    test('logs', () => {
        expect(parseLogs({ logs: [{ id: 'l', method: 'GET', route: '/api/publish/v1/posts', response_status: 200, api_key_label: 'CI', key_prefix: 'vxk_ab', error_code: null, requested_at: '2026-01-01T00:00:00Z' }] })[0]).toMatchObject({ method: 'GET', status: 200, keyLabel: 'CI' });
    });
    test('a key is live until revoked or expired', () => {
        const base = { id: 'k', label: 'a', prefix: '', scopes: [], lastUsedAt: null };
        expect(keyLive({ ...base, expiresAt: '2999-01-01T00:00:00Z', revokedAt: null })).toBe(true);
        expect(keyLive({ ...base, expiresAt: '2000-01-01T00:00:00Z', revokedAt: null })).toBe(false);
        expect(keyLive({ ...base, expiresAt: null, revokedAt: '2026-01-01T00:00:00Z' })).toBe(false);
    });
});

describe('what may be created', () => {
    test('webhook addresses follow the server rules', () => {
        expect(validWebhookUrl('https://hooks.example.com/path')).toBe(true);
        for (const bad of ['http://hooks.example.com', 'https://localhost/x', 'https://a.local/x', 'https://a.internal/x', 'https://10.0.0.1/x', 'https://[::1]/x', 'https://user:pw@a.example/x', 'https://a.example:8443/x', 'https://a.example/x#f', 'https://intranet/x', 'nope', 'https://a.example/' + 'x'.repeat(2100)]) {
            expect(validWebhookUrl(bad)).toBe(false);
        }
    });
    test('key input: a name, 1 to 3 known scopes once each, a known expiry', () => {
        expect(keyProblem({ label: 'CI', scopes: ['accounts:read'], days: 90 })).toBeNull();
        expect(keyProblem({ label: ' ', scopes: ['accounts:read'], days: 90 })).toBe('label');
        expect(keyProblem({ label: 'x'.repeat(81), scopes: ['accounts:read'], days: 90 })).toBe('label');
        expect(keyProblem({ label: 'a', scopes: [], days: 90 })).toBe('scopes');
        expect(keyProblem({ label: 'a', scopes: ['admin'], days: 90 })).toBe('scopes');
        expect(keyProblem({ label: 'a', scopes: ['posts:read', 'posts:read'], days: 90 })).toBe('scopes');
        expect(keyProblem({ label: 'a', scopes: ['posts:read'], days: 45 })).toBe('days');
    });
    test('webhook input', () => {
        expect(webhookProblem({ label: 'h', url: 'https://a.example/h', events: ['post.published'] })).toBeNull();
        expect(webhookProblem({ label: '', url: 'https://a.example/h', events: ['post.published'] })).toBe('label');
        expect(webhookProblem({ label: 'h', url: 'http://a.example/h', events: ['post.published'] })).toBe('url');
        expect(webhookProblem({ label: 'h', url: 'https://a.example/h', events: [] })).toBe('events');
        expect(webhookProblem({ label: 'h', url: 'https://a.example/h', events: ['post.deleted'] })).toBe('events');
    });
});

describe('calls', () => {
    test('create key sends the web body and returns the secret once; nothing is requested for bad input', async () => {
        const { api, request } = apiWith({ key_id: ID, api_key: 'shown-once-value', warning: 'x' });
        expect(await createKey(api, { label: ' CI ', scopes: ['posts:read'], days: 30 })).toEqual({ id: ID, secret: 'shown-once-value' });
        expect(JSON.parse(String(call(request).init.body))).toEqual({ label: 'CI', scopes: ['posts:read'], expiresInDays: 30 });
        await expect(createKey(api, { label: '', scopes: [], days: 1 })).rejects.toMatchObject({ code: 'invalid_body' });
        expect(request).toHaveBeenCalledTimes(1);
    });
    test('an answer with no secret is an error, not a silent success', async () => {
        await expect(createKey(apiWith({ key_id: ID }).api, { label: 'a', scopes: ['posts:read'], days: 30 })).rejects.toMatchObject({ status: 502 });
        await expect(createWebhook(apiWith({}).api, { label: 'a', url: 'https://a.example/h', events: ['post.failed'] })).rejects.toMatchObject({ status: 502 });
    });
    test('create webhook trims and sends the web body', async () => {
        const { api, request } = apiWith({ endpoint_id: ID, signing_secret: 'sig-once' });
        expect((await createWebhook(api, { label: ' h ', url: ' https://a.example/h ', events: ['post.failed'] })).secret).toBe('sig-once');
        expect(JSON.parse(String(call(request).init.body))).toEqual({ label: 'h', url: 'https://a.example/h', events: ['post.failed'] });
    });
    test('revoke is a DELETE by checked id', async () => {
        const { api, request } = apiWith({ ok: true });
        await revokeKey(api, ID);
        await revokeWebhook(api, ID);
        expect(call(request, 0)).toMatchObject({ path: `/api/v1/social/developer/keys?id=${ID}`, init: { method: 'DELETE' } });
        expect(call(request, 1).path).toBe(`/api/v1/social/developer/webhooks?id=${ID}`);
        await expect(revokeKey(api, '../x')).rejects.toMatchObject({ code: 'invalid_id' });
        expect(request).toHaveBeenCalledTimes(2);
    });
    test('log filters become the web query, trimmed and capped', async () => {
        const { api, request } = apiWith({ logs: [] });
        await fetchLogs(api, { status: 'error', q: `  ${'x'.repeat(200)}  ` });
        const p = new URLSearchParams(call(request).path.split('?')[1]);
        expect(p.get('status')).toBe('error');
        expect(p.get('q')).toHaveLength(80);
        expect(p.get('limit')).toBe('100');
        await fetchLogs(api);
        expect(call(request, 1).path).toBe('/api/v1/social/developer/logs?limit=100');
    });
    test('wording by status and code', () => {
        expect(devErrorKey(new ApiError(404, 'customer_api_not_open'))).toBe('dev.err.off');
        expect(devErrorKey(new ApiError(404, 'customer_webhooks_not_open'))).toBe('dev.err.off');
        expect(devErrorKey(new ApiError(402, 'plan_required'))).toBe('dev.err.plan');
        expect(devErrorKey(new ApiError(403, 'forbidden'))).toBe('dev.err.role');
        expect(devErrorKey(new ApiError(409, 'api_key_limit'))).toBe('dev.err.limit');
        expect(devErrorKey(new ApiError(429, 'x'))).toBe('dev.err.rate');
        expect(devErrorKey(new ApiError(0, 'network'))).toBe('dev.err.network');
        expect(devErrorKey(new ApiError(400, 'invalid_body'))).toBe('dev.err.invalid');
        expect(devErrorKey(new Error('x'))).toBe('dev.err.failed');
    });
});
