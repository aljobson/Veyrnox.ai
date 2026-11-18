import { ApiError } from '../api';
import { isRecord } from '../responseShapes';
import { MUSIC_ASSET_PATH, isPlayableMusicHook } from './validate';
import type { MusicHook, MusicSongDetail } from './types';

export type PlaybackInput = { songId: string; jobId: string; start: number; end?: number };
export function songPlayback(song: MusicSongDetail): PlaybackInput {
    if (song.lifecycle_status === 'trashed' || song.audio_url === null) throw new ApiError(404, 'not_found');
    const crop = song.provenance.crop;
    const bounded = song.provenance.render_state !== 'canonical' && isRecord(crop)
        && typeof crop.start_seconds === 'number' && Number.isFinite(crop.start_seconds)
        && typeof crop.end_seconds === 'number' && Number.isFinite(crop.end_seconds)
        && crop.start_seconds >= 0 && crop.end_seconds > crop.start_seconds;
    return { songId: song.id, jobId: song.job_id, start: bounded ? crop.start_seconds as number : 0,
        ...(bounded ? { end: crop.end_seconds as number } : {}) };
}
export function hookPlayback(hook: MusicHook): PlaybackInput {
    if (!isPlayableMusicHook(hook)) throw new ApiError(200, 'bad_response');
    const match = MUSIC_ASSET_PATH.exec(hook.audio_url)!;
    return { songId: hook.song_id, jobId: match[1], start: hook.start_seconds, end: hook.end_seconds };
}
export type PlayerState = { state: 'idle' | 'loading' | 'playing' | 'paused' | 'error' | 'held' | 'ended' | 'background'; position: number; duration: number; retryAt?: number };
export type PlaybackStatus = { isLoaded: boolean; playing: boolean; currentTime: number; duration: number; didJustFinish: boolean; playbackState: string; error?: string | null };
export type PlayerPort = {
    isLoaded: boolean;
    play(): void; pause(): void; seekTo(seconds: number): Promise<void>; remove(): void;
    addListener(event: 'playbackStatusUpdate', cb: (status: PlaybackStatus) => void): { remove(): void };
};
type Options = {
    getAsset(jobId: string): Promise<{ url: string; mime_type: string; asset_expires_at?: string }>;
    factory(url: string): PlayerPort;
    setAudioMode(mode: { playsInSilentMode: true; shouldPlayInBackground: false }): Promise<void>;
    subscribeAppState(cb: (state: string | null | undefined) => void): () => void;
    recordListen(songId: string): Promise<void>;
    onState(state: PlayerState): void;
    now?: () => number;
};
// Native handles belong to the focused screen. All URL state is ephemeral, never logged or persisted.
export function createMusicPlayer(o: Options) {
    const now = o.now ?? Date.now;
    let input: PlaybackInput | null = null, player: PlayerPort | null = null;
    let subscription: { remove(): void } | null = null;
    let cancelReady: (() => void) | null = null;
    let state: PlayerState = { state: 'idle', position: 0, duration: 0 };
    let epoch = 0, expires = 0, disposed = false, background = false, wanted = false, recovering = false;
    let retried = false, starting = false;
    const emit = (patch: Partial<PlayerState>) => { state = { ...state, ...patch }; if (!disposed) o.onState(state); };
    function release() {
        cancelReady?.(); cancelReady = null;
        subscription?.remove(); subscription = null;
        const old = player; player = null;
        if (old) { old.pause(); old.remove(); }
    }
    function fail(err: unknown) {
        wanted = false; release();
        emit({ state: err instanceof ApiError && err.code === 'held' ? 'held' : 'error',
            retryAt: err instanceof ApiError && err.status === 429 ? now() + (err.retryAfterSeconds ?? 60) * 1000 : undefined });
    }
    async function resolve(position: number): Promise<boolean> {
        const ticket = ++epoch;
        release(); emit({ state: 'loading', retryAt: undefined });
        try {
            await o.setAudioMode({ playsInSilentMode: true, shouldPlayInBackground: false });
            if (disposed || ticket !== epoch || !input) return false;
            const asset = await o.getAsset(input.jobId);
            if (disposed || ticket !== epoch) return false;
            // asset_expires_at is file retention, NOT the signed URL expiry. Resolve before its 15-minute TTL.
            expires = now() + 12 * 60_000;
            const p = o.factory(asset.url); player = p;
            let ready: (value: boolean) => void = () => {};
            const loaded = new Promise<boolean>(r => { ready = r; });
            const timer = setTimeout(() => ready(false), 30_000);
            cancelReady = () => { clearTimeout(timer); ready(false); };
            subscription = p.addListener('playbackStatusUpdate', status => {
                if (ticket !== epoch || disposed) return;
                if (status.error || status.playbackState === 'error' || status.playbackState === 'failed') {
                    ready(false); void recover(); return;
                }
                if (status.isLoaded) ready(true);
                if (status.didJustFinish || (input?.end !== undefined && status.currentTime >= input.end)) {
                    wanted = false; p.pause(); emit({ state: 'ended', position: input?.end ?? status.currentTime }); return;
                }
                emit({ position: status.currentTime, duration: status.duration,
                    ...(state.state === 'loading' || state.state === 'ended' || state.state === 'background' ? {} : { state: status.playing ? 'playing' : 'paused' }) });
            });
            if (p.isLoaded) ready(true);
            const ok = await loaded; clearTimeout(timer);
            if (ticket !== epoch || disposed) return false;
            cancelReady = null;
            if (!ok) throw new Error('audio_load_failed');
            await p.seekTo(position);
            if (ticket !== epoch || disposed) return false;
            emit({ state: 'paused', position });
            return true;
        } catch (error) { if (ticket === epoch && !disposed) fail(error); return false; }
    }
    async function recover() {
        if (recovering || disposed) return;
        if (retried) { ++epoch; fail(new Error('audio_failed')); return; }
        recovering = true; retried = true;
        const position = state.position;
        const ok = await resolve(position);
        recovering = false;
        if (ok && wanted && !background && player) {
            try { player.play(); emit({ state: 'playing' }); } catch (error) { fail(error); }
        }
    }
    const unsubscribe = o.subscribeAppState(value => {
        background = value === 'background';
        // A transition away pauses playback; only background prevents a later explicit start.
        if (value !== 'active') pause();
    });
    function pause() { wanted = false; player?.pause(); if (state.state === 'playing') emit({ state: 'paused' }); }
    return {
        getState: () => state,
        async load(next: PlaybackInput) {
            input = next; wanted = false; retried = false;
            emit({ position: next.start, duration: 0 });
            return resolve(next.start);
        },
        async play() {
            if (disposed || !input) return;
            if (background) { emit({ state: 'background' }); return; }
            if (starting || state.state === 'playing' || state.state === 'loading'
                || (state.retryAt !== undefined && now() < state.retryAt)) return;
            starting = true; wanted = true;
            try {
                if (!player || now() >= expires) {
                    retried = false;
                    if (!await resolve(state.state === 'ended' ? input.start : state.position)) return;
                } else if (state.state === 'ended') await player.seekTo(input.start);
                if (!wanted || background || disposed || !player) return;
                // One record per explicit start; automatic URL recovery never records another listen.
                const songId = input.songId;
                void Promise.resolve().then(() => o.recordListen(songId)).catch(() => {});
                try { player.play(); emit({ state: 'playing' }); } catch { await recover(); }
            } catch (error) { fail(error); } finally { starting = false; }
        },
        pause,
        async seek(seconds: number) {
            if (!player || !input || !Number.isFinite(seconds)) return;
            const position = Math.max(input.start, Math.min(seconds, input.end ?? (state.duration || Infinity)));
            try { await player.seekTo(position); emit({ position }); } catch { await recover(); }
        },
        dispose() { disposed = true; wanted = false; ++epoch; unsubscribe(); release(); },
    };
}
