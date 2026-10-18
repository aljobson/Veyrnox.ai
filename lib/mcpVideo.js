// The two video spending tools of the Veyrnox MCP connector (ADR-0100 amendment 4): create a video, and edit videos the account already owns.
// Like lib/mcpGenerate.js this module only decides WHETHER a request may go ahead. The money still moves through the existing generation
// route (debit, idempotency, rate limit, moderation, source ownership, refund), which is called last and whose refusals pass through unchanged.
//
// The per-call limit is fixed in code and is not a setting a client can raise. There is no daily cap (ADR-0100 amendment 3).
import { estimatedCredits } from './generationEstimate.js';
import { CLIP_EDIT_MODEL } from './clipEdit.js';

export const MCP_VIDEO_LIMITS = Object.freeze({
    maxCreditsPerCall: 60,
    maxSources: 2,
});
export const MCP_SOURCE_SLOTS = Object.freeze(['image', 'endImage', 'video', 'audio']);

const refuse = (status, body) => ({ ok: false, status, body });
const defined = (entries) => Object.fromEntries(Object.entries(entries).filter(([, value]) => value !== undefined));
const isVideo = (model) => typeof model?.modality === 'string' && model.modality.endsWith('video') && model.id !== CLIP_EDIT_MODEL;

/**
 * Start ONE video generation (text-to-video, image-to-video, video-to-video ...).
 * @param args { model_id, prompt, negative_prompt?, aspect_ratio?, duration_seconds?, seed?, source_assets?: [{asset_id, slot}], consent?, confirmed_credits, idempotency_key }
 * @param deps { findModel(id), createGeneration(body) }
 */
export async function startMcpVideo(args, deps) {
    const limits = MCP_VIDEO_LIMITS;
    const sources = args.source_assets || [];
    if (sources.length > limits.maxSources) return refuse(400, { error: 'source_asset_invalid', max_sources: limits.maxSources });
    // A source is the account's own earlier result. Using one needs the person's AUP attestation, relayed by the assistant (ADR-0100).
    if (sources.length > 0 && args.consent !== true) {
        return refuse(400, { error: 'consent_required', instruction: 'Ask the user to confirm they have the rights to the source media and agree to the acceptable use policy, then pass consent: true.' });
    }
    let model;
    try { model = await deps.findModel(args.model_id); } catch { return refuse(503, { error: 'catalog_unavailable' }); }
    if (!model) return refuse(404, { error: 'model_not_found' });
    if (!isVideo(model)) {
        return refuse(400, { error: 'mcp_video_only', instruction: 'generate_video starts video models only. Use generate_image for images, or edit_video to cut, merge or score finished videos.' });
    }
    const credits = estimatedCredits(model, args.duration_seconds);
    if (credits === null) return refuse(400, { error: 'duration_not_supported', supported_durations: model.durations || [] });
    if (credits > limits.maxCreditsPerCall) {
        return refuse(400, { error: 'mcp_price_cap', max_credits_per_call: limits.maxCreditsPerCall, expected_credits: credits, instruction: 'Choose a cheaper model or a shorter clip, or use the Veyrnox app.' });
    }
    if (args.confirmed_credits !== credits) {
        return refuse(409, { error: 'credit_confirmation_mismatch', confirmed_credits: args.confirmed_credits, expected_credits: credits, instruction: 'Show the updated estimate to the user before trying again.' });
    }

    const { response, data } = await deps.createGeneration({
        model_id: args.model_id,
        idempotency_key: args.idempotency_key,
        inputs: defined({
            prompt: args.prompt, negative_prompt: args.negative_prompt, aspect_ratio: args.aspect_ratio,
            duration_seconds: args.duration_seconds, seed: args.seed,
        }),
        source_assets: sources.map(({ asset_id, slot }) => ({ asset_id, slot })),
        consent: sources.length > 0,
        confirmed_credits: credits,
    });
    return response.ok ? { ok: true, data } : refuse(response.status, data);
}

/**
 * Start ONE Clip Editor job: trim and join finished videos the account owns, optionally lay a soundtrack and captions on them.
 * The price depends on the real clip lengths, which only the generation route reads, so the caller learns it from the route's own
 * 409 credit_confirmation_mismatch (expected_credits) before anything is charged: a first call with confirmed_credits 0 is a quote.
 * @param args { clips, audio?, captions?, confirmed_credits, idempotency_key }
 * @param deps { createGeneration(body) }
 */
export async function startMcpEdit(args, deps) {
    if (args.confirmed_credits > MCP_VIDEO_LIMITS.maxCreditsPerCall) {
        return refuse(400, { error: 'mcp_price_cap', max_credits_per_call: MCP_VIDEO_LIMITS.maxCreditsPerCall, instruction: 'The per-call limit applies to edits too. Make a shorter edit, or use the Veyrnox app.' });
    }
    const { response, data } = await deps.createGeneration({
        model_id: CLIP_EDIT_MODEL,
        idempotency_key: args.idempotency_key,
        inputs: defined({ clips: args.clips, audio: args.audio, captions: args.captions }),
        source_assets: [],
        consent: false,
        confirmed_credits: args.confirmed_credits,
    });
    if (response.ok) return { ok: true, data };
    // A quote is a mismatch on a price above the cap: say so instead of inviting a confirmation the next call would be refused for.
    if (response.status === 409 && data?.error === 'credit_confirmation_mismatch' && data.expected_credits > MCP_VIDEO_LIMITS.maxCreditsPerCall) {
        return refuse(400, { error: 'mcp_price_cap', max_credits_per_call: MCP_VIDEO_LIMITS.maxCreditsPerCall, expected_credits: data.expected_credits, instruction: 'This edit costs more than the per-call limit. Make it shorter, or use the Veyrnox app.' });
    }
    return refuse(response.status, data);
}
