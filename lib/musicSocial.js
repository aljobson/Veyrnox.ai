// Song reactions and creator follows (0515, song page parity slice 1). Both sit
// on top of public publication and are off unless their MUSIC_RUNTIME_FLAGS key is on.
import { musicPublicationEnabled } from './musicBackend.js';
import { musicRuntimeFlag } from './musicRuntime.js';

import { MUSIC_REACTIONS } from './musicReactions.js';

export { MUSIC_REACTIONS };

export const musicReactionsEnabled = (env = process.env) => musicPublicationEnabled(env) && musicRuntimeFlag('reactions', env);
export const musicFollowsEnabled = (env = process.env) => musicPublicationEnabled(env) && musicRuntimeFlag('follows', env);
export const musicSocialEnabled = (env = process.env) => musicReactionsEnabled(env) || musicFollowsEnabled(env);

const SLUG_RE = /^[a-f0-9]{24}$/;
const HANDLE_RE = /^[a-z][a-z0-9_]{2,29}$/;
const IDEMPOTENCY_RE = /^[A-Za-z0-9._-]{8,120}$/;

export const validMusicSlug = (value) => typeof value === 'string' && SLUG_RE.test(value);
export const validMusicHandle = (value) => typeof value === 'string' && HANDLE_RE.test(value);

/** Exactly one of { slug, reaction } or { handle, following }, plus an idempotency key. */
export function parseMusicSocialWrite(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return { ok: false, error: 'invalid_request' };
    const keys = Object.keys(value).sort().join(',');
    if (!IDEMPOTENCY_RE.test(value.idempotency_key || '')) return { ok: false, error: 'idempotency_key_invalid' };
    if (keys === 'idempotency_key,reaction,slug') {
        if (!validMusicSlug(value.slug)) return { ok: false, error: 'slug_invalid' };
        if (value.reaction !== null && !MUSIC_REACTIONS.includes(value.reaction)) return { ok: false, error: 'reaction_invalid' };
        return { ok: true, kind: 'reaction', slug: value.slug, reaction: value.reaction, idempotencyKey: value.idempotency_key };
    }
    if (keys === 'following,handle,idempotency_key') {
        if (!validMusicHandle(value.handle)) return { ok: false, error: 'handle_invalid' };
        if (typeof value.following !== 'boolean') return { ok: false, error: 'following_invalid' };
        return { ok: true, kind: 'follow', handle: value.handle, following: value.following, idempotencyKey: value.idempotency_key };
    }
    return { ok: false, error: 'invalid_request' };
}

/** The public projection of music_social_summary: counts and the viewer's own state only. */
export function publicMusicSocial(summary, { viewer = false } = {}) {
    const reactions = {};
    for (const key of MUSIC_REACTIONS) reactions[key] = Number(summary?.reactions?.[key]) || 0;
    return {
        reactions,
        follower_count: Number(summary?.follower_count) || 0,
        ...(viewer ? { my_reaction: MUSIC_REACTIONS.includes(summary?.my_reaction) ? summary.my_reaction : null, following: summary?.following === true, is_own: summary?.is_own === true } : {}),
    };
}
