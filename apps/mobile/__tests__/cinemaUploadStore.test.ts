import type { UploadRecord } from '../src/lib/cinemaUploadStore';
const A = '11111111-1111-4111-8111-111111111111', B = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333', D = '44444444-4444-4444-8444-444444444444';
const mockNodes = new Map<string, { dir: boolean; size: number }>();
const mockDeleted: string[] = [];
let mockOS = 'android', mockSpace = 3e9, mockCounter = 10;
const mockCopy = jest.fn(async (): Promise<number | undefined> => undefined);
const mockDigest = jest.fn(async () => 'a'.repeat(64));
const mockRead = jest.fn(async (): Promise<void> => undefined);
const mockOpen = jest.fn();
const mockPicker = jest.fn();
jest.mock('expo-crypto', () => ({ randomUUID: () => `55555555-5555-4555-8555-${String(mockCounter++).padStart(12, '0')}` }));
jest.mock('expo-document-picker', () => ({ getDocumentAsync: (...args: unknown[]) => mockPicker(...args) }));
jest.mock('react-native', () => ({ Platform: { get OS() { return mockOS; } } }));
jest.mock('../src/lib/appCache', () => ({ appStorage: {}, getCacheUser: () => undefined, subscribeCacheUser: () => () => undefined }));
jest.mock('expo-file-system', () => {
    const join = (parts: Array<string | { uri: string }>) => parts.map(x => (typeof x === 'string' ? x : x.uri).replace(/\/+$/, '')).join('/');
    class Entry {
        uri: string;
        constructor(...parts: Array<string | { uri: string }>) { this.uri = join(parts); }
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
                await mockRead(); const count = Math.min(n, file.size - this.offset); this.offset += count; return new Uint8Array(count);
            }, async writeBytes(bytes: Uint8Array) {
                this.offset += bytes.length; mockNodes.set(file.uri, { dir: false, size: this.offset });
            } };
        }
    }
    return { File, Directory, FileMode: { ReadOnly: 'r', WriteOnly: 'w' }, Paths: {
        cache: new Directory('file:///app/Library/Caches'), get availableDiskSpace() { return mockSpace; },
    } };
});
import { File, Directory, Paths } from 'expo-file-system';
import { createMemoryStorage } from '../src/lib/cache';
import { ApiError } from '../src/lib/api';
process.env.EXPO_PUBLIC_CINEMA_DEVICE_UPLOAD_ENABLED = 'true';
const { createUploadStore, discardPicked } = require('../src/lib/cinemaUploadStore') as typeof import('../src/lib/cinemaUploadStore');
const { runTransfer, UPLOAD_CHUNK_BYTES: CHUNK } = require('../src/lib/cinemaUpload') as typeof import('../src/lib/cinemaUpload');
const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { resolve, promise }; };
const settle = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
const folder = (owner = A, content = C) => new Directory(Paths.cache, 'veyrnox-cinema-upload', owner, content);
const savedRecord = (contentId = C): UploadRecord => ({ contentId, uploadId: null, size: 10, fingerprint: 'a'.repeat(64), staged: `${D}.mp4`, offset: 0, startKey: D, pausedByUser: true });
function asset(uri = 'content://provider/video', size = 10, mimeType = 'video/mp4') {
    mockNodes.set(uri, { dir: false, size });
    mockPicker.mockResolvedValue({ canceled: false, assets: [{ uri, size, mimeType, name: 'never-store-original-name.mp4' }] });
}
async function fixture(now = Date.now) { const storage = createMemoryStorage(), store = createUploadStore(storage, now); await store.setOwner(A); return { storage, store, ticket: store.ticket() }; }
beforeEach(() => {
    mockNodes.clear(); mockDeleted.length = 0; mockOS = 'android'; mockSpace = 3e9;
    jest.clearAllMocks(); mockCopy.mockReset().mockResolvedValue(undefined); mockDigest.mockReset().mockResolvedValue('a'.repeat(64)); mockRead.mockReset().mockResolvedValue(undefined);
    asset();
});
test('Android pipe-backed provider uses native copy, never source.open; writes exact resume record', async () => {
    const f = await fixture(), record = await f.store.pick(f.ticket, C);
    expect(record).toMatchObject({ contentId: C, size: 10, fingerprint: 'a'.repeat(64) }); expect(mockOpen).not.toHaveBeenCalled();
    expect(mockPicker).toHaveBeenCalledWith({ type: ['video/mp4', 'video/quicktime', 'video/webm'], copyToCacheDirectory: false });
    expect(await f.store.read(f.ticket, C)).toEqual(record);
    expect(Object.keys(record!).sort()).toEqual(['contentId', 'uploadId', 'size', 'fingerprint', 'staged', 'offset', 'startKey', 'pausedByUser'].sort());
    expect(JSON.stringify(await f.storage.get((await f.storage.keys())[0]))).not.toContain('never-store');
});
test('Android rejected copy and mismatched length delete partials and write no record', async () => {
    for (const mismatch of [false, true]) {
        const f = await fixture(); if (mismatch) mockCopy.mockResolvedValueOnce(9); else mockCopy.mockRejectedValueOnce(Error('provider failed'));
        await expect(f.store.pick(f.ticket, C)).rejects.toMatchObject({ code: 'unreadable_video' });
        expect(await f.store.read(f.ticket, C)).toBeNull(); expect([...mockNodes.keys()].some(x => x.includes('.partial-'))).toBe(false);
    }
});
test('Android copy resolving after owner change deletes its partial', async () => {
    const f = await fixture(), copy = deferred<number | undefined>(); mockCopy.mockImplementationOnce(() => copy.promise);
    const pick = f.store.pick(f.ticket, C); await settle(); await f.store.setOwner(B); copy.resolve(10);
    expect(await pick).toBeNull(); expect([...mockNodes.keys()].some(x => x.includes('.partial-'))).toBe(false); expect(await f.storage.keys()).toEqual([]);
});
test('iOS copies in blocks and cleans its tmp import on success', async () => {
    mockOS = 'ios'; asset('file:///app/tmp/com.veyrnox-Inbox/video.mp4', CHUNK * 2 + 3);
    const f = await fixture(); await f.store.pick(f.ticket, C);
    expect(mockCopy).not.toHaveBeenCalled(); expect(mockRead).toHaveBeenCalledTimes(3);
    expect(mockDeleted).toContain('file:///app/tmp/com.veyrnox-Inbox/video.mp4');
});
test('iOS failed copy after two blocks deletes partial and import', async () => {
    mockOS = 'ios'; asset('file:///app/tmp/Inbox/video.mp4', CHUNK * 3);
    mockRead.mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined).mockRejectedValueOnce(Error('disk full'));
    const f = await fixture(); await expect(f.store.pick(f.ticket, C)).rejects.toBeInstanceOf(ApiError);
    expect([...mockNodes.keys()].some(x => x.includes('.partial-'))).toBe(false); expect(mockDeleted).toContain('file:///app/tmp/Inbox/video.mp4');
});
test('iOS checks account ticket after every block', async () => {
    mockOS = 'ios'; asset('file:///app/tmp/Inbox/video.mp4', CHUNK * 3);
    const read = deferred<void>(); mockRead.mockImplementationOnce(() => read.promise);
    const f = await fixture(), pick = f.store.pick(f.ticket, C); await settle(); await f.store.setOwner(B); read.resolve();
    expect(await pick).toBeNull(); expect(mockRead).toHaveBeenCalledTimes(1); expect([...mockNodes.keys()].some(x => x.includes('.partial-'))).toBe(false);
});
test('disk check rejects before opening or copying the source', async () => {
    mockSpace = 100 * 1024 * 1024 + 9;
    const f = await fixture(); await expect(f.store.pick(f.ticket, C)).rejects.toMatchObject({ code: 'no_space' }); expect(mockOpen).not.toHaveBeenCalled(); expect(mockCopy).not.toHaveBeenCalled();
});
test.each([{ mimeType: 'text/plain', size: 10 }, { mimeType: 'video/mp4', size: 0 }, { mimeType: 'video/mp4', size: 2147483649 }])('rejects %j and discards iOS temporary', async ({ mimeType, size }) => {
    mockOS = 'ios'; asset('file:///app/tmp/Inbox/video.mp4', size, mimeType);
    const f = await fixture(); await expect(f.store.pick(f.ticket, C)).rejects.toMatchObject({ code: 'invalid_video' }); expect(mockDeleted).toContain('file:///app/tmp/Inbox/video.mp4');
});
test('known duration over ten minutes is rejected', async () => {
    mockPicker.mockResolvedValueOnce({ canceled: false, assets: [{ uri: 'content://provider/video', size: 10, mimeType: 'video/mp4', duration: 601 }] });
    const f = await fixture(); await expect(f.store.pick(f.ticket, C)).rejects.toMatchObject({ code: 'invalid_video' }); expect(mockCopy).not.toHaveBeenCalled();
});
test('digest failure deletes the copy and iOS import', async () => {
    mockOS = 'ios'; asset('file:///app/tmp/Inbox/video.mp4'); mockDigest.mockRejectedValueOnce(Error('hash'));
    const f = await fixture(); await expect(f.store.pick(f.ticket, C)).rejects.toMatchObject({ code: 'unreadable_video' }); expect(folder().list()).toEqual([]); expect(mockDeleted).toContain('file:///app/tmp/Inbox/video.mp4');
});
test('late picker result deletes only its own iOS import and creates no old account directory', async () => {
    mockOS = 'ios'; const picker = deferred<unknown>(); mockPicker.mockReturnValueOnce(picker.promise);
    const f = await fixture(), pick = f.store.pick(f.ticket, C); await f.store.setOwner(B);
    const uri = 'file:///app/tmp/Inbox/late.mp4'; mockNodes.set(uri, { dir: false, size: 10 });
    picker.resolve({ canceled: false, assets: [{ uri, size: 10, mimeType: 'video/mp4' }] });
    expect(await pick).toBeNull(); expect(mockDeleted).toContain(uri); expect(folder().exists).toBe(false);
});
test.each([false, true])('digest survives same owner refresh, but not a real owner change: change=%s', async change => {
    const f = await fixture(), digest = deferred<string>(); mockDigest.mockImplementationOnce(() => digest.promise);
    const pick = f.store.pick(f.ticket, C); await settle(); await f.store.setOwner(change ? B : A); digest.resolve('a'.repeat(64));
    const result = await pick; expect(!!result).toBe(!change);
    if (change) expect(await f.storage.keys()).toEqual([]); else expect(await f.store.read(f.ticket, C)).toEqual(result);
});
test('sign out and account change remove records and staged directories', async () => {
    for (const next of [null, B]) {
        const f = await fixture(); await f.store.pick(f.ticket, C); expect(folder().exists).toBe(true);
        await f.store.setOwner(next); expect(folder().exists).toBe(false); expect(await f.storage.keys()).toEqual([]);
        await f.store.save(f.ticket, savedRecord()); expect(await f.storage.keys()).toEqual([]);
    }
});
test('late storage write is removed before owner cleanup finishes', async () => {
    const f = await fixture(), held = deferred<void>(), set = f.storage.set;
    f.storage.set = async (key, value) => { await held.promise; await set(key, value); };
    const save = f.store.save(f.ticket, savedRecord()); await settle(); const change = f.store.setOwner(B); held.resolve();
    await Promise.all([save, change]); expect(await f.storage.keys()).toEqual([]);
});
test('two title slots remain independent and runner has one lease per account', async () => {
    const f = await fixture(), a = await f.store.pick(f.ticket, C); const release = f.store.acquire(f.ticket, C)!;
    expect(f.store.acquire(f.ticket, D)).toBeNull(); release();
    const b = await f.store.pick(f.ticket, D); expect(await f.store.read(f.ticket, C)).toEqual(a);
    expect(new File(folder(), a!.staged).exists).toBe(true); expect(await f.store.read(f.ticket, D)).toEqual(b);
});
test('reconcile removes expired, orphaned and partial files but keeps a valid file and preparing folder', async () => {
    let now = 1000; const f = await fixture(() => now), record = savedRecord();
    folder().create({ intermediates: true }); new File(folder(), record.staged).create(); await f.store.save(f.ticket, record);
    new File(folder(), '.partial-stray').create();
    const orphan = folder(A, D); orphan.create(); new File(orphan, 'orphan.mp4').create();
    const preparing = folder(A, B); preparing.create(); new File(preparing, '.partial-live').create(); f.store.preparing.add(B);
    await f.store.reconcileStaged(f.ticket);
    expect(new File(folder(), record.staged).exists).toBe(true); expect(orphan.exists).toBe(false); expect(new File(preparing, '.partial-live').exists).toBe(true);
    expect(new File(folder(), '.partial-stray').exists).toBe(false);
    now += 86400001; await f.store.reconcileStaged(f.ticket); expect(folder().exists).toBe(false);
});
test('fresh store recovers crashes before rename and before record write', async () => {
    for (const name of ['.partial-crash', `${D}.mp4`]) {
        folder().create({ intermediates: true }); new File(folder(), name).create();
        await createUploadStore(createMemoryStorage()).setOwner(A); expect(folder().exists).toBe(false);
    }
});
test('missing staged copy can only be replaced with identical size and hash; preserves startKey', async () => {
    const f = await fixture(), original = (await f.store.pick(f.ticket, C))!;
    new File(folder(), original.staged).delete(); expect(await f.store.verify(f.ticket, original)).toBe(false);
    mockDigest.mockResolvedValueOnce('b'.repeat(64)); await expect(f.store.pick(f.ticket, C, original)).rejects.toMatchObject({ code: 'same_video_required' });
    expect(await f.store.read(f.ticket, C)).toEqual(original);
    expect(await f.store.pick(f.ticket, C, original)).toMatchObject({ startKey: original.startKey, fingerprint: original.fingerprint });
});
test('never deletes originals or another feature’s shared picker cache', async () => {
    mockOS = 'ios';
    const others = ['file:///app/Library/Caches/DocumentPicker/other.pdf', 'file:///outside/original.mp4', 'content://provider/video'];
    for (const uri of others) { mockNodes.set(uri, { dir: false, size: 10 }); discardPicked(uri); expect(mockNodes.has(uri)).toBe(true); }
    const f = await fixture(); asset('file:///app/tmp/Inbox/video.mp4'); await f.store.pick(f.ticket, C); await f.store.setOwner(null);
    for (const uri of others) expect(mockNodes.has(uri)).toBe(true);
});
test.each(['refresh', '401', 'change'])('in-flight PATCH fence with %s', async mode => {
    const f = await fixture(), record = (await f.store.pick(f.ticket, C))!, part = deferred<Response>();
    record.size = CHUNK + 1; record.uploadId = D;
    let offset = 0;
    const stream = jest.fn(async (_path: string, init?: RequestInit) => {
        if (mode === '401') await f.store.setOwner(A); // ApiClient adopts the same owner on its refresh retry.
        if (offset === 0) { offset = CHUNK; return part.promise; }
        return { ok: true, json: async () => ({ offset: CHUNK + 1, length: record.size }) } as Response;
    });
    const request = jest.fn(async (path: string): Promise<any> => path.includes('/transfer?') ? { offset: 0, length: record.size } : {
        upload: { id: D, content_id: C, state: 'uploading', fingerprint: record.fingerprint, transfer_path: `/cinema/uploads/${D}/transfer?content_id=${C}` },
    });
    const save = jest.fn((r: UploadRecord) => f.store.save(f.ticket, r));
    const run = runTransfer({ record, api: { request, stream }, live: () => f.store.live(f.ticket), stopped: () => false,
        file: { offset: 0, readBytes: async n => new Uint8Array(n) }, save, clear: async () => undefined, refresh: async () => undefined, sleep: async () => undefined });
    await settle(); save.mockClear(); await f.store.setOwner(mode === 'change' ? B : A);
    part.resolve({ ok: true, json: async () => ({ offset: CHUNK, length: record.size }) } as Response);
    expect(await run).toBe(mode === 'change' ? 'stale' : 'complete');
    expect(stream).toHaveBeenCalledTimes(mode === 'change' ? 1 : 2); expect(save).toHaveBeenCalledTimes(mode === 'change' ? 0 : 2);
});
