import { ApiError, type ApiClient } from '../src/lib/api';
import { checkLocal, completeUpload, listUploads, neutralFilename, prepareImage, publishUploadMessage, removeUpload, uploadToPublish, validUploadUrl } from '../src/lib/publishUploads';
import { OfflineError } from '../src/lib/network';

const mockDeleted = jest.fn();
jest.mock('expo-file-system', () => ({ File: class { size = 321; exists = true; uri: string; constructor(uri: string) { this.uri = uri; } delete() { mockDeleted(this.uri); } }, Paths: { cache: { uri: 'file:///cache/' } } }));
const file = { uri: 'file:///cache/private-name.jpg', mimeType: 'image/jpeg', size: 321 };
const grant = (id = 'one') => ({ id, upload_url: `https://a.r2.cloudflarestorage.com/${id}`, content_type: 'image/jpeg', headers: { 'If-None-Match': '*', 'content-length': '321' } });
const row = { id: 'one', filename: 'Photo.jpg', mime_type: 'image/jpeg', size_bytes: 321, url: 'https://preview.test' };
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }
const setup = () => {
    let next = 0;
    const request = jest.fn(async (_path: string, init?: RequestInit): Promise<unknown> => {
        const body = JSON.parse(String(init?.body || '{}'));
        if (body.action === 'reserve') return grant(String(++next));
        if (body.action === 'complete') return { upload: row };
        return { uploads: [row] };
    });
    const options = { signal: new AbortController().signal, accountLive: () => true, onProgress: jest.fn(), put: jest.fn(async () => {}) };
    return { request, api: { request } as unknown as ApiClient, options };
};
const calls = (request: jest.Mock) => request.mock.calls.map(([, init]) => ({ method: init?.method ?? 'GET', ...JSON.parse(init?.body || '{}') }));
test.each([
    ['image/jpeg', 20 * 1048576, 'ok'], ['image/jpeg', 20 * 1048576 + 1, 'upload_too_large'],
    ['image/png', 20 * 1048576, 'ok'], ['image/png', 20 * 1048576 + 1, 'upload_too_large'],
    ['image/webp', 20 * 1048576, 'ok'], ['image/webp', 20 * 1048576 + 1, 'upload_too_large'],
    ['video/mp4', 100 * 1048576, 'ok'], ['video/mp4', 100 * 1048576 + 1, 'upload_too_large'],
    ['image/jpg', 10, 'ok'], ['video/quicktime', 10, 'upload_type_not_allowed'], ['image/jpeg', 0, 'upload_size_required'],
    ['image/jpeg', NaN, 'upload_size_required'], ['image/jpeg', -1, 'upload_size_required'], ['image/jpeg', 1.5, 'upload_size_required'],
])('local %s %s → %s', (mimeType, size, expected) => expect(checkLocal({ mimeType, size: Number(size) })).toBe(expected));
test('HEIC is rendered once full-size and JPEG size comes from disk', async () => {
    const saveAsync = jest.fn(async () => ({ uri: 'file:///cache/converted.jpg', width: 4000, height: 3000 }));
    const renderAsync = jest.fn(async () => ({ width: 4000, height: 3000, saveAsync }));
    const resize = jest.fn(); const manipulate = jest.fn(() => ({ renderAsync, resize }));
    const out = await prepareImage({ uri: file.uri, mimeType: 'image/heic' }, { load: () => ({ ImageManipulator: { manipulate }, SaveFormat: { JPEG: 'jpeg' } }) });
    expect(out).toEqual({ uri: 'file:///cache/converted.jpg', mimeType: 'image/jpeg', size: 321 });
    expect(renderAsync).toHaveBeenCalledTimes(1); expect(resize).not.toHaveBeenCalled();
    expect(saveAsync).toHaveBeenCalledWith({ compress: 1, format: 'jpeg' });
});
test('local validation prevents any request', async () => {
    const s = setup(); await expect(uploadToPublish(s.api, { ...file, size: 0 }, s.options)).rejects.toMatchObject({ code: 'upload_size_required' });
    expect(s.request).not.toHaveBeenCalled();
});
test('real route bodies, neutral name, forwarded headers, and completion result', async () => {
    const s = setup(); expect(await uploadToPublish(s.api, file, s.options)).toEqual(row);
    const sent = calls(s.request);
    expect(sent[0]).toEqual({ method: 'POST', action: 'reserve', filename: expect.stringMatching(/^Photo .*\.jpg$/), content_type: 'image/jpeg', size_bytes: 321, rights_confirmed: true });
    expect(JSON.stringify(sent)).not.toContain('private-name');
    expect(s.options.put).toHaveBeenCalledWith(grant('1').upload_url, { 'Content-Type': 'image/jpeg', 'If-None-Match': '*' }, file.uri, s.options.onProgress, s.options.signal);
    expect(sent[1]).toEqual({ method: 'POST', action: 'complete', id: '1' });
    expect(neutralFilename('video/mp4', new Date(2026, 9, 21, 14, 5))).toBe('Video 2026-10-21 14.05.mp4');
    expect(neutralFilename('image/jpg').length).toBeLessThanOrEqual(180);
    await listUploads(s.api); await removeUpload(s.api, 'x'); await completeUpload(s.api, 'y');
    expect(calls(s.request).slice(-3)).toEqual([{ method: 'GET' }, { method: 'DELETE', id: 'x' }, { method: 'POST', action: 'complete', id: 'y' }]);
    expect(s.request.mock.calls.every(([path]) => path === '/api/v1/social/uploads')).toBe(true);
});
test('host rules and malicious grant sends no PUT and deletes reservation', async () => {
    expect(validUploadUrl('https://a.r2.cloudflarestorage.com/x', false)).toBe(true);
    expect(validUploadUrl('http://localhost:8799/mock-r2/x', true, 'http://localhost:8799')).toBe(true);
    expect(validUploadUrl('http://localhost:8799/mock-r2/x', false, 'http://localhost:8799')).toBe(false);
    for (const url of ['https://a.r2.cloudflarestorage.com.evil.test/x', 'https://evil.test', 'file:///tmp/x', 'https://user@a.r2.cloudflarestorage.com']) {
        const s = setup(); s.request.mockResolvedValueOnce({ ...grant(), upload_url: url });
        await expect(uploadToPublish(s.api, file, s.options)).rejects.toMatchObject({ code: 'upload_failed' });
        expect(s.options.put).not.toHaveBeenCalled(); expect(calls(s.request).filter(c => c.method === 'DELETE')).toEqual([{ method: 'DELETE', id: 'one' }]);
    }
});
test.each([new Error('drop'), new ApiError(403, 'upload_url_expired'), new ApiError(0, 'upload_cancelled')])('PUT failure cleans once and retry reserves a fresh URL', async error => {
    const s = setup(); s.options.put.mockRejectedValueOnce(error);
    await expect(uploadToPublish(s.api, file, s.options)).rejects.toBeDefined();
    await uploadToPublish(s.api, file, s.options);
    expect(calls(s.request).filter(c => c.method === 'DELETE')).toEqual([{ method: 'DELETE', id: '1' }]);
    expect(s.options.put.mock.calls.map(c => (c as unknown as string[])[0])).toEqual([grant('1').upload_url, grant('2').upload_url]);
});
test.each([400, 404])('complete %s deletes once', async status => {
    const s = setup(); s.request.mockResolvedValueOnce(grant()).mockRejectedValueOnce(new ApiError(status, 'upload_not_found'));
    await expect(uploadToPublish(s.api, file, s.options)).rejects.toMatchObject({ status, body: { reservationRemoved: true } });
    expect(calls(s.request).filter(c => c.method === 'DELETE')).toEqual([{ method: 'DELETE', id: 'one' }]);
});
test.each([false, true])('deferred reserve: account change=%s versus same-account cancel', async switchAccount => {
    const s = setup(), held = deferred<ReturnType<typeof grant>>(), controller = new AbortController(); let live = true;
    s.request.mockImplementationOnce(() => held.promise);
    const result = uploadToPublish(s.api, file, { ...s.options, signal: controller.signal, accountLive: () => live });
    await Promise.resolve(); await Promise.resolve();
    if (switchAccount) live = false;
    controller.abort(); held.resolve(grant());
    await expect(result).rejects.toMatchObject({ code: switchAccount ? 'upload_superseded' : 'upload_cancelled' });
    expect(s.options.put).not.toHaveBeenCalled();
    expect(calls(s.request).filter(c => c.method === 'DELETE')).toHaveLength(switchAccount ? 0 : 1);
    expect(calls(s.request).some(c => c.action === 'complete')).toBe(false);
});
test('cancel during PUT deletes exactly once', async () => {
    const s = setup(), controller = new AbortController();
    s.options.put.mockImplementationOnce(async () => { controller.abort(); throw Object.assign(new Error(), { name: 'AbortError' }); });
    await expect(uploadToPublish(s.api, file, { ...s.options, signal: controller.signal })).rejects.toMatchObject({ code: 'upload_cancelled' });
    expect(calls(s.request).filter(c => c.method === 'DELETE')).toHaveLength(1);
});
test.each([
    [503, 'uploads_not_open', null], [503, 'upload_admission_unavailable', 'admission'], [409, 'upload_budget_exceeded', 'error.upload_budget_exceeded'],
    [429, 'rate_limited', 'rate'], [0, 'network', 'offline'], [403, 'upload_url_expired', 'expired'], [404, 'upload_not_found', 'notFound'], [0, 'upload_cancelled', 'canceled'],
    [400, 'upload_type_not_allowed', 'error.upload_type_not_allowed'], [500, 'unknown', 'failed'], [0, 'upload_failed', 'failed'],
])('error %s %s maps safely', (status, code, key) => expect(publishUploadMessage(new ApiError(status as number, code as string))).toBe(key ? `publishUploads.${key}` : null));
test('offline and superseded are distinct', () => {
    expect(publishUploadMessage(new OfflineError())).toBe('publishUploads.offline');
    expect(publishUploadMessage(new ApiError(0, 'upload_superseded'))).toBeNull();
});
