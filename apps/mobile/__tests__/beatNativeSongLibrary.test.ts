import { ApiError, type ApiClient, type CallOptions, type ClientTask } from '../src/lib/api';
import { encodeWav } from '../src/lib/instrumentShared';
import { librarySongs } from '../src/lib/beatNative/librarySongs';
import { BeatSongLibraryError, classifyBeatSongLibraryError, createBeatSongLibrarySession, type BeatSongLibrarySessionDeps } from '../src/lib/beatNative/songLibrary';
import { PROJECT, USER, VERSION, deferred } from './beatNativeFixtures';

const JOB = '55555555-5555-4555-8555-555555555555';
const bytes = new Uint8Array(encodeWav(new Float32Array(48000), 48000));
const row = (patch: Record<string, unknown> = {}) => ({ id: PROJECT, version_id: VERSION, job_id: JOB, title: 'Song', ...patch });
function audioResponse(status = 200, data = bytes, declared = String(data.length)): Response {
    let offset = 0;
    const reader = { read: jest.fn(async () => offset === data.length ? { done: true, value: undefined } : (() => {
        const value = data.subarray(offset, offset + 32768); offset += value.length; return { done: false, value };
    })()), cancel: jest.fn(async () => {}), releaseLock: jest.fn() };
    return { ok: status >= 200 && status < 300, status, headers: { get: () => declared },
        body: { getReader: () => reader, cancel: jest.fn(async () => {}) } } as unknown as Response;
}
function setup() {
    let current = true;
    const task: ClientTask = { gen: 7, user: USER, current: () => current };
    const request = jest.fn(async (path: string) => path === '/api/v1/music/songs?limit=50'
        ? { songs: [row()] } : { url: 'https://signed.test/song' });
    const api = { request, stream: jest.fn(), getBalance: jest.fn() } as unknown as ApiClient;
    const beginSessionTask = jest.fn(() => task);
    const fetchAudio = jest.fn(async () => audioResponse()) as unknown as typeof fetch;
    const decode = jest.fn(async () => ({ numberOfChannels: 1, sampleRate: 48000, length: 48000 }));
    const preview = { start: jest.fn(), stop: jest.fn(), dispose: jest.fn() };
    const deps: BeatSongLibrarySessionDeps = { api, beginSessionTask, fetchAudio, decode, preview };
    return { deps, task, request, beginSessionTask, fetchAudio, decode, preview, change: () => { current = false; } };
}

test('shared mapper filters, deduplicates, bounds names and never reads audio_url', () => {
    const poisoned = row({ title: 'x'.repeat(100) });
    Object.defineProperty(poisoned, 'audio_url', { get() { throw new Error('must not read'); } });
    const result = librarySongs([null as never, row({ id: 'bad' }), poisoned, poisoned, row({ id: USER, title: '   ' })] as never);
    expect(result).toHaveLength(2); expect(result[0]).toMatchObject({ id: `${PROJECT}:${VERSION}`, name: 'x'.repeat(80), ref: { songId: PROJECT, versionId: VERSION, jobId: JOB } });
    expect(result[1].name).toBe('Untitled song');
});

test.each([
    [new ApiError(0, 'network'), 'offline', true, true], [new ApiError(401, 'not_authenticated'), 'expired', false, false],
    [new ApiError(401, 'account_changed'), 'accountChanged', false, false], [new ApiError(404, 'music_library_unavailable'), 'featureUnavailable', false, false],
    [new ApiError(404, 'music_unavailable'), 'featureUnavailable', false, false],
    [new ApiError(423, 'held'), 'held', false, true], [new ApiError(404, 'not_found'), 'unavailable', false, true],
    [new ApiError(429, 'rate_limited'), 'rateLimited', true, true], [new ApiError(503, 'service_unavailable'), 'service', true, true],
] as const)('typed error policy %#', (input, code, retryable, retainRows) => {
    expect(classifyBeatSongLibraryError(input)).toMatchObject({ code, retryable, retainRows });
});

test('raw TypeError is network only for requests and invalid media during decode', () => {
    const error = new TypeError('unsupported codec');
    expect(classifyBeatSongLibraryError(error, 'request')).toMatchObject({ code: 'offline', retryable: true });
    expect(classifyBeatSongLibraryError(error, 'media')).toMatchObject({ code: 'invalidMedia', retryable: false });
});

test('one task is captured and list uses exact bounded path plus task, owner and signal', async () => {
    const x = setup(), session = createBeatSongLibrarySession(x.deps), controller = new AbortController();
    const items = await session.list(controller.signal);
    expect(items).toHaveLength(1); expect(x.beginSessionTask).toHaveBeenCalledTimes(1);
    expect(x.request).toHaveBeenCalledWith('/api/v1/music/songs?limit=50', expect.objectContaining({ signal: expect.any(Object) }),
        expect.objectContaining({ task: x.task, owner: USER }));
    session.dispose(); expect(x.preview.dispose).toHaveBeenCalledTimes(1);
});

test('prepare is HTTPS-only, keeps signed URL out of result and reuses one cache entry for preview-to-add', async () => {
    const x = setup(), session = createBeatSongLibrarySession(x.deps), item = (await session.list(new AbortController().signal))[0];
    const previewLife = new AbortController();
    expect(await session.togglePreview(item, previewLife.signal)).toBe('playing');
    const prepared = await session.prepare(item, new AbortController().signal);
    expect(prepared.asset).toMatchObject({ source: 'song', ref: { songId: PROJECT, versionId: VERSION, jobId: JOB }, durationSec: 1 });
    expect(JSON.stringify(prepared)).not.toContain('signed.test');
    expect(x.request.mock.calls.filter(([path]) => String(path).endsWith('/asset'))).toHaveLength(1);
    expect(x.fetchAudio).toHaveBeenCalledTimes(2); expect(x.decode).toHaveBeenCalledTimes(1); expect(x.preview.stop).toHaveBeenCalled();
    const sign = x.request.mock.calls.find(([path]) => String(path).endsWith('/asset')) as unknown as [string, RequestInit?, CallOptions?];
    expect(sign[2]).toEqual(expect.objectContaining({ task: x.task, owner: USER }));
    session.dispose();
});

test('preview remains bound to its caller signal after start and a different item evicts the one-entry cache', async () => {
    const x = setup(), session = createBeatSongLibrarySession(x.deps), item = (await session.list(new AbortController().signal))[0];
    const lifetime = new AbortController(); await session.togglePreview(item, lifetime.signal); x.preview.stop.mockClear();
    lifetime.abort(); expect(x.preview.stop).toHaveBeenCalledTimes(1);
    const other = { ...item, id: `${USER}:${VERSION}`, ref: { ...item.ref, songId: USER } };
    await session.prepare(other, new AbortController().signal); await session.prepare(item, new AbortController().signal);
    expect(x.request.mock.calls.filter(([path]) => String(path).endsWith('/asset'))).toHaveLength(3);
    session.dispose();
});

test('signed download 401 re-signs exactly once; unavailable and malformed media do not retry', async () => {
    const auth = setup(), session = createBeatSongLibrarySession(auth.deps), item = (await session.list(new AbortController().signal))[0];
    let call = 0; auth.deps.fetchAudio = jest.fn(async () => ++call === 1 ? audioResponse(401) : audioResponse()) as unknown as typeof fetch;
    // The session captured deps by object, so replace the referenced implementation before constructing the retry session.
    session.dispose(); const retry = createBeatSongLibrarySession(auth.deps);
    await retry.prepare(item, new AbortController().signal);
    expect(auth.request.mock.calls.filter(([path]) => String(path).endsWith('/asset'))).toHaveLength(2);
    retry.dispose();

    for (const mode of ['404', '410', 'http', 'malformed', 'oversized'] as const) {
        const x = setup();
        if (mode === '404' || mode === '410') x.deps.fetchAudio = jest.fn(async () => audioResponse(Number(mode))) as unknown as typeof fetch;
        else if (mode === 'malformed') x.deps.fetchAudio = jest.fn(async () => audioResponse(200, new Uint8Array([1, 2, 3]))) as unknown as typeof fetch;
        else if (mode === 'oversized') x.deps.fetchAudio = jest.fn(async () => audioResponse(200, bytes, '120000001')) as unknown as typeof fetch;
        else x.request.mockImplementation(async path => String(path).endsWith('/asset') ? { url: 'http://signed.test/song' } : { songs: [row()] });
        const scoped = createBeatSongLibrarySession(x.deps), only = (await scoped.list(new AbortController().signal))[0];
        await expect(scoped.prepare(only, new AbortController().signal)).rejects.toMatchObject({ code: mode === '404' || mode === '410' ? 'unavailable' : 'invalidMedia' });
        expect(x.request.mock.calls.filter(([path]) => String(path).endsWith('/asset'))).toHaveLength(1); scoped.dispose();
    }
});

test('current/assertCurrent fence cached media by owner generation, disposal and signal', async () => {
    const x = setup(), session = createBeatSongLibrarySession(x.deps), signal = new AbortController();
    const item = (await session.list(signal.signal))[0]; await session.prepare(item, signal.signal);
    expect(session.current(signal.signal)).toBe(true); expect(() => session.assertCurrent(signal.signal)).not.toThrow();
    x.change(); expect(session.current(signal.signal)).toBe(false);
    expect(() => session.assertCurrent(signal.signal)).toThrow(expect.objectContaining({ code: 'accountChanged' }));
    await expect(session.prepare(item, signal.signal)).rejects.toMatchObject({ code: 'accountChanged' });
    signal.abort(); expect(() => session.assertCurrent(signal.signal)).toThrow(expect.objectContaining({ code: 'aborted' }));
    session.dispose(); expect(session.current()).toBe(false);
});

test('preview errors are typed, synchronous failures never return Playing, and stale errors cannot publish', async () => {
    const sync = setup(), syncSession = createBeatSongLibrarySession(sync.deps), syncItem = (await syncSession.list(new AbortController().signal))[0];
    sync.preview.start.mockImplementation((_buffer, _ended, failed) => failed(new Error('preview failed')));
    const syncError = jest.fn();
    await expect(syncSession.togglePreview(syncItem, new AbortController().signal, undefined, syncError)).rejects.toMatchObject({ code: 'invalidMedia' });
    expect(syncError).not.toHaveBeenCalled(); syncSession.dispose();

    const late = setup(), callbacks: Array<(error: unknown) => void> = [];
    late.preview.start.mockImplementation((_buffer, _ended, failed) => { callbacks.push(failed); });
    const session = createBeatSongLibrarySession(late.deps), item = (await session.list(new AbortController().signal))[0];
    const firstError = jest.fn(), firstEnded = jest.fn();
    expect(await session.togglePreview(item, new AbortController().signal, firstEnded, firstError)).toBe('playing');
    const other = { ...item, id: `${USER}:${VERSION}`, ref: { ...item.ref, songId: USER } };
    expect(await session.togglePreview(other, new AbortController().signal, jest.fn(), jest.fn())).toBe('playing');
    callbacks[0](new Error('stale')); expect(firstError).not.toHaveBeenCalled(); expect(firstEnded).not.toHaveBeenCalled();
    const liveError = jest.fn(); session.stopPreview();
    expect(await session.togglePreview(item, new AbortController().signal, jest.fn(), liveError)).toBe('playing');
    callbacks.at(-1)!(new Error('live')); expect(liveError).toHaveBeenCalledWith(expect.objectContaining({ code: 'invalidMedia' }));
    session.dispose();
});

test('prepare for Add supersedes preview and fences its late onerror', async () => {
    const x = setup(), errors: Array<(error: unknown) => void> = [];
    x.preview.start.mockImplementation((_buffer, _ended, failed) => { errors.push(failed); });
    const session = createBeatSongLibrarySession(x.deps), item = (await session.list(new AbortController().signal))[0], onError = jest.fn();
    await session.togglePreview(item, new AbortController().signal, undefined, onError); x.preview.stop.mockClear();
    const prepared = await session.prepare(item, new AbortController().signal); expect(prepared.asset.source).toBe('song');
    expect(x.preview.stop).toHaveBeenCalled(); errors[0](new Error('late')); expect(onError).not.toHaveBeenCalled(); session.dispose();
});

test('account change after decode and dispose during list fence all late publication', async () => {
    const changed = setup(), session = createBeatSongLibrarySession(changed.deps), item = (await session.list(new AbortController().signal))[0];
    changed.deps.decode = jest.fn(async () => { changed.change(); return { numberOfChannels: 1, sampleRate: 48000, length: 48000 }; });
    session.dispose();
    // A fresh session captures the same task, now stale.
    await expect(createBeatSongLibrarySession(changed.deps).prepare(item, new AbortController().signal)).rejects.toMatchObject({ code: 'accountChanged' });

    const late = setup(), wait = deferred<{ songs: ReturnType<typeof row>[] }>();
    late.request.mockImplementation(async () => wait.promise);
    const leaving = createBeatSongLibrarySession(late.deps), pending = leaving.list(new AbortController().signal); leaving.dispose(); wait.resolve({ songs: [row()] });
    await expect(pending).rejects.toMatchObject({ code: 'aborted' });
});

test('null owner refuses authenticated library work without issuing a request', async () => {
    const x = setup(); x.deps.beginSessionTask = () => ({ ...x.task, user: null });
    const session = createBeatSongLibrarySession(x.deps);
    await expect(session.list(new AbortController().signal)).rejects.toMatchObject({ code: 'expired' });
    expect(x.request).not.toHaveBeenCalled(); session.dispose();
});
