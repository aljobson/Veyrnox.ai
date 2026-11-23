import { fetch as streamFetch } from 'expo/fetch';
import type { ApiClient, ClientTask } from '../api';
import { loadNativeContext } from './nativeContext';
import { createBeatSongLibrarySession, type BeatSongPreviewPort } from './songLibrary';
import type { DecodedAudio } from './remoteSong';
// @ts-ignore shared audio sample rate
import { AUDIO_RATE } from '../../../../../app/veyrnox/_lib/music/beat/beatAudioRules.mjs';

type PreviewSource = {
    buffer: unknown; onended: (() => void) | null; onerror?: (() => void) | null;
    connect(destination: unknown): unknown; disconnect(): void; start(at?: number): void; stop(at?: number): void;
};
type LibraryContext = {
    destination: unknown; decodeAudioData(bytes: ArrayBuffer): Promise<DecodedAudio>;
    createBufferSource(): PreviewSource; resume?(): Promise<void>; close?(): Promise<void>;
};

function previewPort(context: LibraryContext): BeatSongPreviewPort {
    let source: PreviewSource | null = null;
    const stop = () => {
        const previous = source; source = null;
        if (!previous) return;
        previous.onended = null; if ('onerror' in previous) previous.onerror = null;
        try { previous.stop(); } catch { /* Already ended. */ }
        try { previous.disconnect(); } catch { /* Already disconnected. */ }
    };
    return {
        async start(buffer, onEnded, onError) {
            stop(); await context.resume?.();
            const next = context.createBufferSource(); source = next; next.buffer = buffer;
            next.onended = () => { if (source !== next) return; source = null; next.disconnect(); onEnded(); };
            if ('onerror' in next) next.onerror = () => { if (source !== next) return; source = null; next.disconnect(); onError(new Error('audio_preview_failed')); };
            next.connect(context.destination); next.start(0);
        },
        stop,
        async dispose() { stop(); await context.close?.(); },
    };
}

export type BeatSongLibraryAuth = { api: ApiClient; beginSessionTask(): ClientTask };
/** Production native factory; the sheet owns and disposes one instance per open lifetime. */
export function createNativeBeatSongLibrarySession(auth: BeatSongLibraryAuth) {
    const Context = loadNativeContext();
    const context = new Context({ sampleRate: AUDIO_RATE, latencyHint: 'playback' }) as unknown as LibraryContext;
    return createBeatSongLibrarySession({ api: auth.api, beginSessionTask: auth.beginSessionTask,
        fetchAudio: streamFetch as unknown as typeof fetch, decode: bytes => context.decodeAudioData(bytes), preview: previewPort(context) });
}
