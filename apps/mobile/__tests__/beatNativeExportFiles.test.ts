import { Directory } from 'expo-file-system';
import { bindCacheUser, resetCacheUser, wipeCache } from '../src/lib/appCache';
import { createCache, createMemoryStorage } from '../src/lib/cache';
import * as Sharing from 'expo-sharing';
import { clearBeatExports, shareBeatExport, sweepBeatExports } from '../src/lib/beatNative/exportFiles';
import { exportFilename } from '../src/lib/beatNative/exportShared';
import { deferred, tick } from './beatNativeFixtures';
const mockEntries = new Map<string, { time?: number; content?: string | Uint8Array }>();
let mockUuid = 0;
const mockDelete = jest.fn();
jest.mock('expo-crypto', () => ({ randomUUID: () => `00000000-0000-4000-8000-${String(++mockUuid).padStart(12, '0')}` }));
jest.mock('expo-sharing', () => ({ isAvailableAsync: jest.fn(), shareAsync: jest.fn() }));
jest.mock('expo-file-system', () => {
    class Directory {
        uri: string;
        constructor(...parts: any[]) { this.uri = parts.map(p => typeof p === 'string' ? p : p.uri).join('/').replace(/\/+$/, ''); }
        get exists() { return mockEntries.has(this.uri); }
        create() { if (this.exists) throw Error('exists'); mockEntries.set(this.uri, { time: Date.now() }); mockEntries.set(this.uri.slice(0, this.uri.lastIndexOf('/')), { time: Date.now() }); }
        info() { return { modificationTime: mockEntries.get(this.uri)?.time }; }
        list() { return [...mockEntries.keys()].filter(uri => uri.startsWith(`${this.uri}/`) && !uri.slice(this.uri.length + 1).includes('/')).map(uri => mockEntries.get(uri)?.content === undefined ? new Directory(uri) : new File(uri)); }
        delete() { mockDelete(this.uri); for (const uri of mockEntries.keys()) if (uri === this.uri || uri.startsWith(`${this.uri}/`)) mockEntries.delete(uri); }
    }
    class File {
        uri: string;
        constructor(...parts: any[]) { this.uri = parts.map(p => typeof p === 'string' ? p : p.uri).join('/'); }
        get modificationTime() { return mockEntries.get(this.uri)?.time; }
        create() { if (mockEntries.has(this.uri)) throw Error('exists'); mockEntries.set(this.uri, { time: Date.now(), content: '' }); }
        writeSync(content: string | Uint8Array) { mockEntries.set(this.uri, { time: Date.now(), content }); }
        textSync() { return mockEntries.get(this.uri)?.content; }
    }
    return { Directory, File, Paths: { cache: 'file:///cache' } };
});
const root = 'file:///cache/veyrnox-beat-export';
const available = jest.mocked(Sharing.isAvailableAsync), share = jest.mocked(Sharing.shareAsync);
beforeEach(() => { mockEntries.clear(); mockUuid = 0; jest.clearAllMocks(); available.mockResolvedValue(true); share.mockResolvedValue(); });
test('stages bytes at a unique sanitized filename and uses WAV MIME/UTI without overwriting earlier shares', async () => {
    const bytes = new Uint8Array([1, 2, 3]).buffer, filename = exportFilename('../ Ｍｉｘ', '2 /Kick');
    await shareBeatExport(bytes, filename); await shareBeatExport(bytes, filename);
    const first = share.mock.calls[0][0], second = share.mock.calls[1][0];
    expect(first).not.toBe(second); expect(first).toBe(`${root}/00000000-0000-4000-8000-000000000001/Mix - 2 Kick.wav`);
    expect(mockEntries.get(first)?.content).toEqual(new Uint8Array(bytes));
    expect(share.mock.calls[0][1]).toEqual({ mimeType: 'audio/wav', UTI: 'com.microsoft.waveform-audio' });
    expect(mockDelete).not.toHaveBeenCalled();
    mockUuid = 0; await expect(shareBeatExport(bytes, filename)).rejects.toMatchObject({ key: 'beatExport.shareError' });
    expect(mockEntries.get(first)?.content).toEqual(new Uint8Array(bytes));
});
test('unavailable or stale sharing never stages or opens a share', async () => {
    available.mockResolvedValue(false); await expect(shareBeatExport(new ArrayBuffer(44), 'Mix.wav')).rejects.toMatchObject({ key: 'beatExport.shareUnavailable' });
    expect(share).not.toHaveBeenCalled(); expect(mockEntries.size).toBe(0);
    await shareBeatExport(new ArrayBuffer(44), 'Mix.wav', () => false); expect(mockEntries.size).toBe(0);
});
test('sweep only removes old UUID attempts in its own root, preserving active shares and other caches', async () => {
    const gate = deferred(); share.mockReturnValue(gate.promise);
    const pending = shareBeatExport(new ArrayBuffer(44), 'Mix.wav'); await tick();
    const active = `${root}/00000000-0000-4000-8000-000000000001`;
    for (const [uri, value] of mockEntries) if (uri.startsWith(active)) value.time = 1;
    const old = `${root}/00000000-0000-4000-8000-000000000002`, other = 'file:///cache/other';
    mockEntries.set(old, { time: 1 }); mockEntries.set(`${root}/personal`, { time: 1 }); mockEntries.set(other, { time: 1 });
    sweepBeatExports(); expect(mockEntries.has(old)).toBe(false); expect(mockEntries.has(active)).toBe(true); expect(mockEntries.has(other)).toBe(true); expect(mockEntries.has(`${root}/personal`)).toBe(true);
    gate.resolve(); await pending; sweepBeatExports(); expect(mockEntries.has(active)).toBe(false);
});
test('platform share rejection preserves a potentially handed-out URI and exposes fixed copy', async () => {
    share.mockRejectedValue(new Error('native private path'));
    await expect(shareBeatExport(new ArrayBuffer(44), 'Mix.wav')).rejects.toMatchObject({ key: 'beatExport.shareError' });
    expect(mockEntries.has(share.mock.calls[0][0])).toBe(true);
});

test.each(['signout', 'owner-change'])('N7-R5: %s removes inactive exports and defers active attachment deletion until sharing settles', async action => {
    resetCacheUser(); const storage = createMemoryStorage(), cache = createCache(storage), docs = createMemoryStorage();
    await bindCacheUser('A', cache, storage, docs);
    await shareBeatExport(new ArrayBuffer(44), 'Private.wav'); const oldUri = share.mock.calls[0][0];
    const gate = deferred(); share.mockReturnValueOnce(gate.promise);
    const pending = shareBeatExport(new ArrayBuffer(44), 'Active.wav'); await tick();
    const activeUri = share.mock.calls[1][0]; expect(mockEntries.has(activeUri)).toBe(true);
    mockEntries.set('file:///cache/unrelated/file', { time: 1, content: 'keep' });
    if (action === 'signout') await wipeCache(cache, docs, 'signout'); else await bindCacheUser('B', cache, storage, docs);
    expect(mockEntries.has(oldUri)).toBe(false); expect(mockEntries.has(activeUri)).toBe(true);
    gate.resolve(); await pending; expect(mockEntries.has(activeUri)).toBe(false);
    expect(mockEntries.has('file:///cache/unrelated/file')).toBe(true);
});
test('N7-R5: sign-out while availability is pending prevents a stale attempt from being staged', async () => {
    const gate = deferred<boolean>(); available.mockReturnValueOnce(gate.promise);
    const pending = shareBeatExport(new ArrayBuffer(44), 'Private.wav');
    const rejected = expect(pending).rejects.toMatchObject({ key: 'beatExport.signIn' });
    await wipeCache(createCache(createMemoryStorage()), createMemoryStorage(), 'signout');
    gate.resolve(true); await rejected; expect(share).not.toHaveBeenCalled(); expect(mockEntries.size).toBe(0);
});
test('N7-R5: export deletion failures never stop sign-out', async () => {
    await shareBeatExport(new ArrayBuffer(44), 'Private.wav');
    const fail = jest.spyOn(Directory.prototype, 'delete').mockImplementation(() => { throw new Error('disk'); });
    try {
        expect(() => clearBeatExports()).not.toThrow();
        await expect(wipeCache(createCache(createMemoryStorage()), createMemoryStorage(), 'signout')).resolves.toBeUndefined();
    } finally { fail.mockRestore(); }
});
