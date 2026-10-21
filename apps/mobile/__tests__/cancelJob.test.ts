import { ApiError, type ApiClient } from '../src/lib/api';
import { cancelErrorKey, cancelJob, getCancelStatus } from '../src/lib/cancelJob';

let request: jest.Mock;
let api: ApiClient;
beforeEach(() => { request = jest.fn(); api = { request } as unknown as ApiClient; });
test('GET and POST encode the id and use only their method', async () => {
    request.mockResolvedValueOnce({ cancellable: true, credits: 17 });
    expect(await getCancelStatus(api, 'a/b')).toEqual({ cancellable: true, credits: 17 });
    expect(request).toHaveBeenLastCalledWith('/api/v1/jobs/a%2Fb/cancel', { method: 'GET' });
    request.mockResolvedValueOnce({ cancelled: true, replayed: true, credits: 0 });
    expect(await cancelJob(api, 'a/b')).toEqual({ replayed: true, credits: 0 });
    expect(request).toHaveBeenLastCalledWith('/api/v1/jobs/a%2Fb/cancel', { method: 'POST' });
});
test.each([null, {}, { cancellable: 'true', credits: 2 }, ...[-1, 1.2, '2', null, Infinity].map(credits => ({ cancellable: true, credits }))])('GET quietly rejects malformed shape %p', async row => {
    request.mockResolvedValue(row); expect(await getCancelStatus(api, 'id')).toBeNull();
});
test.each([new ApiError(404, 'not_found'), new ApiError(500, 'internal'), new ApiError(0, 'network'), new Error('offline')])('GET quietly degrades on %p', async err => {
    request.mockRejectedValue(err); expect(await getCancelStatus(api, 'id')).toBeNull();
});
test('false and zero are valid status values', async () => {
    request.mockResolvedValue({ cancellable: false, credits: 0 });
    expect(await getCancelStatus(api, 'id')).toEqual({ cancellable: false, credits: 0 });
});
test.each([null, {}, { cancelled: false, replayed: false, credits: 2 }, { cancelled: true, credits: 2 }, ...[-1, 1.2, '2', null, Infinity].map(credits => ({ cancelled: true, replayed: false, credits }))])('malformed POST %p is uncertain', async row => {
    request.mockResolvedValue(row);
    await expect(cancelJob(api, 'id')).rejects.toMatchObject({ status: 502, code: 'internal' });
});
test('POST preserves typed API errors', async () => {
    const err = new ApiError(409, 'job_started'); request.mockRejectedValue(err);
    await expect(cancelJob(api, 'id')).rejects.toBe(err);
});
test.each([
    ['job_started', 'started'], ['job_finished', 'finished'], ['account_frozen', 'frozen'],
    ['rate_limited', 'rateLimited'], ['not_found', 'unavailable'], ['network', 'unsure'], ['internal', 'unsure'], ['unknown', 'unsure'],
])('maps %s', (code, key) => expect(cancelErrorKey(new ApiError(400, code))).toBe(`jobCancel.${key}`));
test('any 5xx or non-ApiError is uncertain even with a refusal code', () => {
    for (const err of [new ApiError(502, 'internal'), new ApiError(503, 'job_started'), new Error('lost ack'), null]) {
        expect(cancelErrorKey(err)).toBe('jobCancel.unsure');
    }
});
