// Public play counts and song reports (migration 0533).
import { musicPublicationEnabled } from './musicBackend.js';
import { musicRuntimeFlag } from './musicRuntime.js';
import { MUSIC_COMMENT_REPORT_CATEGORIES } from './musicComments.js';

const SLUG_RE = /^[a-f0-9]{24}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const IDEMPOTENCY_RE = /^[A-Za-z0-9._-]{8,120}$/;
const text = (value, min, max) => typeof value === 'string' && value.trim().length >= min && value.trim().length <= max;

export const musicPlaysEnabled = (env = process.env) => musicPublicationEnabled(env) && musicRuntimeFlag('plays', env);
export const musicSongReportsEnabled = (env = process.env) => musicPublicationEnabled(env) && musicRuntimeFlag('songReports', env);

export function parseMusicPlay(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || value.action !== 'count_play' || Object.keys(value).some((k) => !['action', 'slug'].includes(k))) return { ok: false, error: 'invalid_request' };
    if (!SLUG_RE.test(value.slug || '')) return { ok: false, error: 'slug_invalid' };
    return { ok: true, slug: value.slug };
}

export function parseMusicSongReport(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return { ok: false, error: 'invalid_request' };
    const { action, idempotency_key: key, ...rest } = value;
    if (action !== 'report_song') return { ok: false, error: 'action_invalid' };
    if (!IDEMPOTENCY_RE.test(key || '')) return { ok: false, error: 'idempotency_key_invalid' };
    if (Object.keys(rest).some((k) => !['slug', 'category', 'details'].includes(k))) return { ok: false, error: 'invalid_request' };
    if (!SLUG_RE.test(rest.slug || '')) return { ok: false, error: 'slug_invalid' };
    if (!MUSIC_COMMENT_REPORT_CATEGORIES.includes(rest.category)) return { ok: false, error: 'category_invalid' };
    if (!text(rest.details, 3, 500)) return { ok: false, error: 'details_invalid' };
    return { ok: true, idempotencyKey: key, payload: { action: 'report_song', slug: rest.slug, category: rest.category, details: rest.details.trim() } };
}

export function parseMusicSongReportResolve(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return { ok: false, error: 'body_invalid' };
    if (Object.keys(value).some((k) => !['action', 'id', 'reason'].includes(k)) || value.action !== 'resolve_song_report') return { ok: false, error: 'action_invalid' };
    if (!UUID_RE.test(value.id || '')) return { ok: false, error: 'id_invalid' };
    if (!text(value.reason, 3, 500)) return { ok: false, error: 'reason_invalid' };
    return { ok: true, payload: { action: 'resolve_song_report', id: value.id.toLowerCase(), reason: value.reason.trim() } };
}

/** The only play field a public read carries. */
export const publicPlayCount = (result) => Math.max(0, Math.floor(Number(result?.play_count) || 0));
