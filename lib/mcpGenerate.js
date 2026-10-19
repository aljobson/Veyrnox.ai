// The one spending tool of the Veyrnox MCP connector (ADR-0100 amendment 1): start a single text-to-image generation, and nothing else.
// This module only decides WHETHER a request may go ahead; the money itself still moves through the existing generation route (debit,
// idempotency, rate limit, moderation, refund), which is called last and whose refusals are passed through unchanged.
//
// There is no per-call or daily credit cap (ADR-0100 amendments 3 and 5): the account's balance, the generation route's rate limit and the exact
// price confirmation (the assistant must show the cost before anything is charged) bound what a client can spend.
import { estimatedCredits } from './generationEstimate.js';

export const IDEMPOTENCY_KEY_RE = /^[A-Za-z0-9._-]{8,128}$/;
export const MCP_IMAGE_MODALITY = 'text-to-image';

const APPROVAL_REQUIRED = {
    error: 'approval_required',
    instruction: 'Show the user what will be made and its exact credit cost, ask them to accept, and only after their clear yes call this tool again with user_approved: true.',
};
const refuse = (status, body) => ({ ok: false, status, body });

/**
 * @param args { model_id, prompt, negative_prompt?, aspect_ratio?, seed?, confirmed_credits, idempotency_key }, already schema-checked
 * @param deps { findModel(id), createGeneration(body) }
 * @returns { ok: true, data } or { ok: false, status, body }. Never spends unless every check above the final call passed.
 */
export async function startMcpGeneration(args, deps) {
    let model;
    try { model = await deps.findModel(args.model_id); } catch { return refuse(503, { error: 'catalog_unavailable' }); }
    if (!model) return refuse(404, { error: 'model_not_found' });
    if (model.modality !== MCP_IMAGE_MODALITY) {
        return refuse(400, { error: 'mcp_image_only', instruction: 'The connector can start text-to-image generations only. Start anything else in the Veyrnox app.' });
    }
    const credits = estimatedCredits(model);
    if (credits === null) return refuse(400, { error: 'duration_not_supported', supported_durations: model.durations || [] });
    if (args.confirmed_credits !== credits) {
        return refuse(409, { error: 'credit_confirmation_mismatch', confirmed_credits: args.confirmed_credits, expected_credits: credits, instruction: 'Show the updated estimate to the user before trying again.' });
    }

    if (args.user_approved !== true) return refuse(400, APPROVAL_REQUIRED);

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
