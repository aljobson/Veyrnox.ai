/**
 * The Vibe Check profile (ADR-0251, migration 0363). The allowlist below is the
 * same one the database enforces in private.creator_profile_clean: the route
 * checks first so a caller gets a typed code naming the field, and the database
 * stays the line that holds if anything else ever calls the function.
 *
 * Off until CREATOR_PROFILE_ENABLED is "true" (unset is off, like every flag
 * that reads `=== 'true'`).
 */

export const CREATOR_ANSWERS = Object.freeze({
    look: ['neon_rain', 'sunlit_kitchen', 'retro_vhs', 'dream_anime', 'glossy_product', 'doc_grit'],
    goal: ['sell', 'story', 'music_video', 'meme', 'character', 'bedtime'],
    pace: ['fox', 'owl', 'octopus', 'jellyfish'],
    destination: ['tiktok', 'reels', 'youtube', 'cinema', 'roll'],
    audience: ['me', 'audience', 'customers', 'kids', 'nobody_yet'],
    voice: ['hype', 'calm', 'straight'],
});
export const CHAOS_MAX = 4;
export const STUDIO_NAME_MAX = 40;
// Same rule as the database: no control characters, no angle brackets.
const STUDIO_NAME_BAD = /[\u0000-\u001f\u007f-\u009f<>]/;

export function creatorProfileEnabled(env = process.env) {
    return env.CREATOR_PROFILE_ENABLED === 'true';
}

/**
 * Returns { ok: true, answers } with only allowlisted keys, or
 * { ok: false, field } naming the first problem. `field` is always one of our own
 * key names (or "unknown_key"); caller-supplied text is never echoed back.
 */
export function cleanCreatorAnswers(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) return { ok: false, field: 'answers' };
    const allowed = new Set([...Object.keys(CREATOR_ANSWERS), 'chaos', 'studio_name']);
    for (const key of Object.keys(input)) if (!allowed.has(key)) return { ok: false, field: 'unknown_key' };

    const out = {};
    for (const [key, values] of Object.entries(CREATOR_ANSWERS)) {
        const v = input[key];
        if (typeof v !== 'string' || !values.includes(v)) return { ok: false, field: key };
        out[key] = v;
    }
    if (!Number.isInteger(input.chaos) || input.chaos < 0 || input.chaos > CHAOS_MAX) return { ok: false, field: 'chaos' };
    out.chaos = input.chaos;

    if (input.studio_name !== undefined) {
        if (typeof input.studio_name !== 'string') return { ok: false, field: 'studio_name' };
        const name = input.studio_name.trim();
        if (name.length > STUDIO_NAME_MAX || STUDIO_NAME_BAD.test(name)) return { ok: false, field: 'studio_name' };
        if (name) out.studio_name = name;
    }
    return { ok: true, answers: out };
}
