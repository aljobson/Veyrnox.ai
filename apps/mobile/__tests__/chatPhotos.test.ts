import type { ApiClient } from '../src/lib/api';
import type { PutFile } from '../src/lib/uploads';

jest.mock('expo-image-picker', () => ({ launchImageLibraryAsync: jest.fn() }));
jest.mock('expo-file-system', () => ({ File: class { size = 0; } }));
jest.mock('../src/lib/chatVideoFrames', () => ({ extractFrames: jest.fn() }));

// eslint-disable-next-line import/first -- the native modules above must be mocked before this loads
import { uploadChatImages } from '../src/lib/chatPhotos';

const grant = { key: 'uploads/u/1.jpg', upload_url: 'https://r2.example/put?sig=1', content_type: 'image/jpeg' };

function fakeApi(): { api: ApiClient; bodies: unknown[] } {
    const bodies: unknown[] = [];
    const api = {
        request: async (_path: string, init: RequestInit) => {
            bodies.push(JSON.parse(init.body as string));
            return grant;
        },
    } as unknown as ApiClient;
    return { api, bodies };
}

describe('uploadChatImages', () => {
    test('declares the byte size of each prepared file, which the upload route requires', async () => {
        const { api, bodies } = fakeApi();
        const put = jest.fn<ReturnType<PutFile>, Parameters<PutFile>>(async () => undefined);
        const sizes: Record<string, number> = { 'file:///a.jpg': 1234, 'file:///b.jpg': 5678 };

        const keys = await uploadChatImages(api, [{ id: 'a', uri: 'file:///a.jpg' }, { id: 'b', uri: 'file:///b.jpg' }],
            new AbortController().signal, 'image/jpeg', { sizeOf: (uri) => sizes[uri], put });

        expect(keys).toEqual([grant.key, grant.key]);
        expect(bodies).toEqual([
            { content_type: 'image/jpeg', size_bytes: 1234 },
            { content_type: 'image/jpeg', size_bytes: 5678 },
        ]);
        expect(put.mock.calls.map((c) => c[2])).toEqual(['file:///a.jpg', 'file:///b.jpg']);
    });

    test('refuses a file it cannot measure before asking for an upload', async () => {
        const { api, bodies } = fakeApi();
        const put = jest.fn<ReturnType<PutFile>, Parameters<PutFile>>(async () => undefined);

        await expect(uploadChatImages(api, [{ id: 'a', uri: 'file:///gone.jpg' }], new AbortController().signal, 'image/jpeg',
            { sizeOf: () => 0, put })).rejects.toThrow();
        expect(bodies).toEqual([]);
        expect(put).not.toHaveBeenCalled();
    });
});
