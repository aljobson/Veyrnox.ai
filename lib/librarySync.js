/**
 * Library favourites and the unsent Create draft follow the account (ADR-0340, migration 0500).
 *
 * Off until LIBRARY_SYNC_ENABLED is "true" (unset is off). The Worker var budget is full, so this flag ships ABSENT; the
 * owner frees a binding before turning it on.
 *
 * The draft is words and settings only: the subset of the web and mobile Create forms that both can restore. A file, an
 * idempotency key or anything else a client sends is dropped here, so restoring a draft never re-sends or re-charges.
 */
import { GENERATION_PROMPT_MAX } from './generationPromptLimits.js';
import { isUuidLoose } from './validate.js';

export const DRAFT_VERSION = 1;
export const ASPECTS = Object.freeze(['16:9', '9:16', '1:1', '4:5', '21:9']);
const MODEL_ID_RE = /^[A-Za-z0-9_.-]{1,100}$/;

export function librarySyncEnabled(env = process.env) {
    return env.LIBRARY_SYNC_ENABLED === 'true';
}

/** Exactly { job_id: <uuid>, starred: boolean } -> { ok: true, jobId, starred } | { ok: false }. */
export function cleanFavouriteBody(body) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) return { ok: false };
    if (Object.keys(body).some((k) => k !== 'job_id' && k !== 'starred')) return { ok: false };
    if (typeof body.job_id !== 'string' || !isUuidLoose(body.job_id) || typeof body.starred !== 'boolean') return { ok: false };
    return { ok: true, jobId: body.job_id.toLowerCase(), starred: body.starred };
}

const text = (value, max) => (typeof value === 'string' ? value.slice(0, max) : '');

/**
 * { draft: {...} } -> { ok: true, draft } with only the shared fields, or { ok: false }. An empty draft (no words) is
 * refused: the client clears instead.
 */
export function cleanDraftBody(body) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) return { ok: false };
    if (Object.keys(body).some((k) => k !== 'draft')) return { ok: false };
    const d = body.draft;
    if (!d || typeof d !== 'object' || Array.isArray(d)) return { ok: false };
    if (typeof d.modelId !== 'string' || !MODEL_ID_RE.test(d.modelId)) return { ok: false };
    if (typeof d.prompt !== 'string' || d.prompt.length > GENERATION_PROMPT_MAX) return { ok: false };
    const duration = Number.isInteger(d.duration) && d.duration >= 1 && d.duration <= 600 ? d.duration : null;
    const clean = {
        v: DRAFT_VERSION,
        modelId: d.modelId,
        prompt: d.prompt,
        duration,
        aspect: typeof d.aspect === 'string' && ASPECTS.includes(d.aspect) ? d.aspect : null,
        count: Number.isInteger(d.count) && d.count >= 1 && d.count <= 4 ? d.count : 1,
        seed: text(d.seed, 10),
        negative: text(d.negative, 2000),
        voice: text(d.voice, 500),
    };
    if (!clean.prompt.trim() && !clean.seed && !clean.negative.trim() && !clean.voice.trim()) return { ok: false };
    return { ok: true, draft: clean };
}

/** Reads the server's GET body defensively, so a client never trusts a shape it did not check. */
export function readSyncBody(body) {
    const ids = Array.isArray(body?.favourites) ? body.favourites.filter((id) => typeof id === 'string' && isUuidLoose(id)).slice(0, 200) : [];
    const parsed = body?.draft ? cleanDraftBody({ draft: body.draft }) : { ok: false };
    return { favourites: ids, draft: parsed.ok ? parsed.draft : null, draftUpdatedAt: typeof body?.draft_updated_at === 'string' ? body.draft_updated_at : null };
}
