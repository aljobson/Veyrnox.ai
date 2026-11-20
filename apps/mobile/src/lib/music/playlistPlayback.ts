import type { ApiClient } from '../api';
import { getSong } from './client';
import { songPlayback, type createMusicPlayer, type PlayerState } from './player';
import type { PlaylistSong } from './playlistTypes';
type Controller = ReturnType<typeof createMusicPlayer>;
export type PlaylistPlaybackState = Readonly<{ index: number; player: PlayerState; skipped: readonly string[]; refused: boolean }>;
export function createPlaylistPlayback(o: {
    api: ApiClient; songs: readonly PlaylistSong[]; getAppState(): string | null | undefined;
    makePlayer(onState: (state: PlayerState) => void): Controller;
    subscribeAppState(cb: (state: string | null | undefined) => void): () => void;
    onState(state: PlaylistPlaybackState): void;
}) {
    let token = 0, loadedToken = -1, loadedIndex = -1, disposed = false, advancing = false, playingIntent = false;
    let state: PlaylistPlaybackState = { index: -1, player: { state: 'idle', position: 0, duration: 0 }, skipped: [], refused: false };
    const emit = (patch: Partial<PlaylistPlaybackState>) => { state = { ...state, ...patch }; if (!disposed) o.onState(state); };
    const startable = (explicit: boolean) => {
        const current = o.getAppState();
        return current === 'active' || (explicit && (current == null || current === 'unknown'));
    };
    const player = o.makePlayer(value => {
        const justEnded = value.state === 'ended' && state.player.state === 'playing';
        emit({ player: value });
        if (justEnded && loadedToken === token && playingIntent && startable(false) && !advancing && !disposed) {
            advancing = true; const ticket = token;
            void Promise.resolve().then(() => {
                advancing = false;
                if (!disposed && startable(false) && ticket === token) return start(state.index + 1, false);
            });
        }
    });
    function pause() { ++token; loadedToken = -1; playingIntent = false; player.pause(); }
    const off = o.subscribeAppState(value => { if (value !== 'active') pause(); });
    function begin(explicit: boolean) {
        if (disposed) return null;
        pause(); const ticket = token;
        if (!startable(explicit)) { emit({ refused: true }); return null; }
        emit({ refused: false }); playingIntent = true;
        return () => !disposed && ticket === token && startable(explicit);
    }
    async function start(index: number, explicit = true) {
        const valid = begin(explicit);
        if (!valid) return;
        if (explicit && index === 0) emit({ skipped: [] });
        loadedIndex = -1;
        for (let i = Math.max(0, index); i < o.songs.length; i++) {
            if (!valid()) return;
            emit({ index: i });
            try {
                const song = await getSong(o.api, o.songs[i].id);
                if (!valid()) return;
                const input = songPlayback(song);
                loadedToken = token;
                const loaded = await player.load(input);
                if (!valid()) return;
                if (!loaded) { emit({ skipped: [...new Set([...state.skipped, o.songs[i].id])] }); continue; }
                loadedIndex = i;
                emit({ skipped: state.skipped.filter(id => id !== o.songs[i].id) });
                await player.play();
                return;
            } catch {
                if (!valid()) return;
                emit({ skipped: [...new Set([...state.skipped, o.songs[i].id])] });
            }
        }
        playingIntent = false;
    }
    async function resume() {
        if (loadedIndex !== state.index || state.index < 0 || state.player.state !== 'paused') return start(Math.max(0, state.index));
        const valid = begin(true);
        if (!valid || !valid()) return;
        loadedToken = token;
        await player.play();
    }
    return { start, pause, resume, next: () => start(state.index + 1), previous: () => start(Math.max(0, state.index - 1)),
        snapshot: () => state,
        dispose() { if (disposed) return; pause(); disposed = true; off(); player.dispose(); },
    };
}
