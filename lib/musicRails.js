// "More by this creator" and "Similar" rails on a public track (0516, song page
// parity slice 2). Off unless MUSIC_RUNTIME_FLAGS rails is true.
import { musicPublicationEnabled } from './musicBackend.js';
import { musicRuntimeFlag } from './musicRuntime.js';

export const musicRailsEnabled = (env = process.env) => musicPublicationEnabled(env) && musicRuntimeFlag('rails', env);

const SLUG_RE = /^[a-f0-9]{24}$/;
const HANDLE_RE = /^[a-z][a-z0-9_]{2,29}$/;

/** Only the public fields, and only well-formed rows. */
export function publicMusicRail(rows) {
    if (!Array.isArray(rows)) return [];
    return rows.filter((row) => SLUG_RE.test(row?.slug || '') && HANDLE_RE.test(row?.handle || ''))
        .slice(0, 6)
        .map((row) => ({ slug: row.slug, title: String(row.title || '').slice(0, 120), handle: row.handle, display_name: String(row.display_name || '').slice(0, 80) }));
}
