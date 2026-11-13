/**
 * The first-goal answer (ADR-0336, migration 0494). The allowlist below is the same one the database enforces in
 * public.first_goals: the route checks first so a caller gets a typed code naming the field, and the database stays
 * the line that holds if anything else ever calls the function.
 *
 * Off until FIRST_GOAL_SYNC_ENABLED is "true" (unset is off, like every flag that reads `=== 'true'`).
 */

// Same words as app/veyrnox/_lib/firstGoal.js (the card) plus "skipped"; tests/firstGoalRoute.test.mjs checks the two agree.
export const FIRST_GOAL_VALUES = Object.freeze(['image', 'video', 'audio', 'edit', 'publish', 'unsure', 'skipped']);

export function firstGoalSyncEnabled(env = process.env) {
    return env.FIRST_GOAL_SYNC_ENABLED === 'true';
}

/**
 * Returns { ok: true, goal } for exactly `{ goal: <listed word> }`, or { ok: false, field: 'goal' }. `field` is
 * always our own word, never the caller's text.
 */
export function cleanFirstGoal(body) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) return { ok: false, field: 'goal' };
    if (Object.keys(body).some((key) => key !== 'goal')) return { ok: false, field: 'goal' };
    if (typeof body.goal !== 'string' || !FIRST_GOAL_VALUES.includes(body.goal)) return { ok: false, field: 'goal' };
    return { ok: true, goal: body.goal };
}

// ADR-0339: the first-run questions that sit beside the goal. Same words as app/veyrnox/_lib/firstProfile.js and the
// CHECK lists in migration 0499; tests/firstProfile.test.mjs checks the three agree.
export const FIRST_ROLE_VALUES = Object.freeze(['creator', 'business', 'pro', 'hobbyist', 'beginner', 'skipped']);
export const FIRST_DESTINATION_VALUES = Object.freeze(['tiktok', 'reels', 'youtube', 'private', 'skipped']);

const ANSWER_LISTS = { goal: FIRST_GOAL_VALUES, role: FIRST_ROLE_VALUES, destination: FIRST_DESTINATION_VALUES };

/**
 * Any non-empty subset of { goal, role, destination }, each a listed word. Returns { ok: true, answers } or
 * { ok: false, field } where `field` is always our own key name ('goal' for an empty body or an unknown key).
 */
export function cleanFirstAnswers(body) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) return { ok: false, field: 'goal' };
    const keys = Object.keys(body);
    if (keys.length === 0 || keys.some((key) => !Object.hasOwn(ANSWER_LISTS, key))) return { ok: false, field: 'goal' };
    const answers = {};
    for (const key of keys) {
        if (typeof body[key] !== 'string' || !ANSWER_LISTS[key].includes(body[key])) return { ok: false, field: key };
        answers[key] = body[key];
    }
    return { ok: true, answers };
}
