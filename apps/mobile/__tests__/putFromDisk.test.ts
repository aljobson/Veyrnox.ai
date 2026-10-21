import { putFromDisk } from '../src/lib/uploads';
const mockRelease = jest.fn(), mockUpload = jest.fn(), mockTask = jest.fn();
jest.mock('expo-file-system', () => ({
    File: class { uri: string; constructor(uri: string) { this.uri = uri; } }, UploadType: { BINARY_CONTENT: 0 },
    UploadTask: class { constructor(...args: unknown[]) { mockTask(...args); } uploadAsync = mockUpload; release = mockRelease; },
}));
beforeEach(() => { jest.clearAllMocks(); mockUpload.mockResolvedValue({ status: 200 }); });
const run = (signal = new AbortController().signal, progress = jest.fn()) => putFromDisk('https://a.r2.cloudflarestorage.com/x', { 'Content-Type': 'image/jpeg', 'If-None-Match': '*', 'cOnTeNt-LeNgTh': '123' }, 'file:///cache/photo', progress, signal);
test('native background binary PUT from disk, no Content-Length, progress fractions and release', async () => {
    const progress = jest.fn(); await run(undefined, progress);
    const [file, , options] = mockTask.mock.calls[0];
    expect(file.uri).toBe('file:///cache/photo');
    expect(options).toMatchObject({ httpMethod: 'PUT', uploadType: 0, sessionType: 'background', headers: { 'Content-Type': 'image/jpeg', 'If-None-Match': '*' } });
    expect(Object.keys(options.headers)).toHaveLength(2);
    options.onProgress({ bytesSent: 5, totalBytes: 10 }); expect(progress).toHaveBeenCalledWith(0.5);
    expect(mockRelease).toHaveBeenCalledTimes(1);
});
test.each([[403, 'upload_url_expired'], [412, 'upload_failed'], [400, 'upload_failed'], [500, 'upload_failed']])('status %s maps to %s and releases', async (status, code) => {
    mockUpload.mockResolvedValue({ status }); await expect(run()).rejects.toMatchObject({ code }); expect(mockRelease).toHaveBeenCalledTimes(1);
});
test('network rejection releases and maps to failed', async () => {
    mockUpload.mockRejectedValue(new Error('network')); await expect(run()).rejects.toMatchObject({ code: 'upload_failed' }); expect(mockRelease).toHaveBeenCalledTimes(1);
});
test('native AbortError maps to cancelled and releases', async () => {
    mockUpload.mockRejectedValue(Object.assign(new Error(), { name: 'AbortError' }));
    await expect(run()).rejects.toMatchObject({ code: 'upload_cancelled' }); expect(mockRelease).toHaveBeenCalledTimes(1);
});
