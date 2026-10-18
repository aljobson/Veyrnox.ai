import { ApiError, type ApiClient } from '../src/lib/api';
import { uploadMessage, uploadSource, type PutFile } from '../src/lib/uploads';

const grant = { key: 'uploads/u/1.jpg', upload_url: 'https://r2.example/put?sig=1', content_type: 'image/jpeg', max_bytes: 20_000_000, expires_in: 900 };

function fakeApi(result: unknown): { api: ApiClient; calls: { path: string; init: RequestInit }[] } {
    const calls: { path: string; init: RequestInit }[] = [];
    const api = {
        request: async (path: string, init: RequestInit) => {
            calls.push({ path, init });
            if (result instanceof Error) throw result;
            return result;
        },
    } as unknown as ApiClient;
    return { api, calls };
}

describe('uploadSource', () => {
    test('asks for a presigned URL with the type and size, then sends the file and returns the key', async () => {
        const { api, calls } = fakeApi(grant);
        const put = jest.fn<ReturnType<PutFile>, Parameters<PutFile>>(async (_url, _headers, _uri, onProgress) => onProgress(1));
        const progress: number[] = [];
        const key = await uploadSource(api, { uri: 'file:///a.jpg', size: 1234 }, 'image/jpeg', (f) => progress.push(f), new AbortController().signal, put);

        expect(key).toBe('uploads/u/1.jpg');
        expect(calls[0].path).toBe('/api/v1/uploads');
        expect(JSON.parse(calls[0].init.body as string)).toEqual({ content_type: 'image/jpeg', size_bytes: 1234 });
        expect(put.mock.calls[0][0]).toBe(grant.upload_url);
        expect(put.mock.calls[0][1]).toEqual({ 'Content-Type': 'image/jpeg' });
        expect(put.mock.calls[0][2]).toBe('file:///a.jpg');
        expect(progress).toEqual([1]);
    });

    test('sends the extra headers the server signed into the URL', async () => {
        const { api } = fakeApi({ ...grant, headers: { 'x-amz-meta-size': '1234' } });
        const put = jest.fn<ReturnType<PutFile>, Parameters<PutFile>>(async () => undefined);
        await uploadSource(api, { uri: 'file:///a.jpg', size: 1234 }, 'image/jpeg', () => undefined, new AbortController().signal, put);
        expect(put.mock.calls[0][1]).toEqual({ 'Content-Type': 'image/jpeg', 'x-amz-meta-size': '1234' });
    });

    test('does not send anything when the server refuses the claim', async () => {
        const { api } = fakeApi(new ApiError(400, 'upload_too_large'));
        const put = jest.fn<ReturnType<PutFile>, Parameters<PutFile>>(async () => undefined);
        await expect(uploadSource(api, { uri: 'file:///a.jpg', size: 1 }, 'image/jpeg', () => undefined, new AbortController().signal, put)).rejects.toMatchObject({ code: 'upload_too_large' });
        expect(put).not.toHaveBeenCalled();
    });

    test('a failed send becomes upload_failed', async () => {
        const { api } = fakeApi(grant);
        const put: PutFile = async () => {
            throw new Error('socket closed');
        };
        await expect(uploadSource(api, { uri: 'file:///a.jpg', size: 1 }, 'image/jpeg', () => undefined, new AbortController().signal, put)).rejects.toMatchObject({ code: 'upload_failed' });
    });

    test('an aborted upload is reported as cancelled, not as a failure', async () => {
        const { api } = fakeApi(grant);
        const controller = new AbortController();
        const put: PutFile = async () => {
            controller.abort();
            throw new Error('aborted');
        };
        await expect(uploadSource(api, { uri: 'file:///a.jpg', size: 1 }, 'image/jpeg', () => undefined, controller.signal, put)).rejects.toMatchObject({ code: 'upload_cancelled' });
    });
});

describe('uploadMessage', () => {
    test('turns server codes into plain advice', () => {
        expect(uploadMessage(new ApiError(402, 'insufficient_credits'))).toMatch(/credits/);
        expect(uploadMessage(new ApiError(429, 'too_many_pending_uploads'))).toMatch(/wait/i);
        expect(uploadMessage(new ApiError(400, 'upload_too_large'))).toMatch(/too large/i);
        expect(uploadMessage(new ApiError(0, 'network'))).toMatch(/connection/i);
        expect(uploadMessage(new ApiError(500, 'something_else'))).toMatch(/could not upload/i);
        expect(uploadMessage(new Error('x'))).toMatch(/could not upload/i);
    });
});
