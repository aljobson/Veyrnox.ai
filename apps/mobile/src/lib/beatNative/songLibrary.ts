import type { ApiClient, CallOptions, ClientTask } from '../api';
import { listSongs } from '../music/client';
import { librarySongs, type BeatLibrarySong } from './librarySongs';
import { prepareRemoteSong, type DecodedAudio, type PreparedRemoteSong } from './remoteSong';
export type { BeatLibrarySong } from './librarySongs';
export type { PreparedRemoteSong } from './remoteSong';

export type BeatSongLibraryErrorCode = 'offline' | 'expired' | 'accountChanged' | 'featureUnavailable' | 'held'
    | 'unavailable' | 'invalidMedia' | 'rateLimited' | 'service' | 'aborted' | 'unknown';
type ErrorPolicy = { retryable: boolean; retainRows: boolean };
const policies: Record<BeatSongLibraryErrorCode, ErrorPolicy> = {
    offline: { retryable: true, retainRows: true }, expired: { retryable: false, retainRows: false },
    accountChanged: { retryable: false, retainRows: false }, featureUnavailable: { retryable: false, retainRows: false },
    held: { retryable: false, retainRows: true }, unavailable: { retryable: false, retainRows: true },
    invalidMedia: { retryable: false, retainRows: true }, rateLimited: { retryable: true, retainRows: true },
    service: { retryable: true, retainRows: true }, aborted: { retryable: false, retainRows: true },
    unknown: { retryable: true, retainRows: true },
};
export class BeatSongLibraryError extends Error {
    readonly retryable: boolean;
    readonly retainRows: boolean;
    constructor(readonly code: BeatSongLibraryErrorCode, readonly original?: unknown) {
        super(`beat_song_library_${code}`, original === undefined ? undefined : { cause: original });
        this.name = 'BeatSongLibraryError';
        ({ retryable: this.retryable, retainRows: this.retainRows } = policies[code]);
    }
}
function facts(error: unknown) {
    let value: unknown = error, status: number | undefined, code: string | undefined, name: string | undefined;
    for (let depth = 0; depth < 5 && value && typeof value === 'object'; depth++) {
        const row = value as { status?: unknown; code?: unknown; name?: unknown; cause?: unknown };
        if (status === undefined && typeof row.status === 'number') status = row.status;
        if (code === undefined && typeof row.code === 'string') code = row.code;
        if (name === undefined && typeof row.name === 'string') name = row.name;
        value = row.cause;
    }
    return { status, code, name };
}
export function classifyBeatSongLibraryError(error: unknown, phase: 'request' | 'media' = 'request'): BeatSongLibraryError {
    if (error instanceof BeatSongLibraryError) return error;
    const { status, code, name } = facts(error);
    let kind: BeatSongLibraryErrorCode;
    if (name === 'AbortError' || code === 'aborted') kind = 'aborted';
    else if (code === 'account_changed') kind = 'accountChanged';
    else if (status === 401 || code === 'not_authenticated') kind = 'expired';
    else if (code === 'music_library_unavailable' || code === 'music_unavailable') kind = 'featureUnavailable';
    else if (code === 'held') kind = 'held';
    else if (status === 404 || status === 410) kind = 'unavailable';
    else if (status === 429) kind = 'rateLimited';
    else if (status === 0 || code === 'network' || (phase === 'request' && error instanceof TypeError)) kind = 'offline';
    else if (status !== undefined && status >= 500) kind = 'service';
    else if (phase === 'media' || code === 'invalid_media') kind = 'invalidMedia';
    else kind = 'unknown';
    return new BeatSongLibraryError(kind, error);
}

export type BeatSongPreviewPort = {
    start(buffer: DecodedAudio, onEnded: () => void, onError: (error: unknown) => void): void | Promise<void>;
    stop(): void;
    dispose?(): void | Promise<void>;
};
export type BeatSongLibrarySessionDeps = {
    api: ApiClient;
    beginSessionTask(): ClientTask;
    fetchAudio: typeof fetch;
    decode(bytes: ArrayBuffer): Promise<DecodedAudio>;
    preview: BeatSongPreviewPort;
};
export type BeatSongLibrarySession = {
    current(signal?: AbortSignal): boolean;
    assertCurrent(signal?: AbortSignal): void;
    list(signal: AbortSignal): Promise<readonly BeatLibrarySong[]>;
    prepare(item: BeatLibrarySong, signal: AbortSignal): Promise<PreparedRemoteSong>;
    togglePreview(item: BeatLibrarySong, signal: AbortSignal, onEnded?: () => void,
        onError?: (error: BeatSongLibraryError) => void): Promise<'playing' | 'stopped'>;
    stopPreview(): void;
    dispose(): void;
};

function linked(signals: readonly AbortSignal[]) {
    const controller = new AbortController();
    const listeners = new Map<AbortSignal, () => void>();
    for (const signal of signals) {
        const stop = () => controller.abort(signal.reason);
        if (signal.aborted) { stop(); break; }
        signal.addEventListener('abort', stop, { once: true }); listeners.set(signal, stop);
    }
    return { signal: controller.signal, close() { for (const [signal, stop] of listeners) signal.removeEventListener('abort', stop); listeners.clear(); } };
}

/** One sheet lifetime, one captured account task, one decoded-song cache and one preview. */
export function createBeatSongLibrarySession(deps: BeatSongLibrarySessionDeps): BeatSongLibrarySession {
    const task = deps.beginSessionTask();
    const owner = task.user;
    const lifetime = new AbortController();
    let disposed = false, cache: { id: string; owner: string; gen: number; prepared: PreparedRemoteSong } | undefined;
    let listAbort: AbortController | undefined, actionAbort: AbortController | undefined, actionEpoch = 0, playingId: string | null = null;
    let previewWatch: { signal: AbortSignal; close(): void; stop(): void } | undefined;
    const active = () => !disposed && owner !== null && task.current();
    function ensure(signal?: AbortSignal) {
        if (signal?.aborted) throw new BeatSongLibraryError('aborted', signal.reason);
        if (owner === null) throw new BeatSongLibraryError('expired');
        if (disposed) throw new BeatSongLibraryError('aborted');
        if (!task.current()) throw new BeatSongLibraryError('accountChanged');
    }
    const scoped = (signal: AbortSignal): ApiClient => ({
        request: (path: string, init: RequestInit = {}, options: CallOptions = {}) =>
            deps.api.request(path, { ...init, signal }, { ...options, task, owner: owner ?? undefined }),
        stream: (path: string, init: RequestInit = {}, options: CallOptions = {}) =>
            deps.api.stream(path, { ...init, signal }, { ...options, task, owner: owner ?? undefined }),
        getBalance: () => deps.api.getBalance(),
    });
    function releasePreviewWatch() {
        const watch = previewWatch; previewWatch = undefined;
        if (!watch) return; watch.signal.removeEventListener('abort', watch.stop); watch.close();
    }
    function stopPreviewOnly() {
        playingId = null; releasePreviewWatch();
        try { deps.preview.stop(); } catch { /* Teardown is idempotent. */ }
    }
    function stopPreview() {
        const activeAction = actionAbort; actionAbort = undefined; ++actionEpoch; activeAction?.abort(); stopPreviewOnly();
    }
    function beginAction(external: AbortSignal) {
        stopPreview();
        actionAbort = new AbortController(); const epoch = ++actionEpoch;
        const connection = linked([lifetime.signal, actionAbort.signal, external]);
        return { epoch, ...connection };
    }
    async function prepareCurrent(item: BeatLibrarySong, signal: AbortSignal): Promise<PreparedRemoteSong> {
        ensure(signal);
        if (cache?.id === item.id && cache.owner === owner && cache.gen === task.gen) return cache.prepared;
        try {
            const prepared = await prepareRemoteSong({ id: item.ref.songId, version_id: item.ref.versionId, job_id: item.ref.jobId, title: item.name }, {
                current: active, fetchAudio: deps.fetchAudio, decode: deps.decode,
                sign: (jobId, requestSignal) => scoped(requestSignal).request(`/api/v1/jobs/${encodeURIComponent(jobId)}/asset`),
            }, signal);
            ensure(signal); cache = { id: item.id, owner: owner!, gen: task.gen, prepared }; return prepared;
        } catch (error) { throw classifyBeatSongLibraryError(error, 'media'); }
    }
    return {
        current(signal) { try { ensure(signal); return true; } catch { return false; } },
        assertCurrent: ensure,
        async list(external) {
            listAbort?.abort(); listAbort = new AbortController();
            const connection = linked([lifetime.signal, listAbort.signal, external]);
            try {
                ensure(connection.signal);
                const rows = await listSongs(scoped(connection.signal), { limit: 50 });
                ensure(connection.signal); return librarySongs(rows);
            } catch (error) { throw classifyBeatSongLibraryError(error); }
            finally { connection.close(); }
        },
        async prepare(item, external) {
            const action = beginAction(external);
            try {
                const prepared = await prepareCurrent(item, action.signal);
                ensure(action.signal); if (action.epoch !== actionEpoch) throw new BeatSongLibraryError('aborted');
                return prepared;
            } finally { action.close(); }
        },
        async togglePreview(item, external, onEnded = () => {}, onError = () => {}) {
            if (playingId === item.id) { stopPreview(); return 'stopped'; }
            const action = beginAction(external);
            try {
                const prepared = await prepareCurrent(item, action.signal);
                ensure(action.signal); if (action.epoch !== actionEpoch) throw new BeatSongLibraryError('aborted');
                playingId = item.id;
                const ended = () => {
                    if (disposed || action.epoch !== actionEpoch || playingId !== item.id) return;
                    playingId = null; releasePreviewWatch(); onEnded();
                };
                let startSettled = false, previewFailure: BeatSongLibraryError | undefined;
                const failed = (error: unknown) => {
                    if (disposed || action.epoch !== actionEpoch || playingId !== item.id) return;
                    const typed = classifyBeatSongLibraryError(error, 'media');
                    playingId = null; releasePreviewWatch();
                    if (startSettled) onError(typed); else previewFailure = typed;
                };
                await deps.preview.start(prepared.buffer, ended, failed);
                startSettled = true;
                if (previewFailure) throw previewFailure;
                ensure(action.signal); if (action.epoch !== actionEpoch) throw new BeatSongLibraryError('aborted');
                const watch = linked([lifetime.signal, actionAbort!.signal, external]);
                const stop = () => { if (action.epoch === actionEpoch) stopPreview(); };
                previewWatch = { ...watch, stop }; watch.signal.addEventListener('abort', stop, { once: true });
                return 'playing';
            } catch (error) {
                if (action.epoch === actionEpoch) stopPreview();
                throw classifyBeatSongLibraryError(error, 'media');
            }
            finally { action.close(); }
        },
        stopPreview,
        dispose() {
            if (disposed) return; disposed = true; ++actionEpoch; lifetime.abort(); listAbort?.abort(); actionAbort?.abort();
            stopPreviewOnly(); cache = undefined;
            try { void Promise.resolve(deps.preview.dispose?.()).catch(() => undefined); } catch { /* Teardown is best-effort. */ }
        },
    };
}
