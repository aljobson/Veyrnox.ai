import type { ApiClient } from '../api';
import { getSong } from './client';
import { songPlayback, type createMusicPlayer, type PlayerState } from './player';
import type { PlaylistSong } from './playlistTypes';
type Controller = ReturnType<typeof createMusicPlayer>;
export type PlaylistPlaybackState = Readonly<{ index: number; player: PlayerState; skipped: readonly string[] }>;
export function createPlaylistPlayback(o: {
    api: ApiClient; songs: readonly PlaylistSong[]; initialAppState: string | null | undefined;
    makePlayer(onState: (state: PlayerState) => void): Controller;
    subscribeAppState(cb: (state: string | null | undefined) => void): () => void;
    onState(state: PlaylistPlaybackState): void;
}) {
    let token = 0, loadedToken = -1, disposed = false, active = o.initialAppState === 'active', advancing = false, playingIntent = false;
    let state: PlaylistPlaybackState = { index: -1, player: { state: 'idle', position: 0, duration: 0 }, skipped: [] };
    const emit = (patch: Partial<PlaylistPlaybackState>) => { state = { ...state, ...patch }; if (!disposed) o.onState(state); };
    const player = o.makePlayer(value => {
        const justEnded = value.state === 'ended' && state.player.state === 'playing';
        emit({ player: value });
        if (justEnded && loadedToken === token && playingIntent && active && !advancing && !disposed) {
            advancing = true; const ticket = token;
            void Promise.resolve().then(() => {
                advancing = false;
                if (!disposed && active && ticket === token) return start(state.index + 1);
            });
        }
    });
    function pause() { ++token; loadedToken = -1; playingIntent = false; player.pause(); }
    const off = o.subscribeAppState(value => { active = value === 'active'; if (!active) pause(); });
    async function start(index: number) {
        pause(); const ticket = token;
        const valid = () => !disposed && active && ticket === token;
        if (!valid()) return;
        playingIntent = true;
        for (let i = Math.max(0, index); i < o.songs.length; i++) {
            if (!valid()) return;
            emit({ index: i });
            try {
                const song = await getSong(o.api, o.songs[i].id);
                if (!valid()) return;
                const input = songPlayback(song);
                loadedToken = ticket;
                const loaded = await player.load(input);
                if (!valid()) return;
                if (!loaded) { emit({ skipped: [...new Set([...state.skipped, o.songs[i].id])] }); continue; }
                await player.play();
                return;
            } catch {
                if (!valid()) return;
                emit({ skipped: [...new Set([...state.skipped, o.songs[i].id])] });
            }
        }
        playingIntent = false;
    }
    return { start, pause, next: () => start(state.index + 1), previous: () => start(Math.max(0, state.index - 1)),
        snapshot: () => state,
        dispose() { pause(); disposed = true; off(); player.dispose(); },
    };
}
