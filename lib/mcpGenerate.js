// The one spending tool of the Veyrnox MCP connector (ADR-0100 amendment 1): start a single text-to-image generation, and nothing else.
// This module only decides WHETHER a request may go ahead; the money itself still moves through the existing generation route (debit,
// idempotency, rate limit, moderation, refund), which is called last and whose refusals are passed through unchanged.
//
// The limits are deliberately small and fixed. They are not settings a client can raise.
import { estimatedCredits } from './generationEstimate.js';

export const MCP_GENERATION_LIMITS = Object.freeze({
    maxCreditsPerCall: 2,
    dailyCreditCap: 40,
    windowMs: 24 * 60 * 60 * 1000,
    jobsPageSize: 50,
});
export const IDEMPOTENCY_KEY_RE = /^[A-Za-z0-9._-]{8,128}$/;
export const MCP_IMAGE_MODALITY = 'text-to-image';

const refuse = (status, body) => ({ ok: false, status, body });

/**
 * Credits the account has been charged in the last 24 hours, from its newest-first job list. A refunded job costs nothing. A job with an
 * unreadable date is counted (fail closed). `complete` is false when the page is full and still inside the window: older jobs may exist, so
 * the total cannot be proven.
 */
export function creditsSpentInWindow(jobs, now = Date.now(), limits = MCP_GENERATION_LIMITS) {
    let spent = 0;
    let oldestInside = false;
    for (const job of jobs) {
        const at = Date.parse(job.created_at);
        const inside = Number.isNaN(at) || now - at <= limits.windowMs;
        oldestInside = inside;
        if (!inside || job.refunded) continue;
        const credits = Number(job.credits);
        if (Number.isFinite(credits) && credits > 0) spent += credits;
    }
    return { spent, complete: jobs.length < limits.jobsPageSize || !oldestInside };
}

/**
 * @param args { model_id, prompt, negative_prompt?, aspect_ratio?, seed?, confirmed_credits, idempotency_key }, already schema-checked
 * @param deps { findModel(id), readRecentJobs(), createGeneration(body), now() }
 * @returns { ok: true, data } or { ok: false, status, body }. Never spends unless every check above the final call passed.
 */
export async function startMcpGeneration(args, deps) {
    const limits = MCP_GENERATION_LIMITS;
    let model;
    try { model = await deps.findModel(args.model_id); } catch { return refuse(503, { error: 'catalog_unavailable' }); }
    if (!model) return refuse(404, { error: 'model_not_found' });
    if (model.modality !== MCP_IMAGE_MODALITY) {
        return refuse(400, { error: 'mcp_image_only', instruction: 'The connector can start text-to-image generations only. Start anything else in the Veyrnox app.' });
    }
    const credits = estimatedCredits(model);
    if (credits === null) return refuse(400, { error: 'duration_not_supported', supported_durations: model.durations || [] });
    if (credits > limits.maxCreditsPerCall) {
        return refuse(400, { error: 'mcp_price_cap', max_credits_per_call: limits.maxCreditsPerCall, expected_credits: credits, instruction: 'Choose a model that costs no more than the per-call limit, or use the Veyrnox app.' });
    }
    if (args.confirmed_credits !== credits) {
        return refuse(409, { error: 'credit_confirmation_mismatch', confirmed_credits: args.confirmed_credits, expected_credits: credits, instruction: 'Show the updated estimate to the user before trying again.' });
    }

    const recent = await deps.readRecentJobs();
    if (!recent.response.ok || !Array.isArray(recent.data?.jobs)) return refuse(503, { error: 'spend_check_unavailable' });
    const { spent, complete } = creditsSpentInWindow(recent.data.jobs, deps.now(), limits);
    if (!complete) return refuse(429, { error: 'mcp_daily_cap_unverifiable', daily_cap: limits.dailyCreditCap, instruction: 'Too much recent activity to verify the daily limit. Use the Veyrnox app.' });
    if (spent + credits > limits.dailyCreditCap) {
        return refuse(429, { error: 'mcp_daily_cap_reached', spent_last_24h: spent, daily_cap: limits.dailyCreditCap, expected_credits: credits, instruction: 'The connector has reached its daily credit limit for this account. Use the Veyrnox app or try again later.' });
    }

    const inputs = Object.fromEntries(Object.entries({
        prompt: args.prompt, negative_prompt: args.negative_prompt, aspect_ratio: args.aspect_ratio, seed: args.seed,
    }).filter(([, value]) => value !== undefined));
    const { response, data } = await deps.createGeneration({
        model_id: args.model_id,
        idempotency_key: args.idempotency_key,
        inputs,
        source_assets: [],
        consent: false,
        confirmed_credits: credits,
    });
    return response.ok ? { ok: true, data } : refuse(response.status, data);
}
