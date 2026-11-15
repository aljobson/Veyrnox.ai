// Lyrics with a copy button and Explore "Best of" playlists (migration 0535).
import { musicLibraryEnabled, musicPublicationEnabled } from './musicBackend.js';
import { musicRuntimeFlag } from './musicRuntime.js';

export const MUSIC_BEST_OF_GENRES = Object.freeze([
    'pop', 'hip-hop', 'rock', 'electronic', 'house', 'lo-fi', 'jazz', 'rnb-soul', 'ambient', 'cinematic', 'country-folk', 'latin',
]);

export const musicLyricsEnabled = (env = process.env) => musicLibraryEnabled(env) && musicRuntimeFlag('lyrics', env);
export const musicPublicLyricsEnabled = (env = process.env) => musicPublicationEnabled(env) && musicRuntimeFlag('lyrics', env);
export const musicBestOfEnabled = (env = process.env) => musicPublicationEnabled(env) && musicRuntimeFlag('bestOf', env);

/** Lyrics as plain text, at most the 3,000 characters a prompt spec can hold; anything else is no lyrics. */
export function publicLyrics(value) {
    return typeof value === 'string' && value.trim() ? value.slice(0, 3000) : null;
}

const SLUG_RE = /^[a-f0-9]{24}$/;
const HANDLE_RE = /^[a-z][a-z0-9_]{2,29}$/;
const publicTracks = (rows) => (Array.isArray(rows) ? rows : [])
    .filter((row) => SLUG_RE.test(row?.slug || '') && HANDLE_RE.test(row?.handle || ''))
    .slice(0, 8)
    .map((row) => ({ slug: row.slug, title: String(row.title || '').slice(0, 120), handle: row.handle, display_name: String(row.display_name || '').slice(0, 80) }));

/** Only the known genres, each with the public rail fields only. */
export function publicBestOf(result) {
    const rows = Array.isArray(result?.playlists) ? result.playlists : [];
    return rows.filter((row) => MUSIC_BEST_OF_GENRES.includes(row?.genre))
        .map((row) => ({ genre: row.genre, tracks: publicTracks(row.tracks) }))
        .filter((row) => row.tracks.length);
}
