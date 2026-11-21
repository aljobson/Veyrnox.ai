/**
 * The first-goal answer (ADR-0336): "What do you want to make first?". Bearer-only like the rest of /api/v1:
 * identity is the x-veyrnox-auth-id the middleware set. Off (404) until FIRST_GOAL_SYNC_ENABLED is "true". Never
 * touches credits or the ledger.
 *
 * GET /api/v1/first-goal — 200 { goal, role, destination, version, current_step, completed }. goal is "image" | "video" | "audio" |
 *        "edit" | "publish" | "unsure" | "skipped"; role (ADR-0339) "creator" | "business" | "pro" | "hobbyist" | "beginner" |
 *        "skipped"; destination "tiktok" | "reels" | "youtube" | "private" | "skipped".
 * PUT /api/v1/first-goal — body: any non-empty subset of { goal, role, destination }. The database never lowers an answer
 *        (a real word outranks "skipped"; a real goal also outranks "unsure"), so the reply is what the account now holds:
 *        200 { goal, role, destination, changed: boolean }. Idempotent: the same body again changes nothing.
 * Version-1 PUT adds { version: 1, current_step, completed }; one answer must match a question step, while recap completion
 * carries no answer. Legacy bodies and replies remain unchanged for installed clients.
 *
 * Errors: 400 body_invalid | invalid_goal (+ field) | invalid_onboarding (+ field), 401 not_authenticated,
 *   404 not_found (flag off) | account_not_found, 409 onboarding_version_unsupported | onboarding_incomplete
 *   (with authoritative progress), 502 first_goal_unavailable, 503 gateway_not_configured.
 */

import { NextResponse } from 'next/server';
import { rpc, envConfig } from '../../../../packages/db/supabase-client.js';
import { cleanFirstAnswers, cleanFirstOnboarding, firstGoalSyncEnabled } from '../../../../lib/firstGoal.js';
import { isUuidLoose } from '../../../../lib/validate.js';

const NO_STORE = { 'Cache-Control': 'no-store' };
const fail = (error, status, extra = {}) => NextResponse.json({ error, ...extra }, { status, headers: NO_STORE });

function gate(req) {
    const authId = req.headers.get('x-veyrnox-auth-id');
    if (!authId || !isUuidLoose(authId)) return { response: fail('not_authenticated', 401) };
    if (!firstGoalSyncEnabled()) return { response: fail('not_found', 404) };
    const cfg = envConfig();
    if (!cfg.supabaseUrl || !cfg.serviceRoleKey) return { response: fail('gateway_not_configured', 503) };
    return { authId, cfg };
}

async function call(name, args, cfg) {
    try {
        return await rpc(name, args, cfg);
    } catch (err) {
        console.error(`[api/v1/first-goal] ${name} failed:`, err && err.message);
        return null;
    }
}

function refused(result) {
    if (result?.error === 'account_not_found') return fail('account_not_found', 404);
    console.error('[api/v1/first-goal] refused:', result?.error);
    return fail('first_goal_unavailable', 502);
}

function publicState(result, extra = {}) {
    const word = (value) => (typeof value === 'string' ? value : null);
    const state = { goal: word(result.goal), role: word(result.role), destination: word(result.destination), ...extra };
    if (result.version === 0 || result.version === 1) {
        state.version = result.version;
        state.current_step = typeof result.current_step === 'string' ? result.current_step : null;
        state.completed = result.completed === true;
    }
    return state;
}

export async function GET(req) {
    const g = gate(req);
    if (g.response) return g.response;
    let result = await call('get_first_answers', { p_auth_id: g.authId }, g.cfg);
    // Migration 0499 may not be applied yet: the goal alone still answers.
    if (result === null) result = await call('get_first_goal', { p_auth_id: g.authId }, g.cfg);
    if (result?.ok !== true) return refused(result);
    return NextResponse.json(publicState(result), { headers: NO_STORE });
}

export async function PUT(req) {
    const g = gate(req);
    if (g.response) return g.response;
    let body;
    try { body = await req.json(); } catch { return fail('body_invalid', 400); }
    if (!body || typeof body !== 'object' || Array.isArray(body)) return fail('body_invalid', 400);

    const versioned = Object.hasOwn(body, 'version') || Object.hasOwn(body, 'current_step') || Object.hasOwn(body, 'completed');
    if (versioned) {
        const clean = cleanFirstOnboarding(body);
        if (!clean.ok) {
            if (clean.version) return fail('onboarding_version_unsupported', 409, { field: clean.field });
            return fail('invalid_onboarding', 400, { field: clean.field });
        }
        const { version, currentStep, completed, answers } = clean.transition;
        const result = await call('set_first_onboarding', {
            p_auth_id: g.authId, p_version: version, p_current_step: currentStep, p_completed: completed,
            p_goal: answers.goal ?? null, p_role: answers.role ?? null, p_destination: answers.destination ?? null,
        }, g.cfg);
        if (result?.ok !== true) {
            if (result?.error === 'onboarding_incomplete') return NextResponse.json({ error: result.error, ...publicState(result) }, { status: 409, headers: NO_STORE });
            if (result?.error === 'onboarding_version_unsupported') return fail(result.error, 409);
            if (result?.error === 'invalid_onboarding') return fail(result.error, 400);
            return refused(result);
        }
        return NextResponse.json(publicState(result, { changed: result.changed === true }), { headers: NO_STORE });
    }

    const clean = cleanFirstAnswers(body);
    if (!clean.ok) return fail('invalid_goal', 400, { field: clean.field });
    const { goal = null, role = null, destination = null } = clean.answers;

    // A body of the goal alone is the 0494 call, unchanged; anything else goes through the 0499 function.
    const goalOnly = role === null && destination === null;
    const result = goalOnly
        ? await call('set_first_goal', { p_auth_id: g.authId, p_goal: goal }, g.cfg)
        : await call('set_first_answers', { p_auth_id: g.authId, p_goal: goal, p_role: role, p_destination: destination }, g.cfg);
    if (result?.ok !== true) return result?.error === 'invalid_goal' || result?.error === 'invalid_answers' ? fail('invalid_goal', 400, { field: 'goal' }) : refused(result);
    return NextResponse.json(publicState(result, { changed: result.changed === true }), { headers: NO_STORE });
}
