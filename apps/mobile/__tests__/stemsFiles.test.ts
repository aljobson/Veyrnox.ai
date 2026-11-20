import { Directory, File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { shareStemFile, StemFileError, sweepStemFiles } from '../src/lib/music/stemFiles';

const mockEntries = new Map<string, { time: number | undefined; creationTime?: number; size?: number; content?: string }>();
let mockUuid = 0;
const mockDelete = jest.fn();
const mockSize = jest.fn();
jest.mock('expo-crypto', () => ({ randomUUID: () => `00000000-0000-4000-8000-${String(++mockUuid).padStart(12, '0')}` }));
jest.mock('expo-sharing', () => ({ isAvailableAsync: jest.fn(), shareAsync: jest.fn() }));
jest.mock('expo-file-system', () => {
    class Directory {
        uri: string;
        constructor(...parts: any[]) { this.uri = parts.map(p => typeof p === 'string' ? p : p.uri).join('/').replace(/\/+$/, ''); }
        get exists() { return mockEntries.has(this.uri); }
        create() {
            if (this.exists) throw Error('exists');
            mockEntries.set(this.uri, { time: Date.now() });
            mockEntries.set(this.uri.slice(0, this.uri.lastIndexOf('/')), { time: Date.now() });
        }
        info() { return { modificationTime: mockEntries.get(this.uri)?.time, creationTime: mockEntries.get(this.uri)?.creationTime }; }
        list() {
            return [...mockEntries.keys()].filter(uri => uri.startsWith(`${this.uri}/`) && !uri.slice(this.uri.length + 1).includes('/'))
                .map(uri => mockEntries.get(uri)?.size === undefined ? new Directory(uri) : new File(uri));
        }
        delete() {
            mockDelete(this.uri);
            for (const uri of mockEntries.keys()) if (uri === this.uri || uri.startsWith(`${this.uri}/`)) mockEntries.delete(uri);
        }
    }
    class File {
        uri: string;
        constructor(...parts: any[]) { this.uri = parts.map(p => typeof p === 'string' ? p : p.uri).join('/'); }
        get size() { mockSize(); return mockEntries.get(this.uri)?.size; }
        get modificationTime() { return mockEntries.get(this.uri)?.time; }
        create() { mockEntries.set(this.uri, { time: Date.now(), size: 0, content: '' }); }
        writeSync(content: string) {
            if (!mockEntries.has(this.uri)) throw Error('missing file');
            mockEntries.set(this.uri, { time: Date.now(), size: content.length, content });
        }
        textSync() {
            const content = mockEntries.get(this.uri)?.content;
            if (content === undefined) throw Error('missing file');
            return content;
        }
        static downloadFileAsync = jest.fn();
    }
    return { Directory, File, Paths: { cache: 'file:///cache' } };
});
const deferred = <T,>() => {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(done => { resolve = done; });
    return { resolve, promise };
};
const input = {
    url: 'https://signed.test/private?token=secret', mimeType: 'application/zip', sizeBytes: 42,
    requestId: '11111111-2222-4333-8444-555555555555', kind: 'archive' as const, isCurrent: () => true,
};
const root = 'file:///cache/veyrnox-stem-share';
const download = jest.mocked(File.downloadFileAsync), available = jest.mocked(Sharing.isAvailableAsync), share = jest.mocked(Sharing.shareAsync);
const persist = (destination: File | Directory, size = 42) => {
    mockEntries.set(destination.uri, { size, time: Date.now() });
    return new File(destination.uri);
};
beforeEach(() => {
    jest.clearAllMocks(); mockEntries.clear(); mockUuid = 0; mockSize.mockReset();
    download.mockReset().mockImplementation(async (_url, dest) => persist(dest));
    available.mockReset().mockResolvedValue(true); share.mockReset().mockResolvedValue();
});
test('downloads, verifies size and availability, shares with MIME and UTI, and retains the attachment on cancel/completion', async () => {
    await shareStemFile(input);
    const file = download.mock.calls[0][1];
    expect(file.uri).toBe(`${root}/00000000-0000-4000-8000-000000000001/veyrnox-${input.requestId}-archive.zip`);
    expect(download).toHaveBeenCalledWith(input.url, expect.any(File), { idempotent: true });
    expect(share).toHaveBeenCalledWith(file.uri, { mimeType: input.mimeType, UTI: 'public.zip-archive' });
    expect(mockSize.mock.invocationCallOrder[0]).toBeLessThan(available.mock.invocationCallOrder[0]);
    expect(available.mock.invocationCallOrder[0]).toBeLessThan(share.mock.invocationCallOrder[0]);
    expect(mockDelete).not.toHaveBeenCalled(); expect(mockEntries.has(file.uri)).toBe(true);
});
test.each(['../../elsewhere', 'a/b', '%2e%2e', 'x'.repeat(200), `${input.requestId}/../bad`])('hostile request id %s cannot choose the path', async requestId => {
    await shareStemFile({ ...input, requestId });
    expect(download.mock.calls[0][1].uri).toBe(`${root}/00000000-0000-4000-8000-000000000001/veyrnox-request-archive.zip`);
});
test.each([
    ['audio/mpeg', 'mp3'], ['audio/wav', 'wav'], ['audio/x-wav', 'wav'], ['audio/mp4', 'm4a'],
    ['audio/aac', 'aac'], ['audio/flac', 'flac'], ['audio/ogg', 'ogg'], ['audio/unknown', 'bin'], ['constructor', 'bin'],
])('%s uses the safe extension %s', async (mimeType, ext) => {
    await shareStemFile({ ...input, kind: 'target', mimeType });
    expect(download.mock.calls[0][1].uri).toMatch(new RegExp(`-target\\.${ext}$`));
});
test('size mismatch deletes the attempt and raises a typed share failure', async () => {
    download.mockImplementationOnce(async (_url, dest) => persist(dest, 41));
    await expect(shareStemFile(input)).rejects.toMatchObject({ name: 'StemFileError', reason: 'size_mismatch', code: 'stem_share_failed' });
    expect(mockDelete).toHaveBeenCalledTimes(1); expect(available).not.toHaveBeenCalled(); expect(share).not.toHaveBeenCalled();
    expect(mockEntries.has(download.mock.calls[0][1].uri)).toBe(false);
});
test('unavailable sharing deletes the unshared download', async () => {
    available.mockResolvedValue(false);
    await expect(shareStemFile(input)).rejects.toMatchObject({ reason: 'unavailable' });
    expect(mockDelete).toHaveBeenCalledTimes(1); expect(share).not.toHaveBeenCalled();
});
test('download failure removes partial files without exposing the signed URL', async () => {
    download.mockImplementationOnce(async (_url, dest) => { persist(dest, 12); throw Error(input.url); });
    await expect(shareStemFile(input)).rejects.toEqual(new StemFileError('transfer_failed'));
    expect(mockEntries.has(download.mock.calls[0][1].uri)).toBe(false); expect(share).not.toHaveBeenCalled();
});
test('availability errors remove the download; share rejection retains a potentially handed-over URI', async () => {
    available.mockRejectedValueOnce(Error('native'));
    await expect(shareStemFile(input)).rejects.toBeInstanceOf(StemFileError);
    expect(mockDelete).toHaveBeenCalledTimes(1);
    share.mockRejectedValueOnce(Error('native'));
    await expect(shareStemFile(input)).rejects.toBeInstanceOf(StemFileError);
    expect(mockDelete).toHaveBeenCalledTimes(1); expect(mockEntries.has(download.mock.calls[1][1].uri)).toBe(true);
});
test.each(['sign-out', 'account replacement', 'unmount'])('%s during a pending download prevents UI and removes the attempt', async () => {
    let current = true; const wait = deferred<File>();
    download.mockImplementationOnce((_url, dest) => { persist(dest); return wait.promise; });
    const pending = shareStemFile({ ...input, isCurrent: () => current });
    current = false; wait.resolve(new File(download.mock.calls[0][1].uri)); await pending;
    expect(share).not.toHaveBeenCalled(); expect(available).not.toHaveBeenCalled(); expect(mockDelete).toHaveBeenCalledTimes(1);
});
test('session invalidated during synchronous size inspection is checked before availability', async () => {
    let current = true; const wait = deferred<File>();
    download.mockImplementationOnce((_url, dest) => { persist(dest); return wait.promise; });
    const pending = shareStemFile({ ...input, isCurrent: () => current });
    mockSize.mockImplementationOnce(() => { current = false; });
    wait.resolve(new File(download.mock.calls[0][1].uri)); await pending;
    expect(available).not.toHaveBeenCalled(); expect(share).not.toHaveBeenCalled(); expect(mockDelete).toHaveBeenCalledTimes(1);
});
test.each(['sign-out', 'account replacement', 'unmount'])('%s while checking availability prevents UI', async () => {
    let current = true; const wait = deferred<boolean>(), entered = deferred<void>();
    available.mockImplementationOnce(() => { entered.resolve(); return wait.promise; });
    const pending = shareStemFile({ ...input, isCurrent: () => current });
    await entered.promise; current = false; wait.resolve(true); await pending;
    expect(share).not.toHaveBeenCalled(); expect(mockDelete).toHaveBeenCalledTimes(1);
});
test('last session check immediately before sharing fences an invalidated session', async () => {
    const isCurrent = jest.fn().mockReturnValueOnce(true).mockReturnValueOnce(true).mockReturnValueOnce(true).mockReturnValueOnce(true).mockReturnValue(false);
    await shareStemFile({ ...input, isCurrent });
    expect(available).toHaveBeenCalledTimes(1); expect(share).not.toHaveBeenCalled(); expect(mockDelete).toHaveBeenCalledTimes(1);
});
test.each(['failure', 'stale'] as const)('a repeated %s attempt leaves the first shared file intact with a distinct path', async mode => {
    await shareStemFile(input); const first = download.mock.calls[0][1].uri;
    let current = true;
    download.mockImplementationOnce(async (_url, dest) => {
        const file = persist(dest); if (mode === 'failure') throw Error('network'); current = false; return file;
    });
    const pending = shareStemFile({ ...input, isCurrent: () => current });
    if (mode === 'failure') await expect(pending).rejects.toBeInstanceOf(StemFileError); else await pending;
    const second = download.mock.calls[1][1].uri;
    expect(first).not.toBe(second); expect(mockEntries.has(first)).toBe(true); expect(mockEntries.has(second)).toBe(false);
    expect(share).toHaveBeenCalledTimes(1);
});
test('sweep deletes only old direct attempt directories, with file timestamp fallback and fresh file protection', () => {
    const day = 86400000, now = Date.now();
    const attempt = (n: number) => `${root}/00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
    mockEntries.set(root, { time: now });
    for (const n of [1, 2, 3, 4, 5]) mockEntries.set(attempt(n), { time: now - day - 1 });
    mockEntries.set(attempt(2), { time: now - day }); // Exactly 24 h is retained.
    mockEntries.set(`${attempt(3)}/file.zip`, { time: now, size: 42 });
    mockEntries.set(attempt(4), { time: undefined });
    mockEntries.set(`${attempt(4)}/file.zip`, { time: now - day - 1, size: 42 });
    mockEntries.set(attempt(5), { time: undefined, creationTime: now - day - 1 });
    const outside = new Directory(Paths.cache, 'unrelated');
    mockEntries.set(outside.uri, { time: now - day - 1 });
    mockEntries.set(`${root}/unrelated`, { time: now - day - 1 });
    mockEntries.set(`${root}/loose.zip`, { time: now - day - 1, size: 42 });
    const list = Directory.prototype.list;
    jest.spyOn(Date, 'now').mockReturnValue(now);
    const spy = jest.spyOn(Directory.prototype, 'list').mockImplementation(function (this: Directory) {
        const entries = list.call(this); return this.uri === root ? [...entries, outside, new Directory(`${root}/../escape`)] : entries;
    });
    sweepStemFiles();
    expect(mockDelete.mock.calls).toEqual([[attempt(1)], [attempt(4)], [attempt(5)]]);
    spy.mockRestore(); jest.restoreAllMocks();
});
test('sweep errors are swallowed', () => {
    const spy = jest.spyOn(Directory.prototype, 'list').mockImplementation(() => { throw Error('cache'); });
    mockEntries.set(root, { time: Date.now() }); expect(() => sweepStemFiles()).not.toThrow(); spy.mockRestore();
});

test('marker is written before download and ages attempts when native timestamps are unavailable', async () => {
    const now = Date.now(), day = 86400000;
    const clock = jest.spyOn(Date, 'now').mockReturnValue(now);
    try {
        download.mockImplementationOnce(async (_url, dest) => {
            const marker = `${dest.uri.slice(0, dest.uri.lastIndexOf('/'))}/.created`;
            expect(mockEntries.get(marker)?.content).toBe(String(now));
            return persist(dest);
        });
        await shareStemFile(input);
        const uri = download.mock.calls[0][1].uri, attempt = uri.slice(0, uri.lastIndexOf('/'));
        for (const [path, entry] of mockEntries) {
            if (path === attempt || path.startsWith(`${attempt}/`)) {
                mockEntries.set(path, { ...entry, time: NaN, creationTime: Infinity });
            }
        }
        clock.mockReturnValue(now + day);
        sweepStemFiles(); expect(mockDelete).not.toHaveBeenCalled();
        clock.mockReturnValue(now + day + 1);
        sweepStemFiles(); expect(mockDelete).toHaveBeenCalledWith(attempt);
        expect(mockEntries.has(uri)).toBe(false); expect(mockEntries.has(`${attempt}/.created`)).toBe(false);
    } finally { clock.mockRestore(); }
});
test.each(['', 'not-a-timestamp', 'Infinity'])('invalid marker %j cannot cause early deletion', content => {
    const attempt = `${root}/00000000-0000-4000-8000-000000000001`;
    mockEntries.set(root, { time: Date.now() });
    mockEntries.set(attempt, { time: undefined });
    mockEntries.set(`${attempt}/.created`, { time: undefined, size: content.length, content });
    sweepStemFiles(); expect(mockDelete).not.toHaveBeenCalled();
});
test('marker write failure cleans its attempt before downloading or sharing', async () => {
    const write = jest.spyOn(File.prototype, 'writeSync').mockImplementationOnce(() => { throw Error('disk'); });
    try {
        await expect(shareStemFile(input)).rejects.toBeInstanceOf(StemFileError);
        expect(download).not.toHaveBeenCalled(); expect(share).not.toHaveBeenCalled();
        expect(mockDelete).toHaveBeenCalledTimes(1);
    } finally { write.mockRestore(); }
});
