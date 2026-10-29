import { ApiError, createApiClient } from '../src/lib/api';
import { uploadBrandAsset, uploadErrorKey } from '../src/lib/brandAssetUpload';
const id = '11111111-1111-4111-8111-111111111111';
const grant = { asset_id: id, upload_url: 'https://storage.example/upload', content_type: 'image/png' };
const file = { uri: 'file:///picked.png', contentType: 'image/png', size: 100 };
let current: boolean;
const task = { gen: 1, user: null, current: () => current };
beforeEach(() => { current = true; });
const run = (request: jest.Mock, put = jest.fn().mockResolvedValue(undefined)) => uploadBrandAsset({ request }, task, id, file, put, new AbortController().signal);
test('reserve, put and inspect go to the project with the task and an idempotency key', async () => {
    const request = jest.fn().mockResolvedValueOnce(grant).mockResolvedValueOnce({ state: 'inspected' }), put = jest.fn().mockResolvedValue(undefined);
    await expect(run(request, put)).resolves.toEqual({ projectId: id, assetId: id });
    expect(request.mock.calls[0]).toEqual([`/api/v1/projects/${id}/assets`, expect.objectContaining({ method: 'POST', signal: expect.anything(), headers: { 'Content-Type': 'application/json', 'Idempotency-Key': expect.stringMatching(/^brand-asset-/) }, body: JSON.stringify({ media_type: 'image/png', size_bytes: 100 }) }), { task }]);
    expect(put).toHaveBeenCalledWith(grant.upload_url, { 'Content-Type': 'image/png' }, file.uri, expect.any(Function), expect.anything());
    expect(request.mock.calls[1]).toEqual([`/api/v1/projects/${id}/assets/${id}/inspect`, expect.objectContaining({ method: 'POST', body: '{}', signal: expect.anything() }), { task }]);
});
test.each([{ upload_url: 'http://storage/upload' }, { content_type: 'video/mp4' }, { asset_id: 'bad' }])('an http, mismatched or non-UUID grant sends no bytes (%#)', async patch => {
    const request = jest.fn().mockResolvedValue({ ...grant, ...patch }), put = jest.fn();
    await expect(run(request, put)).rejects.toMatchObject({ code: 'upload_invalid_grant' }); expect(put).not.toHaveBeenCalled(); expect(request).toHaveBeenCalledTimes(1);
});
test('an account change between steps stops before the put and before inspect', async () => {
    const request = jest.fn().mockImplementation(async () => { current = false; return grant; }), put = jest.fn();
    await expect(run(request, put)).rejects.toMatchObject({ code: 'account_changed' }); expect(put).not.toHaveBeenCalled();
    current = true; request.mockReset().mockResolvedValue(grant); put.mockImplementation(async () => { current = false; });
    await expect(run(request, put)).rejects.toMatchObject({ code: 'account_changed' }); expect(request).toHaveBeenCalledTimes(1);
});
test('a rejected inspection is not attached', async () => {
    await expect(run(jest.fn().mockResolvedValueOnce(grant).mockResolvedValueOnce({ state: 'quarantined' }))).rejects.toMatchObject({ code: 'upload_rejected' });
});
test.each([
    [404, 'unknown', 'brand.upload.err.off'], [503, 'unknown', 'brand.upload.err.unavailable'], [400, 'upload_invalid_grant', 'brand.upload.err.type'],
    [422, 'upload_rejected', 'brand.upload.err.rejected'], [429, 'unknown', 'brand.err.rate'], [0, 'network', 'brand.err.network'], [0, 'upload_cancelled', null], [500, 'unknown', 'brand.err.failed'],
])('upload errors map to their messages (%s %s)', (status, code, key) => expect(uploadErrorKey(new ApiError(status as number, code as string))).toBe(key));
test('a real nested INVALID_MEDIA response maps to the file-type message', async () => {
    const original = globalThis.fetch;
    globalThis.fetch = jest.fn().mockResolvedValue({ ok: false, status: 400, headers: new Headers(), json: async () => ({ error: { code: 'INVALID_MEDIA', message: 'Invalid media', requestId: 'r' } }) });
    try {
        const api = createApiClient({ baseUrl: 'https://example.com', getAccessToken: async () => 'token', onSessionLost: jest.fn() });
        const err = await uploadBrandAsset(api, task, id, file, jest.fn(), new AbortController().signal).catch(e => e);
        expect(err).toBeInstanceOf(ApiError); expect(err.code).toBe('unknown'); expect(uploadErrorKey(err)).toBe('brand.upload.err.type');
    } finally { globalThis.fetch = original; }
});
test('cancellation between transfer steps prevents further requests', async () => {
    const controller = new AbortController(), put = jest.fn(async () => { controller.abort(); });
    const request = jest.fn().mockResolvedValue(grant);
    await expect(uploadBrandAsset({ request }, task, id, file, put, controller.signal)).rejects.toMatchObject({ code: 'upload_cancelled' });
    expect(request).toHaveBeenCalledTimes(1);
});
test('an inspect 404 is a rejected file rather than uploads being off', async () => {
    const request = jest.fn().mockResolvedValueOnce(grant).mockRejectedValueOnce(new ApiError(404, 'unknown'));
    const err = await run(request).catch(e => e);
    expect(err).toMatchObject({ status: 422, code: 'upload_rejected' });
    expect(uploadErrorKey(err)).toBe('brand.upload.err.rejected');
});

test('a storage 404 does not disable project uploads', async () => {
    const request = jest.fn().mockResolvedValueOnce(grant);
    const err = await run(request, jest.fn().mockRejectedValue(new ApiError(404, 'upload_failed'))).catch(e => e);
    expect(uploadErrorKey(err)).toBe('brand.upload.err.rejected');
    expect(request).toHaveBeenCalledTimes(1);
});
