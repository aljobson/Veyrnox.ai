// Music Library tabs (migration 0523): History, Hooks and Cover Art.
import { musicLibraryEnabled } from './musicBackend.js';
import { musicRuntimeFlag } from './musicRuntime.js';

export const MUSIC_HOOK_SECONDS_MIN = 5;
export const MUSIC_HOOK_SECONDS_MAX = 30;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HOOK_KEYS = new Set(['song_id', 'version_id', 'title', 'start_seconds', 'end_seconds', 'idempotency_key']);
const IDEMPOTENCY_RE = /^[A-Za-z0-9._-]{8,120}$/;

export const musicLibraryTabsEnabled = (env = process.env) => musicLibraryEnabled(env)
    && musicRuntimeFlag('libraryTabs', env);

const plain = (value) => value && typeof value === 'object' && !Array.isArray(value);

export function parseMusicListen(value) {
    if (!plain(value) || Object.keys(value).some((key) => key !== 'song_id')) return { ok: false, error: 'invalid_request' };
    if (!UUID_RE.test(value.song_id || '')) return { ok: false, error: 'song_id_invalid' };
    return { ok: true, songId: value.song_id };
}

export function parseMusicHook(value) {
    if (!plain(value) || !Object.keys(value).every((key) => HOOK_KEYS.has(key))) return { ok: false, error: 'invalid_request' };
    if (!UUID_RE.test(value.song_id || '') || !UUID_RE.test(value.version_id || '')) return { ok: false, error: 'song_id_invalid' };
    const title = typeof value.title === 'string' ? value.title.trim() : '';
    if (!title || title.length > 80) return { ok: false, error: 'title_invalid' };
    const start = Number.isFinite(value.start_seconds) ? Math.round(value.start_seconds * 1000) / 1000 : NaN;
    const end = Number.isFinite(value.end_seconds) ? Math.round(value.end_seconds * 1000) / 1000 : NaN;
    if (!(start >= 0) || !(end - start >= MUSIC_HOOK_SECONDS_MIN) || end - start > MUSIC_HOOK_SECONDS_MAX) {
        return { ok: false, error: 'hook_range_invalid' };
    }
    if (!IDEMPOTENCY_RE.test(value.idempotency_key || '')) return { ok: false, error: 'idempotency_key_invalid' };
    return { ok: true, songId: value.song_id, versionId: value.version_id, title, start, end, idempotencyKey: value.idempotency_key };
}

export function parseMusicCoverChoice(value) {
    if (!plain(value) || Object.keys(value).some((key) => key !== 'job_id')) return { ok: false, error: 'invalid_request' };
    if (value.job_id !== null && !UUID_RE.test(value.job_id || '')) return { ok: false, error: 'job_id_invalid' };
    return { ok: true, jobId: value.job_id };
}

/** One POST body for the consolidated route: an `action` plus that action's fields. */
export function parseMusicLibraryTabAction(value) {
    if (!plain(value)) return { ok: false, error: 'invalid_request' };
    const { action, ...rest } = value;
    if (action === 'listen') { const r = parseMusicListen(rest); return r.ok ? { ...r, action } : r; }
    if (action === 'create_hook') { const r = parseMusicHook(rest); return r.ok ? { ...r, action } : r; }
    if (action === 'delete_hook') {
        if (Object.keys(rest).some((k) => k !== 'hook_id') || !UUID_RE.test(rest.hook_id || '')) return { ok: false, error: 'hook_id_invalid' };
        return { ok: true, action, hookId: rest.hook_id };
    }
    if (action === 'set_cover') {
        const { song_id: songId, ...cover } = rest;
        if (!UUID_RE.test(songId || '')) return { ok: false, error: 'song_id_invalid' };
        const r = parseMusicCoverChoice(cover);
        return r.ok ? { ...r, action, songId } : r;
    }
    return { ok: false, error: 'action_invalid' };
}
