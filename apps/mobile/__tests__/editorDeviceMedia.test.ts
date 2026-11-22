import type { CacheStorage } from '../src/lib/cache';
import type { ApiClient } from '../src/lib/api';
import { ApiError } from '../src/lib/api';
import { createEditorMediaStore, matchesMediaSignature } from '../src/lib/editorDeviceMedia';
import { fetchProject } from '../src/lib/projects';
import { getDocument } from '../src/lib/editorProjects';
import { emptyTimeline } from '../src/lib/nativeEditorModel';
const A = '11111111-1111-4111-8111-111111111111', B = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333', D = '44444444-4444-4444-8444-444444444444';
const mockNodes = new Map<string, { dir: boolean; size: number }>();
const mockDeleted: string[] = [];
const mockCopy = jest.fn(async (): Promise<number | undefined> => undefined);
const mockDigest = jest.fn(); const mockRead = jest.fn(); const mockOpen = jest.fn(); let mockSpace = 3e9;
let mockHeader = new Uint8Array(16);
jest.mock('../src/lib/appCache', () => ({ getCacheUser: () => '11111111-1111-4111-8111-111111111111', subscribeCacheUser: () => () => {}, userDocStorage: {} }));
jest.mock('expo-file-system', () => {
    const join = (parts: (string | { uri: string })[]) => parts.map(x => (typeof x === 'string' ? x : x.uri).replace(/\/+$/, '')).join('/');
    class Entry {
        uri: string;
        constructor(...parts: (string | { uri: string })[]) { this.uri = join(parts); }
        get name() { return this.uri.slice(this.uri.lastIndexOf('/') + 1); }
        get exists() { return mockNodes.has(this.uri); }
        get size() { return mockNodes.get(this.uri)?.size ?? 0; }
        delete() { mockDeleted.push(this.uri); for (const key of mockNodes.keys()) if (key === this.uri || key.startsWith(this.uri + '/')) mockNodes.delete(key); }
    }
    class Directory extends Entry {
        create() {
            let path = this.uri;
            while (path.length > 'file://'.length) { mockNodes.set(path, { dir: true, size: 0 }); path = path.slice(0, path.lastIndexOf('/')); }
        }
        list() {
            return [...mockNodes.entries()].filter(([key]) => key.startsWith(this.uri + '/') && !key.slice(this.uri.length + 1).includes('/'))
                .map(([key, n]) => n.dir ? new Directory(key) : new File(key));
        }
    }
    class File extends Entry {
        create() { mockNodes.set(this.uri, { dir: false, size: 0 }); }
        async copy(dest: File) {
            dest.create(); const size = await mockCopy(); mockNodes.set(dest.uri, { dir: false, size: size ?? this.size });
        }
        async move(dest: File) { mockNodes.set(dest.uri, mockNodes.get(this.uri)!); mockNodes.delete(this.uri); this.uri = dest.uri; }
        async digest() { return mockDigest(); }
        open() {
            mockOpen(this.uri); if (this.uri.startsWith('content://')) throw Error('pipe has no channel');
            const file = this;
            return { offset: 0, close: jest.fn(), async readBytes(n: number) {
                await mockRead(); const count = Math.min(n, file.size - this.offset); const result = mockHeader.slice(this.offset, this.offset + count);
                this.offset += count; return result;
            }, async writeBytes(bytes: Uint8Array) {
                this.offset += bytes.length; mockNodes.set(file.uri, { dir: false, size: this.offset });
            } };
        }
    }
    return { File, Directory, FileMode: { ReadOnly: 'r', WriteOnly: 'w' }, Paths: {
        document: new Directory('file:///app/Documents'), cache: new Directory('file:///app/Library/Caches'), get availableDiskSpace() { return mockSpace; },
    } };
});
function setup() {
    const data = new Map<string, string>();
    const storage: CacheStorage = { get: async key => data.get(key) ?? null, set: async (key, value) => { data.set(key, value); }, remove: async key => { data.delete(key); }, keys: async () => [...data.keys()] };
    return { data, storage, store: createEditorMediaStore(storage) };
}
const doc = (include: boolean) => ({ project_id: C, schema_version: 3 as const, timeline: { ...emptyTimeline(), media: include ? { [`l-${D}`]: { id: `l-${D}`, kind: 'video' } } : {} } });
beforeEach(() => { mockNodes.clear(); mockDeleted.length = 0; mockCopy.mockReset().mockResolvedValue(undefined); mockDigest.mockReset(); mockRead.mockReset();
    mockHeader = new Uint8Array(16); mockNodes.set('file://picked', { dir: false, size: 500 }); });
test('verified media signatures cover every pack media family and reject MIME forgery', () => {
    const bytes = (text: string) => Uint8Array.from([...text].map(value => value.charCodeAt(0)));
    expect(matchesMediaSignature('image/png', Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe(true);
    expect(matchesMediaSignature('image/jpeg', Uint8Array.from([0xff, 0xd8, 0xff]))).toBe(true);
    expect(matchesMediaSignature('image/webp', bytes('RIFF0000WEBP'))).toBe(true);
    expect(matchesMediaSignature('video/mp4', bytes('0000ftyp0000'))).toBe(true);
    expect(matchesMediaSignature('video/webm', Uint8Array.from([0x1a, 0x45, 0xdf, 0xa3]))).toBe(true);
    expect(matchesMediaSignature('audio/mpeg', bytes('ID3'))).toBe(true);
    expect(matchesMediaSignature('audio/wav', bytes('RIFF0000WAVE'))).toBe(true);
    expect(matchesMediaSignature('audio/ogg', bytes('OggS'))).toBe(true);
    expect(matchesMediaSignature('audio/mpeg', bytes('RIFF0000WAVE'))).toBe(false);
});
test('copy and hydration survive omitted media and restoring an older revision; owner changes erase old files', async () => {
    const s = setup(); await s.store.setOwner(A); const file = await s.store.copy(C, `l-${D}`, 'file://picked', 'video/mp4', 4);
    expect(file).toMatchObject({ size: 500, seconds: 4, verified: true });
    expect(await s.store.hydrate(C, doc(false))).toEqual({}); expect(s.data.size).toBe(1);
    expect(await s.store.hydrate(C, doc(true))).toEqual({ [`l-${D}`]: file!.file });
    await s.store.setOwner(B); expect(mockNodes.has(file!.file)).toBe(false); expect(s.data.size).toBe(0);
});
test('confirmed deletion removes only the target project', async () => {
    const s = setup(); await s.store.setOwner(A); const first = await s.store.copy(C, `l-${D}`, 'file://picked', 'video/mp4'); const second = await s.store.copy(B, `l-${D}`, 'file://picked', 'video/mp4');
    await s.store.removeProjectMedia(C); expect(mockNodes.has(first!.file)).toBe(false); expect(mockNodes.has(second!.file)).toBe(true); expect(s.data.size).toBe(1);
});
test('restored metadata resolves files under the current Documents root', async () => {
    const s = setup(); await s.store.setOwner(A);
    const file = await s.store.copy(C, `l-${D}`, 'file://picked', 'video/mp4', 4);
    const key = `editor-device-media.${A}.${C}`;
    const record = JSON.parse(s.data.get(key)!);
    record.items[`l-${D}`].file = file!.file.replace('file:///app/Documents', 'file:///old-container/Documents');
    s.data.set(key, JSON.stringify(record));
    const restart = createEditorMediaStore(s.storage); await restart.setOwner(A);
    expect(await restart.files(C)).toEqual({ [`l-${D}`]: file });
    expect(await restart.hydrate(C, doc(true))).toEqual({ [`l-${D}`]: file!.file });
    expect(mockDeleted).toEqual([]);
});
test('interrupted tombstone cleanup finishes on the next owner adoption', async () => {
    const s = setup(); await s.store.setOwner(A); const file = await s.store.copy(C, `l-${D}`, 'file://picked', 'video/mp4');
    s.data.set(`editor-device-media-delete.${A}.${C}`, JSON.stringify({ owner: A, projectId: C }));
    const restart = createEditorMediaStore(s.storage); await restart.setOwner(A); expect(mockNodes.has(file!.file)).toBe(false); expect(s.data.size).toBe(0);
});
test('project and document 404s never remove device files', async () => {
    const s = setup(); await s.store.setOwner(A); const file = await s.store.copy(C, `l-${D}`, 'file://picked', 'video/mp4');
    const api = { request: jest.fn().mockRejectedValue(new ApiError(404, 'unknown')) } as unknown as ApiClient;
    await fetchProject(api, C).catch(() => {}); await getDocument(api, C).catch(() => {});
    expect(mockNodes.has(file!.file)).toBe(true); expect(s.data.size).toBe(1); expect(await s.store.hydrate(C, doc(true))).toHaveProperty(`l-${D}`);
});
test('404 quietly disables backup for this owner for the app run', async () => {
    const s = setup(); await s.store.setOwner(A); const file = await s.store.copy(C, `l-${D}`, 'file://picked', 'video/mp4');
    const request = jest.fn().mockRejectedValue(new ApiError(404, 'unknown')); const api = { request } as unknown as ApiClient;
    expect(await s.store.backup(api, C, `l-${D}`, file!)).toBeNull(); expect(await s.store.backup(api, C, `l-${D}`, file!)).toBeNull(); expect(request).toHaveBeenCalledTimes(1);
    await s.store.setOwner(B); await s.store.backup(api, C, `l-${D}`, file!); expect(request).toHaveBeenCalledTimes(2);
});
test('backup inspects a successful PUT and uses a stable media idempotency key', async () => {
    const s = setup(); await s.store.setOwner(A); const file = await s.store.copy(C, `l-${D}`, 'file://picked', 'video/mp4');
    const request = jest.fn().mockResolvedValueOnce({ asset_id: B, upload_url: 'https://put.test', content_type: 'video/mp4' }).mockResolvedValueOnce({ state: 'inspected' }); const put = jest.fn().mockResolvedValue(undefined);
    expect(await s.store.backup({ request } as unknown as ApiClient, C, `l-${D}`, file!, put)).toEqual({ projectId: C, assetId: B });
    expect(request.mock.calls[0][1].headers['Idempotency-Key']).toBe(`edm-${D}`); expect(request.mock.calls[1][0]).toContain(`/${B}/inspect`);
});
test('a late copy cannot write after owner change', async () => {
    const s = setup(); await s.store.setOwner(A); let finish!: () => void;
    mockCopy.mockImplementationOnce(() => new Promise(resolve => { finish = () => resolve(undefined); }));
    const copy = s.store.copy(C, `l-${D}`, 'file://picked', 'video/mp4'); await Promise.resolve(); await Promise.resolve();
    const change = s.store.setOwner(B); finish(); expect(await copy).toBeNull(); await change; expect(s.data.size).toBe(0);
});
test('verified pack copy checks the durable signature and sha before publishing', async () => {
    const s = setup(); await s.store.setOwner(A); mockHeader.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const hash = 'a'.repeat(64); mockDigest.mockResolvedValue(hash); const progress = jest.fn();
    const file = await s.store.copy(C, `l-${D}`, 'file://picked', 'image/png', null, { expectedKind: 'image', expectedSha256: hash, onProgress: progress });
    expect(file).toMatchObject({ type: 'image/png', size: 500 }); expect(progress.mock.calls.map(call => call[0])).toEqual(['copying', 'verifying']);
    expect([...mockNodes.keys()].some(path => path.endsWith('.pending'))).toBe(false); expect(s.data.size).toBe(1);
});
test('verified pack copy rejects a forged fingerprint and remove discards unpublished project media', async () => {
    const s = setup(); await s.store.setOwner(A); mockHeader.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    mockDigest.mockResolvedValue('b'.repeat(64));
    expect(await s.store.copy(C, `l-${D}`, 'file://picked', 'image/png', null, { expectedKind: 'image', expectedSha256: 'a'.repeat(64) })).toBeNull();
    expect([...mockNodes.keys()].some(path => path.includes(`l-${D}`))).toBe(false); expect(s.data.size).toBe(0);
    mockDigest.mockResolvedValue('a'.repeat(64)); const file = await s.store.copy(C, `l-${D}`, 'file://picked', 'image/png', null,
        { expectedKind: 'image', expectedSha256: 'a'.repeat(64) });
    expect(file).not.toBeNull(); await s.store.remove(C, `l-${D}`); expect(mockNodes.has(file!.file)).toBe(false);
    expect(JSON.parse(s.data.get(`editor-device-media.${A}.${C}`)!).items).toEqual({});
});
