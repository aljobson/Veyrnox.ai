import { ApiError, type ApiClient } from '../src/lib/api';
import { uploadExportFiles, type ExportFile, type UploadedFile } from '../src/lib/editorServerExportUploads';
const A = '11111111-1111-4111-8111-111111111111', B = '22222222-2222-4222-8222-222222222222';
jest.mock('../src/lib/appCache', () => ({ getCacheUser: () => '11111111-1111-4111-8111-111111111111' }));
const grant = () => ({ key: `uploads/${A}/${B}.mp4`, upload_url: 'https://upload.test', content_type: 'video/mp4', headers: { 'Content-Type': 'video/mp4' }, reserved: true, expires_in: 1 });
const file: ExportFile = { id: `l-${B}`, file: 'file://durable', size: 100, type: 'video/mp4' };
function setup() {
    const request = jest.fn().mockResolvedValue(grant()), put = jest.fn().mockResolvedValue(undefined), cache = new Map<string, UploadedFile>(), controller = new AbortController(); let time = 0;
    return { request, put, cache, controller, time: (value: number) => { time = value; }, run: (files = [file]) => uploadExportFiles({ request } as unknown as ApiClient, files, cache, controller.signal, () => time, put) };
}
test.each([{ key: `uploads/${B}/${B}.mp4` }, { content_type: 'audio/mpeg' }, { reserved: false }])('refuses unsafe grant %s', async patch => {
    const s = setup(); s.request.mockResolvedValue({ ...grant(), ...patch }); await expect(s.run()).rejects.toMatchObject({ code: 'upload_invalid_grant' }); expect(s.put).not.toHaveBeenCalled();
});
test('batch fields describe remaining files and completed files are reused', async () => {
    const s = setup(); await s.run([file, { ...file, id: 'second', size: 50 }]);
    expect(JSON.parse(s.request.mock.calls[0][1].body)).toEqual({ content_type: 'video/mp4', size_bytes: 100, batch_count: 2, batch_bytes: 150 });
    expect(JSON.parse(s.request.mock.calls[1][1].body)).toMatchObject({ batch_count: 1, batch_bytes: 50 });
    await s.run(); expect(s.put).toHaveBeenCalledTimes(2);
});
test('412 is accepted as possibly stored', async () => {
    const s = setup(); s.put.mockRejectedValue(new ApiError(412, 'upload_failed')); expect((await s.run()).get(file.id)).toBe(`u-${B}`);
});
test('403 after expiry obtains a new grant', async () => {
    const s = setup(); s.put.mockImplementationOnce(async () => { s.time(2000); throw new ApiError(403, 'upload_url_expired'); });
    await s.run(); expect(s.request).toHaveBeenCalledTimes(2); expect(s.put).toHaveBeenCalledTimes(2);
});
test('network errors try three times with the same grant', async () => {
    const s = setup(); s.put.mockRejectedValue(new ApiError(0, 'upload_failed')); await expect(s.run()).rejects.toMatchObject({ code: 'upload_failed' }); expect(s.put).toHaveBeenCalledTimes(3); expect(s.request).toHaveBeenCalledTimes(1);
});
test('cancel aborts an active file and preserves completed cache entries', async () => {
    const s = setup(); s.put.mockImplementationOnce(async () => { s.controller.abort(); throw new ApiError(0, 'upload_cancelled'); });
    await expect(s.run()).rejects.toMatchObject({ code: 'upload_cancelled' }); expect(s.put).toHaveBeenCalledTimes(1);
});
test('MOV is refused before requesting a grant', async () => {
    const s = setup(); await expect(s.run([{ ...file, type: 'video/quicktime' }])).rejects.toMatchObject({ code: 'localType' }); expect(s.request).not.toHaveBeenCalled();
});
