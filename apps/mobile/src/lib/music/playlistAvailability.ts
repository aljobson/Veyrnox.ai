import { ApiError, type ApiClient } from '../api';
import { getSong } from './client';
import type { Playlist } from './playlistTypes';
export const playlistFingerprint = (p: Playlist) => JSON.stringify([p.id, p.revision, p.songs.map(s => s.id)]);
export type PlaylistScan = Readonly<{ fingerprint: string; unavailable: readonly string[] }>;
// Only a completed, current-session scan is retained by the flow. No bounded library-page inference.
export async function scanPlaylist(api: ApiClient, playlist: Playlist, current: () => boolean): Promise<PlaylistScan> {
    const unavailable: string[] = []; let next = 0;
    let failure: unknown; let aborted = false;
    const worker = async () => {
        while (!aborted && current() && next < playlist.songs.length) {
            const id = playlist.songs[next++].id;
            try {
                const song = await getSong(api, id);
                if (song.lifecycle_status === 'trashed') unavailable.push(id);
            } catch (error) {
                if (error instanceof ApiError && error.status === 404 && error.code === 'not_found') unavailable.push(id);
                else { aborted = true; failure = error; }
            }
        }
    };
    await Promise.all([worker(), worker(), worker()]);
    if (!current()) throw new ApiError(409, 'scan_stale');
    if (aborted) throw failure;
    return { fingerprint: playlistFingerprint(playlist), unavailable };
}
export const isPlaylistUnavailable = (error: unknown) => error instanceof ApiError && error.status === 404
    && /^(?:[a-z_]+_)?unavailable$/.test(error.code);
