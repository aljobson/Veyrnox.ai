import { deflateRawSync } from 'node:zlib';
import { Directory, File, Paths } from 'expo-file-system';

type Entry = { directory?: boolean; bytes?: Uint8Array; time?: number; creationTime?: number };
const mockDisk = new Map<string, Entry>();
const mockReads: [number, number][] = [];
const mockEvents: string[] = [];
let mockDownloadBytes = new Uint8Array();
let mockAfterRead = () => {};
let mockUuid = 0;
jest.mock('expo-crypto', () => ({ randomUUID: () => `00000000-0000-4000-8000-${String(++mockUuid).padStart(12, '0')}` }));
jest.mock('expo-file-system', () => {
    const join = (parts: any[]) => parts.map(part => typeof part === 'string' ? part : part.uri).join('/').replace(/\/$/, '');
    class Directory {
        uri: string;
        constructor(...parts: any[]) { this.uri = join(parts); }
        get exists() { return mockDisk.get(this.uri)?.directory === true || [...mockDisk.keys()].some(key => key.startsWith(`${this.uri}/`)); }
        create() {
            if (this.exists) throw Error('exists');
            mockDisk.set(this.uri, { directory: true, time: Date.now(), creationTime: Date.now() });
            const parent = this.uri.slice(0, this.uri.lastIndexOf('/'));
            if (parent) mockDisk.set(parent, { directory: true, time: Date.now(), creationTime: Date.now() });
        }
        info() { const row = mockDisk.get(this.uri); return { modificationTime: row?.time, creationTime: row?.creationTime }; }
        list() {
            return [...mockDisk.entries()].filter(([key]) => key.startsWith(`${this.uri}/`) && !key.slice(this.uri.length + 1).includes('/'))
                .map(([key, row]) => row.directory ? new Directory(key) : new File(key));
        }
        delete() {
            mockEvents.push(`delete:${this.uri}`);
            for (const key of [...mockDisk.keys()]) if (key === this.uri || key.startsWith(`${this.uri}/`)) mockDisk.delete(key);
        }
    }
    class File {
        uri: string;
        constructor(...parts: any[]) { this.uri = join(parts); }
        get exists() { return !!mockDisk.get(this.uri)?.bytes; }
        get size() { return mockDisk.get(this.uri)?.bytes?.length ?? null; }
        get modificationTime() { return mockDisk.get(this.uri)?.time; }
        create() { mockDisk.set(this.uri, { bytes: new Uint8Array(), time: Date.now() }); }
        writeSync(value: string | Uint8Array) {
            mockDisk.set(this.uri, { bytes: typeof value === 'string' ? new TextEncoder().encode(value) : value.slice(), time: Date.now() });
        }
        textSync() {
            const bytes = mockDisk.get(this.uri)?.bytes;
            if (!bytes) throw Error('missing');
            return new TextDecoder().decode(bytes);
        }
        open() {
            const bytes = mockDisk.get(this.uri)?.bytes;
            if (!bytes) throw Error('missing');
            const uri = this.uri;
            let offset = 0, closed = false;
            return {
                get size() { return closed ? null : bytes.length; },
                get offset() { return closed ? null : offset; },
                set offset(value: number | null) { if (value !== null) offset = value; },
                async readBytes(length: number) {
                    mockReads.push([offset, length]);
                    const result = bytes.slice(offset, offset + length); offset += result.length; mockAfterRead(); return result;
                },
                close() { if (!closed) mockEvents.push(`close:${uri}`); closed = true; },
            };
        }
        static downloadFileAsync = jest.fn(async (_url: string, destination: File, options?: {
            signal?: AbortSignal; onProgress?(value: { bytesWritten: number; totalBytes: number }): void;
        }) => {
            options?.onProgress?.({ bytesWritten: mockDownloadBytes.length, totalBytes: mockDownloadBytes.length });
            if (options?.signal?.aborted) throw Object.assign(Error('aborted'), { name: 'AbortError' });
            mockDisk.set(destination.uri, { bytes: mockDownloadBytes.slice(), time: Date.now() });
            return new File(destination.uri);
        });
    }
    return { Directory, File, FileMode: { ReadOnly: 'r' }, Paths: { cache: 'file:///cache' } };
});

import { inflateNativeStem, loadNativeStemArchive, NativeStemArchiveError, NATIVE_INFLATE_OUTPUT_CHUNK_MAX, sweepStemArchiveRuns } from '../src/lib/beatNative/stemArchive';

function crc(bytes: Uint8Array) {
    let value = 0xffffffff;
    for (const byte of bytes) { value ^= byte; for (let i = 0; i < 8; i++) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0); }
    return ~value >>> 0;
}
function zip(payload: Uint8Array, method = 8) {
    const names = ['vocals.wav', 'instrumental.wav'], locals: Buffer[] = [], centrals: Buffer[] = [];
    let at = 0;
    for (const name of names) {
        const text = Buffer.from(name), raw = Buffer.from(payload), data = method === 8 ? deflateRawSync(raw) : raw;
        const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50); local.writeUInt16LE(method, 8); local.writeUInt32LE(crc(raw), 14);
        local.writeUInt32LE(data.length, 18); local.writeUInt32LE(raw.length, 22); local.writeUInt16LE(text.length, 26);
        locals.push(local, text, data);
        const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50); central.writeUInt16LE(method, 10); central.writeUInt32LE(crc(raw), 16);
        central.writeUInt32LE(data.length, 20); central.writeUInt32LE(raw.length, 24); central.writeUInt16LE(text.length, 28); central.writeUInt32LE(at, 42);
        centrals.push(central, text); at += local.length + text.length + data.length;
    }
    const directory = Buffer.concat(centrals), end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(2, 8); end.writeUInt16LE(2, 10);
    end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(at, 16);
    return new Uint8Array(Buffer.concat([...locals, directory, end]));
}
const download = jest.mocked(File.downloadFileAsync);
beforeEach(() => {
    jest.clearAllMocks(); mockDisk.clear(); mockReads.length = 0; mockEvents.length = 0; mockUuid = 0; mockAfterRead = () => {};
});

test.each([0, 8])('downloads, range-reads, validates and removes a method %s archive', async method => {
    const payload = new Uint8Array(2 * 1024 * 1024 + 17);
    let state = 0x12345678;
    for (let i = 0; i < payload.length; i++) { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; payload[i] = state; }
    mockDownloadBytes = zip(payload, method);
    await expect(loadNativeStemArchive({ url: 'https://signed.test/private', sizeBytes: mockDownloadBytes.length, part: 'vocals' })).resolves.toEqual(payload);
    expect(download).toHaveBeenCalledTimes(1);
    expect(mockReads.every(([, length]) => length <= 1024 * 1024)).toBe(true);
    expect(mockReads.every(([, length]) => length < mockDownloadBytes.length)).toBe(true);
    expect(mockEvents.findIndex(event => event.startsWith('close:'))).toBeLessThan(mockEvents.findIndex(event => event.startsWith('delete:')));
    expect([...mockDisk.keys()].some(key => key.includes('veyrnox-beat-stem-runs/'))).toBe(false);
});

test('rejects invalid and changed signed sizes and removes partial downloads', async () => {
    mockDownloadBytes = zip(new Uint8Array([1, 2, 3]), 0);
    await expect(loadNativeStemArchive({ url: 'https://signed.test/private', sizeBytes: 0, part: 'vocals' }))
        .rejects.toEqual(new NativeStemArchiveError('invalid_size'));
    expect(download).not.toHaveBeenCalled();
    await expect(loadNativeStemArchive({ url: 'https://signed.test/private', sizeBytes: mockDownloadBytes.length + 1, part: 'vocals' }))
        .rejects.toEqual(new NativeStemArchiveError('size_changed'));
    expect([...mockDisk.keys()].some(key => key.endsWith('archive.zip'))).toBe(false);
});

test('progress overflow aborts the native download and sanitizes transfer failures', async () => {
    mockDownloadBytes = zip(new Uint8Array([1, 2, 3]), 0);
    await expect(loadNativeStemArchive({ url: 'https://signed.test/private?secret=x', sizeBytes: mockDownloadBytes.length - 1, part: 'vocals' }))
        .rejects.toEqual(new NativeStemArchiveError('size_changed'));
    download.mockRejectedValueOnce(Error('server returned HTTP 403 https://signed.test/private?secret=x'));
    await expect(loadNativeStemArchive({ url: 'https://signed.test/private?secret=x', sizeBytes: mockDownloadBytes.length, part: 'vocals' }))
        .rejects.toEqual(new NativeStemArchiveError('transfer_failed', 403));
});

test('account replacement during a ranged read closes the handle and deletes the attempt', async () => {
    mockDownloadBytes = zip(new Uint8Array(100).fill(4), 0);
    let current = true;
    mockAfterRead = () => { current = false; };
    await expect(loadNativeStemArchive({ url: 'https://signed.test/private', sizeBytes: mockDownloadBytes.length, part: 'vocals', current: () => current }))
        .rejects.toThrow('account_changed');
    expect(mockEvents.some(event => event.startsWith('close:'))).toBe(true);
    expect(mockEvents.some(event => event.startsWith('delete:'))).toBe(true);
});

test('launch/account sweep deletes every abandoned UUID attempt and retains unrelated entries', () => {
    const now = Date.now(), old = now - 24 * 60 * 60 * 1000 - 1, staging = new Directory(Paths.cache, 'veyrnox-beat-stem-runs');
    const attempt = (id: number) => new Directory(staging, `00000000-0000-4000-8000-${String(id).padStart(12, '0')}`);
    mockDisk.set(staging.uri, { directory: true, time: now });
    mockDisk.set(attempt(1).uri, { directory: true, time: old });
    mockDisk.set(attempt(2).uri, { directory: true, time: now });
    mockDisk.set(`${staging.uri}/unrelated`, { directory: true, time: old });
    mockDisk.set(`${staging.uri}/loose.zip`, { bytes: new Uint8Array(), time: old });
    const clock = jest.spyOn(Date, 'now').mockReturnValue(now);
    try { sweepStemArchiveRuns(); }
    finally { clock.mockRestore(); }
    expect(mockDisk.has(attempt(1).uri)).toBe(false);
    expect(mockDisk.has(attempt(2).uri)).toBe(false);
    expect(mockDisk.has(`${staging.uri}/unrelated`)).toBe(true);
});

test('real fflate bomb output stays bounded per compressed push', async () => {
    const raw = new Uint8Array(20 * 1024 * 1024);
    const compressed = new Uint8Array(deflateRawSync(raw));
    let delivered = false, peak = 0, total = 0;
    await inflateNativeStem({ async next() {
        if (delivered) return null;
        delivered = true; return { bytes: compressed, final: true };
    } }, bytes => { peak = Math.max(peak, bytes.length); total += bytes.length; });
    expect(total).toBe(raw.length);
    expect(peak).toBeLessThanOrEqual(NATIVE_INFLATE_OUTPUT_CHUNK_MAX);
});
test('sweep never deletes an active run even when all visible timestamps are stale', async () => {
    mockDownloadBytes = zip(new Uint8Array([1, 2, 3]), 0);
    let finish!: (file: File) => void;
    download.mockImplementationOnce(async (_url, destination) => new Promise<File>(resolve => {
        const file = destination as File;
        mockDisk.set(file.uri, { bytes: mockDownloadBytes.slice(), time: Date.now() });
        finish = resolve;
    }));
    const pending = loadNativeStemArchive({ url: 'https://signed.test/private', sizeBytes: mockDownloadBytes.length, part: 'vocals' });
    while (!download.mock.calls.length) await Promise.resolve();
    const file = download.mock.calls[0][1] as File, attempt = file.uri.slice(0, file.uri.lastIndexOf('/'));
    for (const [uri, row] of mockDisk) if (uri === attempt || uri.startsWith(`${attempt}/`)) mockDisk.set(uri, { ...row, time: 0, creationTime: 0 });
    sweepStemArchiveRuns();
    expect(mockDisk.has(attempt)).toBe(true);
    finish(new File(file.uri));
    await expect(pending).resolves.toEqual(new Uint8Array([1, 2, 3]));
    expect(mockDisk.has(attempt)).toBe(false);
});
