import { playbackReady } from './playbackReady';
import { ApiError, type ApiClient } from '../api';
import { countPlay, getPublicTrack } from './publicClient';
import type { PublicSession } from './publicSession';
import type { PlayerPort, PlayerState } from './player';
// Same native port as the library player; every async boundary and recovery is fenced here.
export function createPublicPlayback(o: { api: ApiClient; session: PublicSession; slug: string; creatorId: string; baseUrl: string;
    getAppState(): string | null | undefined; subscribeAppState(cb: (state: string | null | undefined) => void): () => void;
    factory(url: string): PlayerPort; setAudioMode(mode: { playsInSilentMode: true; shouldPlayInBackground: false }): Promise<void>;
    onState(state: PlayerState): void; plays?: { off: boolean } }) {
    let token = 0, disposed = false, player: PlayerPort | null = null, offStatus: (() => void) | null = null;
    let cancelReady: (() => void) | null = null, busy = false, counted = false;
    const plays = o.plays ?? { off: false };
    let countController: AbortController | null = null;
    let state: PlayerState = { state: 'idle', position: 0, duration: 0 };
    const emit = (patch: Partial<PlayerState>) => { state = { ...state, ...patch }; if (!disposed) o.onState(state); };
    const allowed = () => !disposed && o.getAppState() === 'active' && o.session.snapshot().availability === 'on' && !o.session.blocked(o.creatorId);
    function release() { cancelReady?.(); cancelReady = null; offStatus?.(); offStatus = null; player?.pause(); player?.remove(); player = null; }
    function pause() { ++token; busy = false; countController?.abort(); countController = null; release(); emit({ state: 'paused' }); }
    const offApp = o.subscribeAppState(value => { if (value !== 'active') pause(); });
    let revision = o.session.snapshot().revision, account = o.session.snapshot().account;
    const offBlocks = o.session.subscribe(() => {
        const next = o.session.snapshot();
        if (revision === next.revision) return;
        const accountChanged = account !== next.account; revision = next.revision; account = next.account;
        // Pending reads belong to the old revision. Already playing audio is unaffected by blocking somebody else.
        if (state.state !== 'playing' || accountChanged || !allowed()) pause();
    });
    async function start(recovery = false) {
        if (busy || state.state === 'playing' || !allowed()) return;
        busy = true; const ticket = ++token, rev = o.session.snapshot().revision;
        let started = false;
        const valid = () => allowed() && ticket === token && (started || rev === o.session.snapshot().revision);
        const position = state.state === 'ended' ? 0 : state.position;
        if (!recovery) counted = false;
        release(); emit({ state: 'loading' });
        try {
            const cached = o.session.track(o.slug);
            const page = cached ? { state: 'on' as const, data: cached } : await getPublicTrack(o.api, o.session, o.slug);
            if (!valid()) return;
            if (page.state !== 'on' || 'blocked' in page.data || page.data.track.creator_id !== o.creatorId) { pause(); return; }
            await o.setAudioMode({ playsInSilentMode: true, shouldPlayInBackground: false });
            if (!valid()) return;
            // Native HTTP playback follows the asset redirect. No auth header, signed URL cache or persistence.
            const p = o.factory(`${o.baseUrl}${page.data.track.audio_url}`); player = p;
            const waiting = playbackReady(p, status => {
                if (!valid()) { if (player === p) pause(); return; }
                if (status.error || ['error', 'failed'].includes(status.playbackState)) {
                    if (state.state === 'playing' && !recovery) {
                        pause(); void start(true);
                    } else if (state.state !== 'loading') { pause(); emit({ state: 'error' }); }
                    return;
                }
                emit({ position: status.currentTime, duration: status.duration });
                if (status.didJustFinish) { p.pause(); emit({ state: 'ended' }); }
            });
            offStatus = waiting.detach; cancelReady = waiting.cancel;
            const ok = await waiting.ready;
            if (!valid()) return;
            cancelReady = null;
            if (!ok) throw new Error('audio_load_failed');
            await p.seekTo(position);
            if (!valid()) return;
            p.play(); started = true; emit({ state: 'playing' });
            if (!counted && !plays.off && valid()) {
                counted = true; countController?.abort(); countController = new AbortController();
                void countPlay(o.api, o.slug, countController.signal).catch(e => { if (e instanceof ApiError && e.code === 'music_plays_unavailable') plays.off = true; });
            }
        } catch { if (valid()) { release(); emit({ state: 'error' }); } }
        finally { if (ticket === token) busy = false; }
    }
    return { start: () => start(), pause, snapshot: () => state,
        dispose() { if (disposed) return; pause(); disposed = true; offApp(); offBlocks(); },
    };
}
