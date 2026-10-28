import { ApiError, type ApiClient } from '../src/lib/api';
import { createGenerationSubmit } from '../src/lib/generationSubmit';
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
    expect(mockCreate.mock.calls.slice(2, 4).map(([r]) => r.idempotencyKey)).toEqual(keys);
    const all = mockCreate.mock.calls.slice(2).map(([r]) => r.idempotencyKey);
    await submit.run(api, request, 3);
    expect(mockCreate.mock.calls.slice(5).every(([r]) => !all.includes(r.idempotencyKey))).toBe(true);
});
