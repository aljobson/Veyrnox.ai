/**
 * Pre-debit checks for a video-agent job (ADR-0074, docs/montage/RUNBOOK-production.md gates G5/G6).
 * Both run before `ledger_debit`, so a refusal here never moves a credit.
 *
 *   checkPlan      the Approve ticket: issued for this caller, this exact brief, aspect and price, unexpired, and
 *                  carried under the idempotency key it names (one plan buys one run).
 *   checkCapacity  is the runner free? A busy or unreachable runner used to mean "debit, fail, refund"; now it is
 *                  "try again shortly, nothing was charged". A request that replays a job this caller already has
 *                  is let through, so `ledger_debit` can answer it as the idempotent replay it is.
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
 * @param {{userId:string, idempotencyKey:string, cfg:object, env?:object, deps?:{select?:Function, callRunner?:Function}}} args
 * @returns {Promise<null|{status:number, body:object, retryAfter?:number}>}
 */
export async function checkCapacity({ userId, idempotencyKey, cfg, env = process.env, deps = {} }) {
    const select = deps.select || dbSelect;
    const callRunner = deps.callRunner || realCallRunner;
    // A replay of a job this caller already started is not new work: do not turn it into "busy".
    try {
        const existing = await select('jobs', {
            columns: 'id', filter: `user_id=eq.${encodeURIComponent(userId)}&idempotency_key=eq.${encodeURIComponent(idempotencyKey)}&limit=1`,
        }, cfg);
        if (Array.isArray(existing) && existing[0]) return null;
    } catch (err) {
        console.error('[video-agent] replay lookup failed:', err && err.message);
        return refuse(502, 'video_agent_offline');
    }
    const rt = runtimeConfig(env);
    if (!rt) return refuse(503, 'video_agent_offline');
    const status = await callRunner('/status', {}, { base: rt.runnerBase, secret: rt.runnerSecret });
    if (!status.ok || !status.data || typeof status.data.busy !== 'boolean') return refuse(503, 'video_agent_offline');
    if (status.data.busy) return { ...refuse(409, 'video_agent_busy', { retry_after_seconds: BUSY_RETRY_SECONDS }), retryAfter: BUSY_RETRY_SECONDS };
    return null;
}
