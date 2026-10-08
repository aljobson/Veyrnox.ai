/**
 * Pre-debit checks for a video-agent job (ADR-0074, docs/montage/RUNBOOK-production.md gates G5/G6).
 * Both run before `ledger_debit`, so a refusal here never moves a credit.
 *
 *   checkPlan      the Approve ticket: issued for this caller, this exact brief, aspect and price, unexpired, and
 *                  carried under the idempotency key it names (one plan buys one run).
 *   checkCapacity  two limits, both answered before the debit so neither moves a credit:
 *                    per account   one video in the making at a time ("you already have one being made");
 *                    platform      the runner has a fixed number of slots; when all are taken, or it cannot be
 *                                  reached, the answer is "try again shortly", not "debit, fail, refund".
 *                  A request that replays a job this caller already has is let through first, so `ledger_debit`
 *                  can answer it as the idempotent replay it is.
 */

import { select as dbSelect } from '../packages/db/supabase-client.js';
import { verifyPlanToken, planIdempotencyKey } from './montagePlan.js';
import { callRunner as realCallRunner, runtimeConfig } from './montageRuntime.js';

export const BUSY_RETRY_SECONDS = 120;
const refuse = (status, error, extra = {}) => ({ status, body: { error, ...extra } });

/** @returns {Promise<null|{status:number, body:object}>} */
export async function checkPlan({ modelInputs, authId, idempotencyKey, credits, env = process.env }) {
    const planned = await verifyPlanToken({
        secret: env.MONTAGE_PLAN_SECRET, token: modelInputs.plan_id, authId,
        brief: modelInputs.brief, aspect: modelInputs.aspect_ratio || '9:16', credits,
    });
    if (!planned.ok) return refuse(planned.error === 'plan_expired' || planned.error === 'plan_price_changed' ? 409 : 400, planned.error);
    if (idempotencyKey !== planIdempotencyKey(planned.nonce)) return refuse(400, 'plan_key_mismatch');
    return null;
}

/**
 * @param {{userId:string, idempotencyKey:string, modelId:string, cfg:object, env?:object, deps?:{select?:Function, callRunner?:Function}}} args
 * @returns {Promise<null|{status:number, body:object, retryAfter?:number}>}
 */
export async function checkCapacity({ userId, idempotencyKey, modelId, cfg, env = process.env, deps = {} }) {
    const select = deps.select || dbSelect;
    const callRunner = deps.callRunner || realCallRunner;
    // A replay of a job this caller already started is not new work: do not turn it into "busy".
    try {
        const existing = await select('jobs', {
            columns: 'id', filter: `user_id=eq.${encodeURIComponent(userId)}&idempotency_key=eq.${encodeURIComponent(idempotencyKey)}&limit=1`,
        }, cfg);
        if (Array.isArray(existing) && existing[0]) return null;
        // Per account: one in the making at a time. DEBITED and SUBMITTED are the states a run holds while it works.
        const running = await select('jobs', {
            columns: 'id',
            filter: `user_id=eq.${encodeURIComponent(userId)}&model_id=eq.${encodeURIComponent(modelId)}&state=in.(DEBITED,SUBMITTED)&limit=1`,
        }, cfg);
        if (Array.isArray(running) && running[0]) return refuse(409, 'video_agent_in_progress');
    } catch (err) {
        console.error('[video-agent] job lookup failed:', err && err.message);
        return refuse(502, 'video_agent_offline');
    }
    const rt = runtimeConfig(env);
    if (!rt) return refuse(503, 'video_agent_offline');
    const status = await callRunner('/status', {}, { base: rt.runnerBase, secret: rt.runnerSecret });
    if (!status.ok || !status.data || typeof status.data.busy !== 'boolean') return refuse(503, 'video_agent_offline');
    if (status.data.busy) return { ...refuse(409, 'video_agent_busy', { retry_after_seconds: BUSY_RETRY_SECONDS }), retryAfter: BUSY_RETRY_SECONDS };
    return null;
}
