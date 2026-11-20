import type { PlayerPort, PlayerState } from './player';
import { playbackReady } from './playbackReady';
import { getSharedSong } from './sharedListenClient';
export function createListenPlayback(o: {
    token: string; baseUrl: string; getAppState(): string | null | undefined;
    subscribeAppState(cb: (state: string | null | undefined) => void): () => void;
    subscribeAccount(cb: () => void): () => void;
    factory(url: string): PlayerPort;
    setAudioMode(mode: { playsInSilentMode: true; shouldPlayInBackground: false }): Promise<void>;
    onState(state: PlayerState): void;
    read?: typeof getSharedSong;
}) {
    let intent = 0, disposed = false, busy = false, player: PlayerPort | null = null;
    let waiting: ReturnType<typeof playbackReady> | null = null, controller: AbortController | null = null;
    let state: PlayerState = { state: 'idle', position: 0, duration: 0 };
    const emit = (patch: Partial<PlayerState>) => { state = { ...state, ...patch }; if (!disposed) o.onState(state); };
    function release() { controller?.abort(); controller = null; waiting?.cancel(); waiting?.detach(); waiting = null; player?.pause(); player?.remove(); player = null; }
    function pause() { ++intent; busy = false; release(); emit({ state: 'paused' }); }
    const offApp = o.subscribeAppState(next => { if (next !== 'active') pause(); });
    const offAccount = o.subscribeAccount(pause);
    async function start() {
        if (disposed || busy || state.state === 'playing' || o.getAppState() !== 'active') return;
        const ticket = ++intent, position = state.state === 'ended' ? 0 : state.position;
        const valid = () => !disposed && ticket === intent && o.getAppState() === 'active';
        busy = true; release(); emit({ state: 'loading' }); controller = new AbortController();
        try {
            const song = await (o.read ?? getSharedSong)(o.token, controller.signal);
            if (!valid()) return;
            await o.setAudioMode({ playsInSilentMode: true, shouldPlayInBackground: false });
            if (!valid()) return;
            const p = o.factory(`${o.baseUrl}${song.audio_url}`); player = p;
            waiting = playbackReady(p, status => {
                if (!valid()) { if (player === p) pause(); return; }
                if (status.error || ['error', 'failed'].includes(status.playbackState)) {
                    if (state.state !== 'loading') { pause(); emit({ state: 'error' }); }
                    return;
                }
                emit({ position: status.currentTime, duration: status.duration });
                if (status.didJustFinish) { p.pause(); emit({ state: 'ended' }); }
            });
            const ready = await waiting.ready;
            if (!valid()) return;
            if (!ready) throw new Error('audio_load_failed');
            await p.seekTo(position);
            if (!valid()) return;
            p.play(); emit({ state: 'playing' });
        } catch { if (valid()) { release(); emit({ state: 'error' }); } }
        finally { if (ticket === intent) busy = false; }
    }
    return { start, pause, snapshot: () => state, dispose() { if (disposed) return; pause(); disposed = true; offApp(); offAccount(); } };
}
