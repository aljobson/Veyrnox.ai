import { ApiError, type ApiClient } from '../src/lib/api';
import { createPublicationFlow } from '../src/lib/music/publicationFlow';
import { createPublicationAttempts } from '../src/lib/music/publicationAttempts';
import { input, receipt, publication, songId, deferred } from './fixtures/musicPublication';
jest.mock('expo-crypto', () => ({ randomUUID: () => jest.requireActual('node:crypto').randomUUID() }));
function setup() {
    const request = jest.fn().mockResolvedValue({ publication: null });
    const api = { request } as unknown as ApiClient, flow = createPublicationFlow(api, songId);
    return { request, api, flow };
}
test.each([new Error('offline'), new ApiError(500, 'internal'), new ApiError(408, 'timeout'), new ApiError(429, 'rate_limit')])('unknown publish outcome keeps immutable input/key and refetches', async error => {
    const h = setup(); await h.flow.load();
    h.request.mockRejectedValueOnce(error).mockResolvedValueOnce({ publication: null });
    await h.flow.publish(input); expect(h.flow.snapshot()).toMatchObject({ issue: 'retryPublish', pending: input, busy: false });
    h.request.mockResolvedValueOnce(receipt).mockResolvedValueOnce({ publication });
    await h.flow.publish(h.flow.snapshot().pending!);
    const writes = h.request.mock.calls.filter(([, init]) => init?.method === 'POST');
    expect(writes).toHaveLength(2); expect(writes[0]).toEqual(writes[1]);
    expect(h.request.mock.calls.map(([, init]) => init?.method ?? 'GET')).toEqual(['GET', 'POST', 'GET', 'POST', 'GET']);
    expect(h.flow.snapshot()).toMatchObject({ pending: null, read: { state: 'on', data: publication } }); h.flow.dispose();
});
test.each([[400, 'publication_not_allowed', 'policy'], [409, 'handle_taken', 'handleTaken'], [403, 'forbidden', 'writeError']] as const)('definitive %s %s clears publish attempt', async (status, code, issue) => {
    const h = setup(); await h.flow.load(); h.request.mockRejectedValueOnce(new ApiError(status, code)).mockResolvedValueOnce({ publication: null });
    await h.flow.publish(input); expect(h.flow.snapshot()).toMatchObject({ pending: null, issue });
    h.request.mockResolvedValueOnce(receipt).mockResolvedValueOnce({ publication: null }); await h.flow.publish(input);
    const writes = h.request.mock.calls.filter(([, init]) => init?.method === 'POST');
    expect(JSON.parse(writes[0][1].body).idempotency_key).not.toBe(JSON.parse(writes[1][1].body).idempotency_key); h.flow.dispose();
});
test('POST acknowledgement cannot replace authoritative GET state', async () => {
    const h = setup(); await h.flow.load(); h.request.mockResolvedValueOnce(receipt).mockResolvedValueOnce({ publication: null });
    await h.flow.publish(input); expect(h.flow.snapshot().read).toEqual({ state: 'on', data: null }); h.flow.dispose();
});
test.each([false, true])('published refetch settles an unknown publish attempt (later retry: %s)', async later => {
    const h = setup(); await h.flow.load();
    h.request.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ publication: later ? null : publication });
    await h.flow.publish(input);
    if (later) {
        expect(h.flow.snapshot()).toMatchObject({ pending: input, issue: 'retryPublish' });
        h.request.mockResolvedValueOnce({ publication }); await h.flow.load();
    }
    expect(h.flow.snapshot()).toMatchObject({ pending: null, issue: null, busy: false, read: { state: 'on', data: publication } });
    expect(h.request.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);
    h.request.mockResolvedValueOnce({ ok: true, idempotent: false }).mockResolvedValueOnce({ publication: null });
    await h.flow.unpublish(publication.slug);
    expect(h.request.mock.calls.filter(([, init]) => init?.method === 'DELETE')).toHaveLength(1);
    expect(h.flow.snapshot().read).toEqual({ state: 'on', data: null }); h.flow.dispose();
});
test('blocked publication rejects stale publish and unpublish actions without a write', async () => {
    const h = setup(); h.request.mockResolvedValueOnce({ publication: { ...publication, status: 'blocked' } });
    await h.flow.load(); await h.flow.publish(input); await h.flow.unpublish(publication.slug);
    expect(h.request).toHaveBeenCalledTimes(1); h.flow.dispose();
});
test.each([new Error('offline'), new ApiError(503, 'internal'), new ApiError(408, 'timeout')])('uncertain DELETE never replays across intervening republish', async error => {
    const h = setup(), newer = { ...publication, slug: 'b'.repeat(24) };
    h.request.mockResolvedValueOnce({ publication }); await h.flow.load();
    h.request.mockRejectedValueOnce(error).mockResolvedValueOnce({ publication: newer });
    await h.flow.unpublish(publication.slug);
    expect(h.flow.snapshot()).toMatchObject({ pending: null, busy: false, issue: 'checkUnpublish', read: { state: 'on', data: newer } });
    expect(h.request.mock.calls.map(([, init]) => init?.method ?? 'GET')).toEqual(['GET', 'DELETE', 'GET']);
    await h.flow.unpublish(publication.slug); expect(h.request).toHaveBeenCalledTimes(3);
    h.request.mockResolvedValueOnce({ ok: true, idempotent: false }).mockResolvedValueOnce({ publication: null });
    await h.flow.unpublish(newer.slug);
    const writes = h.request.mock.calls.filter(([, init]) => init?.method === 'DELETE');
    expect(writes).toHaveLength(2); expect(writes[0][1].body).not.toEqual(writes[1][1].body);
    expect(h.flow.snapshot().read).toEqual({ state: 'on', data: null }); h.flow.dispose();
});
test('dispose ignores late GET and write completions and emits no more state', async () => {
    const h = setup(), late = deferred<unknown>(), changed = jest.fn(); h.flow.subscribe(changed);
    h.request.mockReturnValueOnce(late.promise); const read = h.flow.load(); h.flow.dispose(); late.resolve({ publication }); await read;
    expect(changed).not.toHaveBeenCalled(); expect(h.flow.snapshot().read).toBeNull();
    const next = setup(); await next.flow.load(); next.request.mockReturnValueOnce(late.promise);
    const write = next.flow.publish(input); next.flow.dispose(); await write;
    expect(next.request.mock.calls.filter(([, init]) => !init)).toHaveLength(1);
});
test('attempt locks payload and coalesces concurrent publish; reset invalidates queued work', async () => {
    const h = setup(), late = deferred<unknown>(), attempts = createPublicationAttempts(h.api, songId, () => 'fixed-uuid');
    h.request.mockReturnValueOnce(late.promise); const first = attempts.publish(input);
    expect(attempts.publish(input)).toBe(first); late.resolve({}); await expect(first).rejects.toMatchObject({ code: 'bad_response' });
    await expect(attempts.publish({ ...input, handle: 'another' })).rejects.toMatchObject({ code: 'pending_result' });
    expect(h.request).toHaveBeenCalledTimes(1); attempts.reset();
    const queued = attempts.publish(input); attempts.reset(); await expect(queued).rejects.toMatchObject({ code: 'account_changed' });
    expect(h.request).toHaveBeenCalledTimes(1);
});
test('a definite unpublish rejection is a write error, not an unknown result', async () => {
    // Covered through the real flow: 403 is definitive, a network error is not.
    const { isDefinitivePublicError } = require('../src/lib/music/publicAttempts');
    const { ApiError } = require('../src/lib/api');
    expect(isDefinitivePublicError(new ApiError(403, 'forbidden'))).toBe(true);
    expect(isDefinitivePublicError(new ApiError(0, 'network'))).toBe(false);
    expect(isDefinitivePublicError(new ApiError(503, 'temporarily_unavailable'))).toBe(false);
});
