import { randomUUID } from 'expo-crypto';
import { ApiError, type ApiClient } from '../api';
import { createPlaylist, replacePlaylistSongs, setPlaylistPinned } from './playlistsClient';
import type { Playlist, PlaylistReceipt, PlaylistWrite } from './playlistTypes';
type Attempt = Readonly<{ key: string; write: PlaylistWrite }>;
// Auth/flag gates run before receipt lookup, so their rejections cannot resolve an earlier unknown write.
const DEFINITIVE = new Set(['title_invalid', 'idempotency_key_invalid', 'idempotency_conflict',
    'revision_conflict', 'revision_invalid', 'song_ids_invalid', 'playlist_id_invalid', 'invalid_songs',
    'invalid_request', 'invalid_inputs', 'invalid_json', 'body_too_large', 'not_found']);
export function createPlaylistAttempts(api: ApiClient, mint = randomUUID) {
    let pending: Attempt | null = null, flight: Promise<Playlist | PlaylistReceipt> | null = null, epoch = 0;
    return {
        snapshot: () => pending,
        reset() { ++epoch; pending = null; flight = null; },
        run(write: PlaylistWrite): Promise<Playlist | PlaylistReceipt> {
            if (flight) return flight;
            if (pending && JSON.stringify(pending.write) !== JSON.stringify(write)) return Promise.reject(new ApiError(409, 'pending_result'));
            if (!pending) pending = Object.freeze({ key: `playlist.${mint()}`, write: JSON.parse(JSON.stringify(write)) as PlaylistWrite });
            const attempt = pending, token = epoch;
            flight = Promise.resolve().then<Playlist | PlaylistReceipt>(() => {
                if (token !== epoch) throw new ApiError(401, 'account_changed');
                const w = attempt.write;
                return w.kind === 'create' ? createPlaylist(api, w.title, attempt.key)
                    : w.edit.action === 'replace' ? replacePlaylistSongs(api, w.id, w.edit.expected_revision, w.edit.song_ids, attempt.key)
                        : setPlaylistPinned(api, w.id, w.edit.expected_revision, w.edit.pinned, attempt.key);
            }).then(result => {
                if (token !== epoch) throw new ApiError(401, 'account_changed');
                pending = null; return result;
            }).catch(error => {
                if (token === epoch && error instanceof ApiError && error.status >= 400 && error.status < 500
                    && DEFINITIVE.has(error.code)) pending = null;
                throw error;
            }).finally(() => { if (token === epoch) flight = null; });
            return flight;
        },
    };
}
