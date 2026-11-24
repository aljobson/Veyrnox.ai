import { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { readPublicCatalog } from './publicCatalog.js';
import { internalModelId, withPublicJobModelIds, withPublicModelIds } from './publicModelIds.js';
import { GET as readJob } from '../app/api/v1/jobs/[id]/route.js';
import { GET as readJobAsset } from '../app/api/v1/jobs/[id]/asset/route.js';
import { GET as listJobs } from '../app/api/v1/jobs/route.js';
import { GET as readBalance } from '../app/api/v1/balance/route.js';
import { GET as readMusicDraft } from '../app/api/v1/music/drafts/custom/route.js';
import { POST as quoteMusicGeneration } from '../app/api/v1/music/generation-quotes/route.js';
import { POST as createMusicGeneration } from '../app/api/v1/music/generations/route.js';
import { GET as readMusicGeneration } from '../app/api/v1/music/generations/[id]/route.js';
import { GET as listMusicPlaylists, POST as createMusicPlaylist } from '../app/api/v1/music/playlists/route.js';
import { PATCH as updateMusicPlaylist } from '../app/api/v1/music/playlists/[id]/route.js';
import { estimatedCredits } from './generationEstimate.js';
import { POST as createGeneration } from '../app/api/v1/generations/route.js';
import { POST as reserveUpload } from '../app/api/v1/uploads/route.js';
import { IDEMPOTENCY_KEY_RE, startMcpGeneration } from './mcpGenerate.js';
import { MCP_VIDEO_LIMITS, MCP_SOURCE_SLOTS, startMcpVideo, startMcpEdit } from './mcpVideo.js';
import { MCP_UPLOAD_TYPES, MCP_UPLOAD_MAX_BYTES, MCP_UPLOAD_KEY_RE, reserveMcpUpload } from './mcpUpload.js';
import { publishAutomationEnabled } from './social/publishFeature.js';
import { registerPublishTools } from './veyrnoxPublishMcp.js';
import { closestModelIds, modelListText, generationListText } from './mcpListings.js';
import { GENERATION_PROMPT_MAX, NEGATIVE_PROMPT_MAX } from './generationPromptLimits.js';
import { GENERATION_ASPECT_RATIOS } from './generationAspectRatios.js';
import { MUSIC_CRUN_CONTRACT, MUSIC_FAL_CONTRACT } from './musicBackend.js';
import { MCP_MUSIC_PLAYLIST_MAX_SONGS, musicAssetError, musicGenerationPending } from './mcpMusic.js';

export { estimatedCredits } from './generationEstimate.js';

const PUBLIC_ORIGIN = process.env.PUBLIC_HOST || 'https://veyrnox.ai';
const UUID = z.string().uuid();
// get_generation can hold the call while a job runs (one read every WAIT_STEP_MS), so an agent need not loop.
export const MAX_WAIT_SECONDS = 25;
const WAIT_STEP_MS = 3000;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const MODEL_ID = z.string().regex(/^[a-z0-9][a-z0-9.-]{0,63}$/);
const IDEMPOTENCY_KEY = z.string().regex(IDEMPOTENCY_KEY_RE);
const MUSIC_IDEMPOTENCY_KEY = z.string().regex(/^[A-Za-z0-9._-]{8,120}$/);
const UPLOAD_KEY = z.string().max(200).regex(MCP_UPLOAD_KEY_RE).describe('The key returned by reserve_source_upload for a file this account uploaded.');
const MUSIC_PROVIDER_CONTRACT = z.enum([MUSIC_FAL_CONTRACT, MUSIC_CRUN_CONTRACT]);

const readOnly = {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
};

function textResult(value, sentence) {
    return {
        content: [{ type: 'text', text: sentence || JSON.stringify(value, null, 2) }],
        structuredContent: value,
    };
}

function errorResult(status, body) {
    const code = body?.error || `http_${status}`;
    const details = { ok: false, status, ...body };
    const hint = Array.isArray(body?.closest_model_ids) && body.closest_model_ids.length
        ? ` Closest valid model_id values: ${body.closest_model_ids.join(', ')}. Call list_models for the full list.`
        : '';
    return {
        isError: true,
        content: [{
            type: 'text',
            text: `Veyrnox could not complete the request (${code}). No success should be assumed.${hint}`,
        }],
        structuredContent: details,
    };
}

function trustedHeaders(source) {
    const headers = new Headers({ 'content-type': 'application/json' });
    // These values were blanked and then written by middleware.js after JWT
    // verification. Never copy arbitrary client headers into an internal API
    // call: the existing routes treat this one as the account boundary.
    for (const name of ['x-veyrnox-auth-id', 'x-veyrnox-auth-email', 'x-veyrnox-auth-role', 'x-veyrnox-auth-client-id',
        'x-veyrnox-auth-aal', 'x-veyrnox-auth-mfa-at', 'x-request-id', 'cf-ipcountry']) {
        const value = source.headers.get(name);
        if (value) headers.set(name, value);
    }
    return headers;
}

async function routeJson(handler, source, path, { method = 'GET', body, params } = {}) {
    const request = new Request(new URL(path, PUBLIC_ORIGIN), {
        method,
        headers: trustedHeaders(source),
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const response = await handler(request, params ? { params: Promise.resolve(params) } : undefined);
    const data = await response.json().catch(() => ({ error: `http_${response.status}` }));
    return { response, data };
}

// A model_not_found refusal names the valid ids closest to the one asked for, so the caller need not guess.
async function modelNotFound(requested) {
    let suggestions = [];
    try { suggestions = closestModelIds(requested, withPublicModelIds(await readPublicCatalog())); } catch { /* the refusal stands without them */ }
    return { error: 'model_not_found', requested_model_id: requested, closest_model_ids: suggestions };
}

async function withModelSuggestions(result, requested) {
    if (result.ok || result.body?.error !== 'model_not_found') return result;
    return { ...result, body: await modelNotFound(requested) };
}

async function findModel(modelId) {
    const models = await readPublicCatalog();
    return { models, model: models.find((entry) => entry.id === internalModelId(modelId)) };
}

/**
 * A fresh server is created for every HTTP request by createMcpHandler. Tool
 * closures therefore carry only the verified identity for that request.
 */
export function createVeyrnoxMcpServer(request) {
    const server = new McpServer({
        name: 'veyrnox-ai',
        title: 'Veyrnox.ai',
        version: '1.0.0',
        description: 'Inspect Veyrnox models, credit estimates, generation history and finished assets, upload the user\'s own source file, and safely create images, videos, music and playlists after any required price confirmation.',
        websiteUrl: 'https://veyrnox.ai/mcp',
    }, { maxToolInputElements: 80 });

    server.registerTool('list_models', {
        title: 'List Veyrnox models',
        description: 'List the generation models currently offered by Veyrnox. The text result carries every model as JSON: model_id (the exact value estimate_generation, generate_image and generate_video accept), name, modality, price_credits with its unit, aspect_ratios, durations, source_slots and source_limits (effective maxFiles and required per slot).',
        inputSchema: z.object({
            modality: z.string().min(1).max(64).optional().describe('Optional exact modality filter, such as text-to-image or text-to-video.'),
        }),
        annotations: readOnly,
    }, async ({ modality }) => {
        try {
            const models = withPublicModelIds(await readPublicCatalog());
            const filtered = modality ? models.filter((model) => model.modality === modality) : models;
            return textResult({ models: filtered, count: filtered.length }, modelListText(filtered, modality));
        } catch {
            return errorResult(503, { error: 'catalog_unavailable' });
        }
    });

    server.registerTool('estimate_generation', {
        title: 'Estimate generation cost',
        description: 'Return the maximum Veyrnox credit charge before generating. Get model_id from list_models. Video prices are calculated in five-second units. A free allowance may reduce the actual charge.',
        inputSchema: z.object({
            model_id: MODEL_ID,
            duration_seconds: z.number().int().positive().max(600).optional(),
        }),
        annotations: readOnly,
    }, async ({ model_id, duration_seconds }) => {
        try {
            const { model } = await findModel(model_id);
            if (!model) return errorResult(404, await modelNotFound(model_id));
            const credits = estimatedCredits(model, duration_seconds);
            if (credits === null) return errorResult(400, { error: 'duration_not_supported', supported_durations: model.durations || [] });
            const estimate = {
                model_id,
                model_name: model.name,
                modality: model.modality,
                duration_seconds: model.modality.endsWith('video') ? (duration_seconds || 5) : null,
                maximum_credits: credits,
                may_use_free_allowance: true,
            };
            return textResult(estimate, `This generation can charge at most ${credits} Veyrnox credits.`);
        } catch {
            return errorResult(503, { error: 'catalog_unavailable' });
        }
    });

    server.registerTool('reserve_source_upload', {
        title: 'Reserve a source upload',
        description: `Reserve a place for ONE file of the user's own (a still image, a video or an audio file) so it can be the source of generate_video or generate_image, instead of a finished Veyrnox generation. Nothing is charged. The result carries a presigned upload_url that is valid for 15 minutes: send the file bytes as the body of an HTTP PUT to it with exactly the headers returned, then pass the returned key in source_uploads of the generation call with consent: true. Accepted types: ${MCP_UPLOAD_TYPES.join(', ')}; the byte limit per type is in the result. The account must hold credits; an unused upload is removed after 24 hours.`,
        inputSchema: z.object({
            content_type: z.enum(MCP_UPLOAD_TYPES).describe('The media type of the file, exactly as it will be sent.'),
            size_bytes: z.number().int().positive().max(MCP_UPLOAD_MAX_BYTES).describe('The exact byte length of the file; the PUT must send this many bytes.'),
        }),
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    }, async (args) => {
        const result = await reserveMcpUpload(args, {
            reserveUpload: (body) => routeJson(reserveUpload, request, '/api/v1/uploads', { method: 'POST', body }),
        });
        if (!result.ok) return errorResult(result.status, result.body);
        return textResult(result.data, `Veyrnox reserved upload ${result.data.key}. ${result.data.instruction}`);
    });

    server.registerTool('generate_image', {
        title: 'Generate image',
        description: `Start ONE image generation on the signed-in Veyrnox account: text-to-image, or image-to-image (upscale, background removal, editing) from a file the user supplied. Get model_id from list_models. This tool spends credits. Call estimate_generation first, show the maximum cost to the user and ask them to accept it; only after their clear yes, call this tool with that exact value as confirmed_credits and user_approved: true. Never set user_approved yourself. A source file is the user's own image, uploaded through reserve_source_upload and named by its key in source_uploads with slot image, for a model whose source_slots include image; an image-to-image model needs one. Using any source requires consent: true, which you may set only after the user confirms they have the rights to the file and accept the acceptable use policy. Audio is not available here; use generate_video and edit_video for video.`,
        inputSchema: z.object({
            model_id: MODEL_ID,
            prompt: z.string().min(1).max(GENERATION_PROMPT_MAX),
            negative_prompt: z.string().max(NEGATIVE_PROMPT_MAX).optional(),
            aspect_ratio: z.enum(GENERATION_ASPECT_RATIOS).optional(),
            seed: z.number().int().min(0).max(2147483647).optional(),
            source_uploads: z.array(z.object({ key: UPLOAD_KEY, slot: z.literal('image') })).max(3).optional().describe('Files uploaded through reserve_source_upload, in order; repeat the slot only up to the model\'s maxFiles.'),
            consent: z.boolean().optional().describe('True only after the user confirmed rights to the source file and accepted the acceptable use policy.'),
            confirmed_credits: z.number().int().nonnegative().describe('Exact maximum_credits returned by estimate_generation.'),
            user_approved: z.boolean().optional().describe('Set true only after the user has seen the exact credit cost and clearly accepted it. Without it nothing is charged.'),
            idempotency_key: IDEMPOTENCY_KEY.describe('Stable key for safe retries. Reuse it for the same intended generation; a new key is a new charge.'),
        }),
        annotations: {
            readOnlyHint: false,
            destructiveHint: false,
            idempotentHint: true,
            openWorldHint: true,
        },
    }, async (args) => {
        const result = await withModelSuggestions(await startMcpGeneration(args, {
            async findModel(modelId) { return (await findModel(modelId)).model; },
            createGeneration: (body) => routeJson(createGeneration, request, '/api/v1/generations', { method: 'POST', body }),
        }), args.model_id);
        if (!result.ok) return errorResult(result.status, result.body);
        return textResult(result.data, `Veyrnox accepted generation ${result.data.job_id}. Use get_generation to check its status.`);
    });

    const spends = { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true };

    server.registerTool('generate_video', {
        title: 'Generate video',
        description: `Start ONE video generation on the signed-in Veyrnox account: text-to-video, image-to-video or video-to-video, whichever the chosen model is. Get model_id from list_models. This tool spends credits. Call estimate_generation first (pass duration_seconds), show the maximum cost to the user and ask them to accept it; only after their clear yes, call this tool with that exact value as confirmed_credits and user_approved: true. Never set user_approved yourself. Limits: video models only, at most ${MCP_VIDEO_LIMITS.maxSources} source files overall and at most capabilities.media[slot].maxFiles per slot (1 when multi-reference is disabled). A source file goes in a slot the model's capabilities allow: image (first frame), endImage, video or audio. It is either a finished generation the account already owns, named by its job_id in source_assets, or the user's own file uploaded through reserve_source_upload, named by its key in source_uploads (so a still the user has does not need a generation first). Uploads come before assets in the order sent to the model; repeated slots preserve order. Using any source requires consent: true, which you may set only after the user confirms they have the rights to the media and accept the acceptable use policy. Check progress with get_generation.`,
        inputSchema: z.object({
            model_id: MODEL_ID,
            prompt: z.string().min(1).max(GENERATION_PROMPT_MAX),
            negative_prompt: z.string().max(NEGATIVE_PROMPT_MAX).optional(),
            aspect_ratio: z.enum(GENERATION_ASPECT_RATIOS).optional(),
            duration_seconds: z.union([z.literal(5), z.literal(10)]).optional(),
            seed: z.number().int().min(0).max(2147483647).optional(),
            source_uploads: z.array(z.object({ key: UPLOAD_KEY, slot: z.enum(MCP_SOURCE_SLOTS) })).max(MCP_VIDEO_LIMITS.maxSources).optional().describe('Ordered files uploaded through reserve_source_upload; the slot must match the file\'s media kind. Repeat a slot only up to its catalog maxFiles limit.'),
            source_assets: z.array(z.object({ asset_id: UUID.describe('The job_id of a finished generation the account owns.'), slot: z.enum(MCP_SOURCE_SLOTS) })).max(MCP_VIDEO_LIMITS.maxSources).optional().describe('Ordered Library references; repeat a slot only up to its catalog maxFiles limit.'),
            consent: z.boolean().optional().describe('True only after the user confirmed rights to the source media and accepted the acceptable use policy.'),
            confirmed_credits: z.number().int().nonnegative().describe('Exact maximum_credits returned by estimate_generation.'),
            user_approved: z.boolean().optional().describe('Set true only after the user has seen the exact credit cost and clearly accepted it. Without it nothing is charged.'),
            idempotency_key: IDEMPOTENCY_KEY.describe('Stable key for safe retries. Reuse it for the same intended video; a new key is a new charge.'),
        }),
        annotations: spends,
    }, async (args) => {
        const result = await withModelSuggestions(await startMcpVideo(args, {
            async findModel(modelId) { return (await findModel(modelId)).model; },
            createGeneration: (body) => routeJson(createGeneration, request, '/api/v1/generations', { method: 'POST', body }),
        }), args.model_id);
        if (!result.ok) return errorResult(result.status, result.body);
        return textResult(result.data, `Veyrnox accepted video generation ${result.data.job_id}. Use get_generation to check its status.`);
    });

    server.registerTool('edit_video', {
        title: 'Edit videos',
        description: `Start ONE edit job on finished videos the signed-in account already owns: trim each clip, join them in order (up to 10 clips, 60 seconds out), optionally lay one owned audio file under them and burn in captions. Clips are named by the job_id of the generation that made them. This tool spends credits, and the price depends on the real clip lengths, so quote first: call it with confirmed_credits 0 and a fresh idempotency_key; the refusal credit_confirmation_mismatch carries expected_credits and nothing is charged. Show that to the user and ask them to accept it; only after their clear yes, call again with the exact value and user_approved: true (the quote's key can be reused). Never set user_approved yourself. Check progress with get_generation.`,
        inputSchema: z.object({
            clips: z.array(z.object({
                asset_id: UUID.describe('The job_id of a finished video generation the account owns.'),
                in_s: z.number().min(0).max(3600),
                out_s: z.number().min(0).max(3600),
                slow: z.union([z.literal(2), z.literal(3), z.literal(4)]).optional().describe('Slow motion factor, when the account has it enabled.'),
            })).min(1).max(10),
            audio: z.object({ asset_id: UUID.describe('The job_id of a finished audio generation the account owns.'), offset_s: z.number().min(0).max(3600) }).optional(),
            captions: z.object({ preset: z.string().min(1).max(32) }).optional(),
            confirmed_credits: z.number().int().nonnegative().describe('Exact expected_credits from the quote, or 0 to get one.'),
            user_approved: z.boolean().optional().describe('Set true only after the user has seen the exact credit cost and clearly accepted it. Without it nothing is charged.'),
            idempotency_key: IDEMPOTENCY_KEY.describe('Stable key for safe retries. Reuse it for the same intended edit; a new key is a new charge.'),
        }),
        annotations: spends,
    }, async (args) => {
        const result = await startMcpEdit(args, {
            createGeneration: (body) => routeJson(createGeneration, request, '/api/v1/generations', { method: 'POST', body }),
        });
        if (!result.ok) return errorResult(result.status, result.body);
        return textResult(result.data, `Veyrnox accepted edit ${result.data.job_id}. Use get_generation to check its status.`);
    });

    server.registerTool('get_music_draft', {
        title: 'Get Music draft',
        description: 'Read the signed-in account\'s authoritative Custom Music draft and provider contract. Draft text is edited in the Veyrnox web or iOS app; this connector never writes it. If no draft id exists, create or save the draft in Veyrnox before requesting a quote.',
        inputSchema: z.object({}),
        annotations: readOnly,
    }, async () => {
        const { response, data } = await routeJson(readMusicDraft, request, '/api/v1/music/drafts/custom');
        if (!response.ok) return errorResult(response.status, data);
        const instruction = data?.draft?.id
            ? 'Use this provider_contract, draft id and revision when calling estimate_music_generation.'
            : 'No saved draft id exists. Create or save a Custom Music draft in the Veyrnox web or iOS app, then call get_music_draft again.';
        return textResult({ ...data, instruction }, instruction);
    });

    server.registerTool('estimate_music_generation', {
        title: 'Estimate Music generation',
        description: 'Create an exact, short-lived quote for two candidates from the authoritative Custom Music draft. This writes only a quote and charges nothing. Show total_credits to the user and ask them to accept before calling generate_music. For a vocal draft, ask the user to explicitly confirm that they own or have permission to use the draft lyrics before setting rights_confirmed true; never infer or supply that confirmation yourself. Instrumental drafts use false. The connector deliberately does not request the web/iOS daily allowance.',
        inputSchema: z.object({
            provider_contract: MUSIC_PROVIDER_CONTRACT,
            draft_id: UUID,
            draft_revision: z.number().int().nonnegative(),
            instrumental: z.boolean(),
            rights_confirmed: z.boolean().describe('True only after the user explicitly confirms they own or have permission to use the draft lyrics. Use false for an instrumental draft. Never infer this confirmation.'),
            duration_seconds: z.number().int().min(1).max(135),
        }),
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    }, async (args) => {
        const { response, data } = await routeJson(quoteMusicGeneration, request, '/api/v1/music/generation-quotes', {
            method: 'POST', body: { mode: 'custom', ...args },
        });
        if (!response.ok) return errorResult(response.status, data);
        const result = { ...data, rights_confirmed: args.rights_confirmed };
        const rights = args.instrumental
            ? 'This is instrumental, so no lyric-rights confirmation was asserted.'
            : 'The quote records the user\'s explicit lyric-rights confirmation.';
        return textResult(result, `Two Music candidates will charge exactly ${data.total_credits} Veyrnox credits. ${rights} Show this cost to the user and ask for approval before generating.`);
    });

    server.registerTool('generate_music', {
        title: 'Generate Music',
        description: 'Start one approved two-candidate Music request from a current quote. This spends the exact confirmed credit amount. Call estimate_music_generation first, show total_credits to the user, and call this only after their clear approval. Reuse the same idempotency_key for retries of the same intended request.',
        inputSchema: z.object({
            provider_contract: MUSIC_PROVIDER_CONTRACT,
            quote_id: UUID,
            confirmed_credits: z.number().int().nonnegative(),
            user_approved: z.literal(true).describe('True only after the user has seen and accepted the exact quote.'),
            idempotency_key: MUSIC_IDEMPOTENCY_KEY,
        }),
        annotations: spends,
    }, async (args) => {
        const { response, data } = await routeJson(createMusicGeneration, request, '/api/v1/music/generations', {
            method: 'POST', body: args,
        });
        if (!response.ok) return errorResult(response.status, data);
        return textResult(data, `Veyrnox accepted Music generation ${data.generation_id}. Use get_music_generation to check its two candidates.`);
    });

    server.registerTool('get_music_generation', {
        title: 'Get Music generation',
        description: `Read an owned two-candidate Music request. Pass wait_seconds (up to ${MAX_WAIT_SECONDS}) to wait for a terminal request state. Ready candidates include short-lived signed audio links; failed and refunded candidates keep their terminal state.`,
        inputSchema: z.object({ generation_id: UUID, wait_seconds: z.number().int().min(0).max(MAX_WAIT_SECONDS).default(0) }),
        annotations: { ...readOnly, openWorldHint: true },
    }, async ({ generation_id, wait_seconds }) => {
        const deadline = Date.now() + wait_seconds * 1000;
        let current = await routeJson(readMusicGeneration, request, `/api/v1/music/generations/${generation_id}`, { params: { id: generation_id } });
        while (current.response.ok && musicGenerationPending(current.data) && Date.now() + WAIT_STEP_MS <= deadline) {
            await sleep(WAIT_STEP_MS);
            current = await routeJson(readMusicGeneration, request, `/api/v1/music/generations/${generation_id}`, { params: { id: generation_id } });
        }
        if (!current.response.ok) return errorResult(current.response.status, current.data);

        const content = [{ type: 'text', text: `Music generation ${generation_id} is ${current.data.state}.` }];
        const candidates = [];
        for (const candidate of Array.isArray(current.data.candidates) ? current.data.candidates : []) {
            const { audio_url: _relativeAudioUrl, ...safeCandidate } = candidate || {};
            if (safeCandidate.state !== 'ready') {
                candidates.push(safeCandidate);
                continue;
            }
            if (!safeCandidate.job_id) {
                candidates.push({ ...safeCandidate, asset_error: { error: 'asset_unavailable' } });
                continue;
            }
            const asset = await routeJson(readJobAsset, request, `/api/v1/jobs/${safeCandidate.job_id}/asset`, { params: { id: safeCandidate.job_id } });
            if (!asset.response.ok) {
                candidates.push({ ...safeCandidate, asset_error: musicAssetError(asset.response, asset.data) });
                continue;
            }
            candidates.push({ ...safeCandidate, asset: asset.data });
            content.push({
                type: 'resource_link',
                name: `veyrnox-music-${safeCandidate.job_id}`,
                title: `Generated Veyrnox Music candidate ${safeCandidate.label || safeCandidate.ordinal || ''}`.trim(),
                description: `Short-lived audio URL; expires in ${asset.data.expires_in} seconds.`,
                uri: asset.data.url,
                mimeType: asset.data.mime_type,
                size: Number(asset.data.size_bytes) || undefined,
            });
        }
        return { content, structuredContent: { ...current.data, candidates } };
    });

    server.registerTool('list_music_playlists', {
        title: 'List Music playlists',
        description: 'List the signed-in account\'s owned Music playlists.',
        inputSchema: z.object({}),
        annotations: readOnly,
    }, async () => {
        const { response, data } = await routeJson(listMusicPlaylists, request, '/api/v1/music/playlists');
        if (!response.ok) return errorResult(response.status, data);
        return textResult(data);
    });

    server.registerTool('create_music_playlist', {
        title: 'Create Music playlist',
        description: 'Create one owned Music playlist. Reuse the same idempotency_key for retries.',
        inputSchema: z.object({ title: z.string().min(1).max(80), idempotency_key: MUSIC_IDEMPOTENCY_KEY }),
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    }, async (args) => {
        const { response, data } = await routeJson(createMusicPlaylist, request, '/api/v1/music/playlists', { method: 'POST', body: args });
        if (!response.ok) return errorResult(response.status, data);
        return textResult(data, `Created Music playlist ${data.playlist?.title || ''}.`.trim());
    });

    server.registerTool('update_music_playlist', {
        title: 'Update Music playlist',
        description: `Replace an owned playlist's ordered song list or change its pinned state using the current revision. Replacement accepts at most ${MCP_MUSIC_PLAYLIST_MAX_SONGS} unique song ids per call; use the Veyrnox app for larger playlists. Reuse the same idempotency_key for retries.`,
        inputSchema: z.object({
            playlist_id: UUID,
            action: z.enum(['replace', 'pin']),
            expected_revision: z.number().int().min(0).max(2147483647),
            song_ids: z.array(UUID).max(MCP_MUSIC_PLAYLIST_MAX_SONGS).refine(
                (ids) => new Set(ids.map((id) => id.toLowerCase())).size === ids.length,
                { message: 'song_ids must be unique' },
            ).optional(),
            pinned: z.boolean().optional(),
            idempotency_key: MUSIC_IDEMPOTENCY_KEY,
        }).superRefine((value, context) => {
            const replace = value.action === 'replace' && Array.isArray(value.song_ids) && value.pinned === undefined;
            const pin = value.action === 'pin' && value.song_ids === undefined && typeof value.pinned === 'boolean';
            if (!replace && !pin) context.addIssue({ code: 'custom', message: 'replace needs only song_ids; pin needs only pinned' });
        }),
        annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    }, async ({ playlist_id, action, expected_revision, song_ids, pinned, idempotency_key }) => {
        const body = action === 'replace'
            ? { action, expected_revision, song_ids, idempotency_key }
            : { action, expected_revision, pinned, idempotency_key };
        const { response, data } = await routeJson(updateMusicPlaylist, request, `/api/v1/music/playlists/${playlist_id}`, {
            method: 'PATCH', body, params: { id: playlist_id },
        });
        if (!response.ok) return errorResult(response.status, data);
        return textResult(data, `Updated Music playlist to revision ${data.revision}.`);
    });

    server.registerTool('get_generation', {
        title: 'Get generation',
        description: `Read an owned generation. When it has succeeded, the result includes a short-lived link to the generated asset. Pass wait_seconds (up to ${MAX_WAIT_SECONDS}) to hold the call until the generation finishes or the time is up, instead of calling again and again; video usually takes minutes, so repeat with wait_seconds while the state is queued or running.`,
        inputSchema: z.object({ job_id: UUID, wait_seconds: z.number().int().min(0).max(MAX_WAIT_SECONDS).default(0) }),
        annotations: { ...readOnly, openWorldHint: true },
    }, async ({ job_id, wait_seconds }) => {
        const deadline = Date.now() + wait_seconds * 1000;
        let { response, data } = await routeJson(readJob, request, `/api/v1/jobs/${job_id}`, { params: { id: job_id } });
        while (response.ok && (data.state === 'queued' || data.state === 'running') && Date.now() + WAIT_STEP_MS <= deadline) {
            await sleep(WAIT_STEP_MS);
            ({ response, data } = await routeJson(readJob, request, `/api/v1/jobs/${job_id}`, { params: { id: job_id } }));
        }
        if (!response.ok) return errorResult(response.status, data);

        const content = [{ type: 'text', text: `Generation ${job_id} is ${data.state}.` }];
        let result = { job_id, ...withPublicJobModelIds(data) };
        if (data.state === 'succeeded') {
            const asset = await routeJson(readJobAsset, request, `/api/v1/jobs/${job_id}/asset`, { params: { id: job_id } });
            if (asset.response.ok) {
                result = { ...result, asset: asset.data };
                content.push({
                    type: 'resource_link',
                    name: `veyrnox-generation-${job_id}`,
                    title: 'Generated Veyrnox asset',
                    description: `Short-lived result URL; expires in ${asset.data.expires_in} seconds.`,
                    uri: asset.data.url,
                    mimeType: asset.data.mime_type,
                    size: Number(asset.data.size_bytes) || undefined,
                });
            } else {
                result = { ...result, asset_error: asset.data?.error || `http_${asset.response.status}` };
            }
        }
        return { content, structuredContent: result };
    });

    server.registerTool('list_generations', {
        title: 'List generations',
        description: 'List the signed-in Veyrnox account’s recent generations, newest first. The text result carries each as JSON: job_id, model_id, status, created_at, output_type and has_output. Use get_generation for a short-lived output link.',
        inputSchema: z.object({
            limit: z.number().int().min(1).max(50).default(24),
            before: z.string().datetime().optional(),
            before_id: UUID.optional(),
        }).refine((value) => Boolean(value.before) === Boolean(value.before_id), {
            message: 'before and before_id must be supplied together',
        }),
        annotations: readOnly,
    }, async ({ limit, before, before_id }) => {
        const url = new URL('/api/v1/jobs', PUBLIC_ORIGIN);
        url.searchParams.set('limit', String(limit));
        if (before && before_id) {
            url.searchParams.set('before', before);
            url.searchParams.set('before_id', before_id);
        }
        const { response, data } = await routeJson(listJobs, request, `${url.pathname}${url.search}`);
        if (!response.ok) return errorResult(response.status, data);
        let models = [];
        try { models = withPublicModelIds(await readPublicCatalog()); } catch { /* output_type is simply null */ }
        const publicData = withPublicJobModelIds(data);
        return textResult(publicData, generationListText(publicData, models));
    });

    server.registerTool('get_balance', {
        title: 'Get credit balance',
        description: 'Read the signed-in Veyrnox account’s paid and free credit balances.',
        inputSchema: z.object({}),
        annotations: readOnly,
    }, async () => {
        const { response, data } = await routeJson(readBalance, request, '/api/v1/balance');
        if (!response.ok) return errorResult(response.status, data);
        return textResult(data, `This Veyrnox account has ${data.balance} paid credits and ${data.free_credits} free credits.`);
    });

    if (publishAutomationEnabled()) registerPublishTools(server, request);

    return server;
}
