import { seedSongBeat, createSeedSession, fetchAudioAsset, type SeedDeps } from '../src/lib/beatNative/songSeed';
import { encodeWav } from '../src/lib/instrumentShared';
import { createBeatStore } from '../src/lib/beatNative/store';
import { validateBeat } from '../src/lib/beatNative/doc';
import { memoryFiles, PROJECT, VERSION, USER, OTHER, deferred } from './beatNativeFixtures';
const bytes = new Uint8Array(encodeWav(new Float32Array(48000), 48000));
const base = { source: 'song' as const, ref: { songId: PROJECT, versionId: VERSION, jobId: USER }, name: 'Song', bpm: null };
function response(data = bytes, size: string | null = String(data.length), signal?: AbortSignal) {
    let offset = 0;
    const read = jest.fn(async () => {
        if (signal?.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' });
        if (offset === data.length) return { done: true, value: undefined };
        const value = data.subarray(offset, offset + 32768); offset += value.length; return { done: false, value };
    });
    const cancel = jest.fn(async () => {}), releaseLock = jest.fn();
    const getReader = jest.fn(() => ({ read, cancel, releaseLock }));
    return { ok: true, status: 200, headers: { get: () => size }, body: { getReader, cancel }, read, cancel, getReader, releaseLock };
}
function setup() {
    const files = memoryFiles(), store = createBeatStore(files);
    const deps: SeedDeps = { store, fallbackTitle: 'My song', online: () => true, currentUserId: () => USER,
        getSong: jest.fn(async () => ({ id: PROJECT, version_id: VERSION, job_id: USER, title: '  Ｓong  ' })),
        sign: jest.fn(async () => ({ url: 'https://private.invalid/signed' })),
        fetchAudio: jest.fn(async (_url: RequestInfo | URL, init?: RequestInit) => response(bytes, String(bytes.length), init?.signal ?? undefined)) as unknown as typeof fetch,
        decode: jest.fn(async () => ({ numberOfChannels: 1, sampleRate: 48000, length: 48000 })) };
    return { deps, files, store, signal: new AbortController().signal };
}
test.each([[401, 'r36'], [403, 'r34'], [404, 'r34'], [500, 'r35']] as const)('song HTTP %i maps to %s', async (status, code) => {
    const { deps, signal } = setup(); deps.getSong = async () => { throw { status }; };
    await expect(seedSongBeat(deps, PROJECT, signal)).rejects.toMatchObject({ code });
});
test('offline and invalid id are rejected before fetching', async () => {
    const { deps, signal } = setup(); deps.online = () => false;
    await expect(seedSongBeat(deps, PROJECT, signal)).rejects.toMatchObject({ code: 'r35' });
    deps.online = () => true; await expect(seedSongBeat(deps, 'invalid', signal)).rejects.toMatchObject({ code: 'r34' });
    expect(deps.getSong).not.toHaveBeenCalled();
});
test('success persists a valid single audio track and web-shaped metadata, normalizing only the title', async () => {
    const { deps, store, signal, files } = setup(); const id = await seedSongBeat(deps, PROJECT, signal);
    const doc = store.getBeat(id)!; expect(validateBeat(doc).ok).toBe(true); expect(doc.title).toBe('Song');
    expect(doc.tracks).toHaveLength(1); expect(doc.tracks[0]).toMatchObject({ kind: 'audio', name: '  Ｓong  ', regions: [{ start: 0 }] });
    expect(Object.values((doc as unknown as { assets: Record<string, unknown> }).assets)).toEqual([{ ...base, name: '  Ｓong  ', durationSec: 1, sourceChannels: 1, encodedBytes: bytes.length }]);
    expect(files.data.size).toBe(1); expect(deps.sign).toHaveBeenCalledWith(USER, signal);
    for (const call of (deps.fetchAudio as jest.Mock).mock.calls) expect(call[1].signal).toBe(signal);
});
test.each(['', '   ', 'x'.repeat(100)])('seed title fallback / bound for %s', async title => {
    const { deps, store, signal } = setup(); deps.getSong = async () => ({ id: PROJECT, version_id: VERSION, job_id: USER, title });
    const id = await seedSongBeat(deps, PROJECT, signal);
    expect(store.getBeat(id)?.title).toBe(title.trim().slice(0, 80) || 'My song');
});
test('changed account after decode creates nothing', async () => {
    const { deps, store, signal } = setup(); deps.decode = async () => { deps.currentUserId = () => OTHER; return { numberOfChannels: 1, sampleRate: 48000, length: 48000 }; };
    await expect(seedSongBeat(deps, PROJECT, signal)).rejects.toMatchObject({ code: 'r36' }); expect(store.listBeats()).toEqual([]);
});
test('write failure returns r37 and drops the record', async () => {
    const { deps, signal } = setup(); const files = memoryFiles(); files.write = async () => { throw new Error('disk full'); };
    const store = createBeatStore(files); deps.store = store;
    await expect(seedSongBeat(deps, PROJECT, signal)).rejects.toMatchObject({ code: 'r37' }); expect(store.listBeats()).toEqual([]);
});
test('effect replay shares creation and actual unmount aborts pending work', async () => {
    const { deps, store } = setup(); const session = createSeedSession(deps, PROJECT);
    const first = session.acquire(); session.release(); const second = session.acquire();
    expect(second).toBe(first); await first; expect(store.listBeats()).toHaveLength(1); session.release();
    const next = setup(), wait = deferred<Awaited<ReturnType<SeedDeps['getSong']>>>();
    next.deps.getSong = (_id, signal) => { signal.addEventListener('abort', () => wait.reject(Object.assign(new Error(), { name: 'AbortError' }))); return wait.promise; };
    const leaving = createSeedSession(next.deps, PROJECT); const result = leaving.acquire();
    for (let i = 0; i < 8; i++) await Promise.resolve();
    leaving.release(); await expect(result).rejects.toMatchObject({ name: 'AbortError' }); expect(next.store.listBeats()).toEqual([]);
});
test('ignored Range response stops prefix at 64 KiB and cancels', async () => {
    const { deps } = setup(), prefix = response(), full = response(); let calls = 0;
    const fetchAudio = jest.fn(async () => calls++ === 0 ? prefix : full) as unknown as typeof fetch;
    await fetchAudioAsset('signed', base, null, { fetchAudio, decode: deps.decode });
    expect(prefix.read).toHaveBeenCalledTimes(2); expect(prefix.cancel).toHaveBeenCalledTimes(1); expect(prefix.releaseLock).toHaveBeenCalled();
    expect((fetchAudio as jest.Mock).mock.calls[0][1].headers.Range).toBe('bytes=0-65535');
});
test.each([null, '120000001'])('missing/oversized Content-Length %s is refused before full-body read', async size => {
    const { deps } = setup(), full = response(bytes, size); let calls = 0;
    const fetchAudio = jest.fn(async () => calls++ === 0 ? response() : full) as unknown as typeof fetch;
    await expect(fetchAudioAsset('signed', base, null, { fetchAudio, decode: deps.decode })).rejects.toThrow();
    expect(full.getReader).not.toHaveBeenCalled(); expect(full.cancel).toHaveBeenCalled(); expect(deps.decode).not.toHaveBeenCalled();
});
test('body exceeding Content-Length is refused and its reader is cancelled', async () => {
    const { deps } = setup(), full = response(new Uint8Array([...bytes, 0]), String(bytes.length)); let calls = 0;
    const fetchAudio = jest.fn(async () => calls++ === 0 ? response() : full) as unknown as typeof fetch;
    await expect(fetchAudioAsset('signed', base, null, { fetchAudio, decode: deps.decode })).rejects.toThrow();
    expect(full.cancel).toHaveBeenCalled(); expect(deps.decode).not.toHaveBeenCalled();
});
test('abort mid-read cancels and never decodes or saves', async () => {
    const { deps, store } = setup(), controller = new AbortController(); let calls = 0;
    deps.fetchAudio = jest.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
        const body = response(bytes, String(bytes.length), init?.signal ?? undefined);
        if (++calls === 2) { const read = body.read.getMockImplementation()!; body.read.mockImplementation(async () => { const piece = await read(); controller.abort(); return piece; }); }
        return body;
    }) as unknown as typeof fetch;
    await expect(seedSongBeat(deps, PROJECT, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(deps.decode).not.toHaveBeenCalled(); expect(store.listBeats()).toEqual([]);
});
test('native decode metadata must pass the shared checkDecoded gate', async () => {
    const { deps, signal, store } = setup(); deps.decode = async () => ({ numberOfChannels: 2, sampleRate: 44100, length: 100 });
    await expect(seedSongBeat(deps, PROJECT, signal)).rejects.toMatchObject({ code: 'unsupported' }); expect(store.listBeats()).toEqual([]);
});
test('MP3 duration is measured from frames before native decode', async () => {
    const frames = 40, frameSize = 417, mp3 = new Uint8Array(frames * frameSize);
    for (let i = 0; i < frames; i++) mp3.set([0xff, 0xfb, 0x90, 0x00], i * frameSize);
    const duration = frames * 1152 / 44100;
    const decode = jest.fn(async () => ({ numberOfChannels: 2, sampleRate: 48000, length: Math.round(duration * 48000) }));
    const fetchAudio = jest.fn(async () => response(mp3)) as unknown as typeof fetch;
    const result = await fetchAudioAsset('signed', base, null, { fetchAudio, decode });
    expect(result.asset.durationSec).toBeCloseTo(duration); expect(result.asset.sourceChannels).toBe(2);
    expect(decode).toHaveBeenCalledTimes(1);
});
test('account change or abort during persistence drops the newly saved record', async () => {
    for (const changeAccount of [true, false]) {
        const { deps, store } = setup(), controller = new AbortController();
        const original = store.flushBeat;
        deps.store = { ...store, async flushBeat(id) {
            await original(id);
            if (changeAccount) deps.currentUserId = () => OTHER; else controller.abort();
        } };
        await expect(seedSongBeat(deps, PROJECT, controller.signal)).rejects.toMatchObject(changeAccount ? { code: 'r36' } : { name: 'AbortError' });
        expect(store.listBeats()).toEqual([]);
    }
});

test.each(['missing size', 'over 120 MB', 'over 600 seconds', 'decode reserve', 'changed size'] as const)('%s reports unsupported audio, not a connection problem', async failure => {
    const { deps, signal, store } = setup();
    const header = bytes.slice();
    let size: string | null = String(bytes.length), body = bytes;
    if (failure === 'missing size') size = null;
    if (failure === 'over 120 MB') size = '120000001';
    if (failure === 'over 600 seconds' || failure === 'decode reserve') {
        const channels = failure === 'decode reserve' ? 2 : 1;
        const duration = failure === 'decode reserve' ? 450 : 601;
        const dataSize = duration * 48000 * channels * 2, view = new DataView(header.buffer);
        view.setUint32(4, dataSize + 36, true); view.setUint16(22, channels, true);
        view.setUint32(28, 48000 * channels * 2, true); view.setUint16(32, channels * 2, true); view.setUint32(40, dataSize, true);
        size = String(dataSize + 44);
    }
    if (failure === 'changed size') body = new Uint8Array([...bytes, 0]);
    let calls = 0;
    deps.fetchAudio = jest.fn(async () => ++calls === 1 ? response(header) : response(body, size)) as unknown as typeof fetch;
    await expect(seedSongBeat(deps, PROJECT, signal)).rejects.toMatchObject({ code: 'unsupported' });
    expect(deps.decode).not.toHaveBeenCalled(); expect(store.listBeats()).toEqual([]);
});
test.each([new Error('decode failed'), new TypeError('unsupported codec'), Object.assign(new Error('reserve'), { displayCode: 'sound-too-large' })])('decode rejection %p reports unsupported audio', async error => {
    const { deps, signal, store } = setup(); deps.decode = async () => { throw error; };
    await expect(seedSongBeat(deps, PROJECT, signal)).rejects.toMatchObject({ code: 'unsupported' });
    expect(store.listBeats()).toEqual([]);
});
test.each(['fetch', 'stream', 'sign'] as const)('%s transport failure retains the connection message', async boundary => {
    const { deps, signal, store } = setup();
    if (boundary === 'fetch') deps.fetchAudio = async () => { throw new TypeError('network'); };
    if (boundary === 'sign') deps.sign = async () => { throw new Error('network'); };
    if (boundary === 'stream') deps.fetchAudio = jest.fn(async () => {
        const body = response(); body.read.mockRejectedValue(new Error('connection lost')); return body;
    }) as unknown as typeof fetch;
    await expect(seedSongBeat(deps, PROJECT, signal)).rejects.toMatchObject({ code: 'r35' });
    expect(deps.decode).not.toHaveBeenCalled(); expect(store.listBeats()).toEqual([]);
});
