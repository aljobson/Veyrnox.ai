import { isRecord } from '../responseShapes';
import type { Playlist, PlaylistReceipt, PlaylistSong } from './playlistTypes';
export const playlistUuid = (v: unknown): v is string => typeof v === 'string' && v.length === 36
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
export const playlistTitle = (v: unknown): v is string => typeof v === 'string'
    && v.trim().length > 0 && v.length <= 80 && !/[\u0000-\u001f]/.test(v);
export const playlistRevision = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
export const playlistKey = (v: string) => /^[A-Za-z0-9._-]{8,120}$/.test(v) && !/\s/.test(v);
export const playlistTimestamp = (v: unknown) => {
    if (typeof v !== 'string' || !/^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(v) || /\s/.test(v)) return false;
    const [year, month, day] = v.slice(0, 10).split('-').map(Number);
    const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    return day <= [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
};
export function isPlaylistSong(v: unknown): v is PlaylistSong {
    return isRecord(v) && playlistUuid(v.id) && playlistUuid(v.version_id) && typeof v.title === 'string'
        && typeof v.audio_url === 'string' && !/\s/.test(v.audio_url) && /^\/api\/v1\/jobs\/[0-9a-f-]{36}\/asset$/.test(v.audio_url)
        && Number.isSafeInteger(v.position) && (v.position as number) > 0;
}
export function isPlaylist(v: unknown, requireCreated = false): v is Playlist {
    if (!isRecord(v) || !playlistUuid(v.id) || !playlistTitle(v.title) || typeof v.pinned !== 'boolean'
        || !playlistRevision(v.revision) || ((requireCreated || 'created_at' in v) && !playlistTimestamp(v.created_at))
        || !Array.isArray(v.songs) || v.songs.length > 100 || !v.songs.every(isPlaylistSong)) return false;
    const ids = new Set<string>(); let position = 0;
    for (const song of v.songs) {
        if (ids.has(song.id.toLowerCase()) || song.position <= position) return false;
        ids.add(song.id.toLowerCase()); position = song.position;
    }
    return true;
}
export function isPlaylistList(v: unknown): v is { playlists: Playlist[] } {
    return isRecord(v) && Array.isArray(v.playlists) && v.playlists.every(p => isPlaylist(p, true))
        && new Set(v.playlists.map(p => p.id.toLowerCase())).size === v.playlists.length;
}
export const isPlaylistCreate = (v: unknown): v is { playlist: Playlist } => isRecord(v) && isPlaylist(v.playlist);
export const isPlaylistReceipt = (v: unknown): v is PlaylistReceipt => isRecord(v) && playlistRevision(v.revision) && typeof v.idempotent === 'boolean';
