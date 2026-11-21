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
export const FIRST_ONBOARDING_VERSION = 1;
export const FIRST_ONBOARDING_STEPS = Object.freeze(['goal', 'destination', 'role', 'recap']);

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

/**
 * Versioned first-run transition. `current_step` names the screen being answered; the database derives the next one.
 * A recap completion carries no answer. This is separate from cleanFirstAnswers so every legacy body remains unchanged.
 */
export function cleanFirstOnboarding(body) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) return { ok: false, field: 'version' };
    const allowed = new Set(['version', 'current_step', 'completed', 'goal', 'role', 'destination']);
    if (Object.keys(body).some((key) => !allowed.has(key))) return { ok: false, field: 'version' };
    if (body.version !== FIRST_ONBOARDING_VERSION) return { ok: false, field: 'version', version: true };
    if (typeof body.completed !== 'boolean') return { ok: false, field: 'completed' };
    if (!FIRST_ONBOARDING_STEPS.includes(body.current_step)) return { ok: false, field: 'current_step' };
    const answers = Object.fromEntries(['goal', 'role', 'destination'].filter((key) => Object.hasOwn(body, key)).map((key) => [key, body[key]]));
    if (body.completed) {
        if (body.current_step !== 'recap' || Object.keys(answers).length) return { ok: false, field: 'completed' };
        return { ok: true, transition: { version: 1, currentStep: 'recap', completed: true, answers: {} } };
    }
    if (body.current_step === 'recap') return { ok: false, field: 'completed' };
    if (Object.keys(answers).length !== 1 || !Object.hasOwn(answers, body.current_step)) return { ok: false, field: body.current_step };
    const value = answers[body.current_step];
    if (typeof value !== 'string' || !ANSWER_LISTS[body.current_step].includes(value)) return { ok: false, field: body.current_step };
    return { ok: true, transition: { version: 1, currentStep: body.current_step, completed: false, answers } };
}
