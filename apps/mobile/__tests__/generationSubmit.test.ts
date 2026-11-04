import { ApiError, type ApiClient } from '../src/lib/api';
import { createGenerationSubmit, unknownGenerationOutcome } from '../src/lib/generationSubmit';
const mockCreate = jest.fn();
jest.mock('expo-crypto', () => { let n = 0; return { randomUUID: () => `key-${++n}` }; });
jest.mock('../src/lib/media', () => ({ mediaApi: () => ({ createGeneration: mockCreate }) }));
const api = {} as ApiClient;
const request = { modelId: 'image', prompt: 'lake', durationSeconds: null, confirmedCredits: 2 };
beforeEach(() => mockCreate.mockReset());
test('onJob receives every job in order, with zero-based indexes and distinct keys', async () => {
    const onJob = jest.fn(), onStarted = jest.fn();
    mockCreate.mockResolvedValueOnce({ job_id: 'a' }).mockResolvedValueOnce({ job_id: 'b' }).mockResolvedValueOnce({ job_id: 'c' });
    expect(await createGenerationSubmit().run(api, request, 3, onStarted, onJob)).toBe('a');
    expect(onJob.mock.calls).toEqual([['a', 0], ['b', 1], ['c', 2]]);
    expect(onStarted.mock.calls).toEqual([[1], [2], [3]]);
    expect(new Set(mockCreate.mock.calls.map(([r]) => r.idempotencyKey)).size).toBe(3);
});
test('existing callers retain their return value and retry keys without onJob', async () => {
    const submit = createGenerationSubmit();
    mockCreate.mockResolvedValueOnce({ job_id: 'a' }).mockRejectedValueOnce(new ApiError(0, 'network'));
    await expect(submit.run(api, request, 3)).rejects.toMatchObject({ code: 'network' });
    const keys = mockCreate.mock.calls.map(([r]) => r.idempotencyKey);
    mockCreate.mockResolvedValue({ job_id: 'a' });
    expect(await submit.run(api, request, 3)).toBe('a');
    expect(mockCreate.mock.calls[2][0].idempotencyKey).toBe(keys[1]);
    expect(mockCreate.mock.calls.slice(2).some(([r]) => r.idempotencyKey === keys[0])).toBe(false);
    const all = mockCreate.mock.calls.slice(2).map(([r]) => r.idempotencyKey);
    await submit.run(api, request, 3);
    expect(mockCreate.mock.calls.slice(4).every(([r]) => !all.includes(r.idempotencyKey))).toBe(true);
});

test('price metadata cannot change identity, accepted items are skipped, and allocation uses unresolved position', async () => {
    const submit = createGenerationSubmit();
    mockCreate.mockResolvedValueOnce({ job_id: 'first' }).mockRejectedValueOnce(new ApiError(409, 'price_changed', { expected_credits: 9 }));
    const initial = submit.snapshot(request, 2, 2, 1);
    expect(initial).toEqual({ ceilings: [0, 2], total: 2, payable: 2 });
    await expect(submit.run(api, request, 2, undefined, undefined, initial)).rejects.toMatchObject({ code: 'price_changed' });
    const keys = mockCreate.mock.calls.map(([r]) => r.idempotencyKey);
    const refreshed = { ...request, confirmedCredits: 9, maxCharge: 9 };
    const quote = submit.snapshot(refreshed, 2, 9, 1);
    expect(quote).toEqual({ ceilings: [null, 0], total: 0, payable: 0 });
    mockCreate.mockResolvedValueOnce({ job_id: 'second' });
    await submit.run(api, refreshed, 2, undefined, undefined, quote);
    expect(mockCreate).toHaveBeenCalledTimes(3);
    expect(mockCreate.mock.calls[2][0]).toMatchObject({ idempotencyKey: keys[1], maxCharge: 0 });
    expect(mockCreate.mock.calls[2][0].confirmedCredits).toBe(9);
});

test('stale positive allowance is replaced by a fresh paid confirmation snapshot', async () => {
    const submit = createGenerationSubmit();
    mockCreate.mockRejectedValueOnce(new ApiError(409, 'price_changed', { expected_credits: 9 }));
    await expect(submit.run(api, request, 1, undefined, undefined, submit.snapshot(request, 1, 2, 1))).rejects.toMatchObject({ code: 'price_changed' });
    const firstKey = mockCreate.mock.calls[0][0].idempotencyKey;
    const quote = submit.snapshot(request, 1, 9, 0);
    expect(quote.total).toBe(9);
    mockCreate.mockResolvedValueOnce({ job_id: 'paid' });
    await submit.run(api, request, 1, undefined, undefined, quote);
    expect(mockCreate.mock.calls[1][0]).toMatchObject({ idempotencyKey: firstKey, maxCharge: quote.total });
});

test.each(['flux-2-pro-1k-kie', 'flux-2-pro'])('model %s sends gross confirmation plus the net ceiling regardless of server dispatch mode', async modelId => {
    const submit = createGenerationSubmit();
    const input = { ...request, modelId };
    mockCreate.mockResolvedValueOnce({ job_id: 'free' });
    await submit.run(api, input, 1, undefined, undefined, submit.snapshot(input, 1, 2, 1));
    expect(mockCreate.mock.calls[0][0]).toMatchObject({ modelId, confirmedCredits: 2, maxCharge: 0 });
});
test('untyped 5xx, unreadable 2xx and the server outcome_unknown count as unknown outcomes', () => {
    for (const err of [new ApiError(500, 'unknown'), new ApiError(502, 'unknown'), new ApiError(200, 'bad_response'), new ApiError(503, 'outcome_unknown')]) expect(unknownGenerationOutcome(err)).toBe(true);
    for (const err of [new ApiError(422, 'provider_moderation'), new ApiError(503, 'admission_unavailable'), new ApiError(400, 'unknown')]) expect(unknownGenerationOutcome(err)).toBe(false);
});
test('a lost-reply item replays its retained key without needing another payment', async () => {
    const submit = createGenerationSubmit();
    mockCreate.mockRejectedValueOnce(new ApiError(0, 'network'));
    await expect(submit.run(api, request, 1, undefined, undefined, submit.snapshot(request, 1, 4, 0))).rejects.toMatchObject({ code: 'network' });
    const quote = submit.snapshot(request, 1, 4, 0);
    expect(quote.ceilings).toEqual([4]);
    expect(quote.total).toBe(4);
    expect(quote.payable).toBe(0);
});
