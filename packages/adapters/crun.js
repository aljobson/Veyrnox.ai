/**
 * Crun provider adapter (ADR-0256, phase 5), Worker runtime, no dependencies.
 *
 * NOT REGISTERED. Nothing in packages/provider-sdk/registry.js names it and no
 * catalog row uses it, so no job can reach Crun. It exists so the route and its
 * request shapes are reviewed and tested before the owner has answers on resale
 * rights, upstream supply and credit expiry, and before there is a key.
 *
 *   submitTask(job, cfg)   POST /api/v1/client/job/CreateTask
 *   fetchTask(taskId, cfg) GET  /api/v1/client/job/TaskInfo
 *
 * Request shapes are copied from docs.crun.ai (read 2026-10-24) for the
 * text-to-video models, and (2026-10-25) for two text-to-image models. The TaskInfo query parameter name (`task_id`) and
 * any status word beyond running / success / failed are unconfirmed until one
 * live probe; an unknown status is treated as still running, never as success.
 * Crun documents no signed callback, so the route is poll-only: callback_url
 * is never sent. Media is kept 14 days, so a completed output must be copied to
 * R2 on first read.
 *
 * `provider_endpoint` is `crun:<crun model id>`, for example
 * `crun:google/veo3-1-lite-t2v`.
 */

import { seedance25Task, buildSeedance25Request } from '../../lib/crunSeedance25.js';
import { readBoundedBody } from '../../lib/boundedBody.js';
import { CRUN_FLUX_2_PRO_ASPECTS, CRUN_FLUX_2_PRO_PROMPT_MAX, CRUN_KLING_AVATAR_PROMPT_MAX } from '../../lib/crunPrimaryCapabilities.js';
import { templateFacePrompt } from '../../lib/templateFaceWording.mjs';
import { SEEDANCE_R2V_MODEL, buildSeedanceReferenceRequest } from '../../lib/crunSeedanceReference.js';
import { QWEN_ENDPOINT, QWEN_SCRIPT_LIMIT, QWEN_INPUT_RULES } from '../../lib/qwenSpeechInputs.js';
import { CRUN_KLING_O1_REFERENCE_ENDPOINT_MODEL, buildKlingO1ReferenceRequest } from '../../lib/crunKlingO1Reference.js';
import { CRUN_IMAGE_TOOL_MODELS, buildCrunImageToolRequest } from '../../lib/crunImageTools.js';

export const CRUN_API_BASE = 'https://api.crun.ai';

// Model id -> what the model accepts. Seconds are the clip lengths that map
// onto one priced unit; resolutions are what the catalog row is priced at.
const MODELS = {
    'google/veo3-1-lite-t2v': { seconds: new Set([8]), resolutions: new Set(['720p']), aspects: new Set(['16:9', '9:16']) },
    'google/veo3-1-fast-t2v': { seconds: new Set([8]), resolutions: new Set(['720p']), aspects: new Set(['16:9', '9:16']) },
    'google/veo3-1-t2v': { seconds: new Set([8]), resolutions: new Set(['720p']), aspects: new Set(['16:9', '9:16']) },
    // Seedance has an `audio` switch that defaults to off (the 2026-10-24 probe clip was silent). The offer it backs
    // asks for synchronized audio by default, so the request always sends it. Veo makes its own audio.
    'bytedance/seedance2-0-fast-t2v': { seconds: new Set([5]), resolutions: new Set(['720p']), aspects: new Set(['16:9', '9:16', '1:1']), audio: true },
};
for (const model of ['google/veo3-1-lite', 'google/veo3-1-fast', 'google/veo3-1']) {
    MODELS[`${model}-i2v`] = MODELS[`${model}-t2v`];
}
const SUNO_MODEL = 'suno/music-generate';
const SUNO_SOUNDS_MODEL = 'suno/sounds-generate';
const SUNO_VERSIONS = new Set(['v6', 'v6_mini', 'v6_wild']);
const SUNO_MODELS = new Set(['v6', 'v6_mini', 'v6_wild', 'chirp-v6']);
// Kling (docs.crun.ai/models/kling/v3-0.json and v2-6.json, read 2026-11-03). Each mirrors the kie row it would back:
// `kling/v3` is the 3.0 image-to-video offer (pro = 1080p; `kling/v3-std` is the same at 720p, single shot, audio off, one start frame required) and
// `kling/v2-6` is the 2.6 Pro text-to-video offer (pro, audio off, no source image). Both are sold as a 5 s unit and
// a 10 s clip bills twice that, so the length is the caller's choice between the two the catalog prices.
// Crun documents a 2,500-character prompt for both Kling models.
const KLING_PROMPT_MAX = 2500;
const KLING_SECONDS = new Set([5, 10]);
const KLING_ASPECTS = new Set(['16:9', '9:16', '1:1']);
// `mode` is Crun's tier field: `std` = 720p, `pro` = 1080p (docs.crun.ai/models/kling/v3-0.json, read 2026-11-17).
// `kling/v3-std` is OUR endpoint name for the 720p tier of the same Crun model `kling/v3`: the endpoint carries the
// tier, so a route row can say which one it is priced at (14 credits a second at 720p, 18 at 1080p).
const KLING_MODELS = {
    'kling/v3': { image: 'required', apiModel: 'kling/v3', mode: 'pro' },
    'kling/v3-std': { image: 'required', apiModel: 'kling/v3', mode: 'std' },
    'kling/v2-6': { image: 'refused', apiModel: 'kling/v2-6', mode: 'pro' },
};
// Text-to-image (docs.crun.ai/models/google/nano-banana.json and /seedream/seedream-4.0.json, read 2026-10-25).
// One image per request, no reference images: the offers they back take a prompt and an aspect ratio only.
// `fixed` is sent as-is. Seedream's resolution is pinned to 2K (the fal row it would back renders 2048 x 2048)
// and its aspect set is the square only, because that row has no aspect input.
const IMAGE_MODELS = {
    'google/nano-banana': { kind: 'image', aspects: new Set(['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9']), fixed: { output_format: 'png' } },
    // Docs read 2026-10-26: resolution 1K | 2K | 4K, default 1K; the 3-credit price on Crun's page is the 1K row.
    'google/nano-banana-2-1': { kind: 'image', aspects: new Set(['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9']), fixed: { resolution: '1K' } },
    'bytedance/seedream-4': { kind: 'image', aspects: new Set(['1:1']), fixed: { resolution: '2K', num_outputs: 1 } },
    // Built by buildFluxRequest: unlike the rows above it takes a seed and has a 4:3 default.
    'flux-2-pro': { kind: 'image', aspects: new Set(CRUN_FLUX_2_PRO_ASPECTS), fixed: { resolution: '1K', output_format: 'png' } },
};
const FLUX_2_PRO_MODEL = 'flux-2-pro';
const KLING_AVATAR_MODEL = 'kling/avatar';
const WAN_ANIMATE_MODEL = 'wan/2-2-animate-replace';
// Template swaps only (ADR-0351 amendment 21); the public Kling O1 offer stays on fal and never reaches this builder.
const KLING_O1_SWAP_MODEL = 'kling/o1-r2v';
// Our endpoint name -> the resolution sent to Crun's one model id (ADR-0351 amendment 22).
const KLING_O1_SWAP_TIERS = Object.freeze({ [KLING_O1_SWAP_MODEL]: '720p', 'kling/o1-r2v-1080': '1080p' });
const isKlingO1Swap = model => Object.hasOwn(KLING_O1_SWAP_TIERS, model);
// These requests carry signed links to a person's photo or voice, so Crun's own refusal text is never kept.
const isVeoI2v = model => /^google\/veo3-1-(?:lite-|fast-)?i2v$/.test(model);
const redactsRefusal = model => isVeoI2v(model) || !!seedance25Task(model) || model === QWEN_ENDPOINT || isKlingO1Swap(model) || model === KLING_AVATAR_MODEL || model === SEEDANCE_R2V_MODEL || model === CRUN_KLING_O1_REFERENCE_ENDPOINT_MODEL || CRUN_IMAGE_TOOL_MODELS.includes(model);
const ENDPOINT_RE = /^crun:([a-z0-9][a-z0-9./_-]{1,80})$/i;
const TASK_ID_RE = /^[A-Za-z0-9._-]{1,128}$/;

/** @returns {{model:string}|null} */
export function parseEndpoint(endpoint) {
    if (typeof endpoint === 'string' && endpoint.startsWith('crun:') && seedance25Task(endpoint.slice(5))) return { model: endpoint.slice(5) };
    const m = ENDPOINT_RE.exec(String(endpoint || ''));
    return m && !m[1].includes('..') && (m[1] === QWEN_ENDPOINT || MODELS[m[1]] || IMAGE_MODELS[m[1]] || KLING_MODELS[m[1]] || m[1] === WAN_ANIMATE_MODEL || m[1] === KLING_AVATAR_MODEL || m[1] === SEEDANCE_R2V_MODEL || m[1] === CRUN_KLING_O1_REFERENCE_ENDPOINT_MODEL || CRUN_IMAGE_TOOL_MODELS.includes(m[1]) || m[1] === SUNO_MODEL || m[1] === SUNO_SOUNDS_MODEL || isKlingO1Swap(m[1])) ? { model: m[1] } : null;
}

/** 'video', 'image', 'audio' (music) or 'speech' for a Crun endpoint this adapter owns, else null. */
export function endpointKind(endpoint) {
    const target = parseEndpoint(endpoint);
    return target ? ([SUNO_MODEL, SUNO_SOUNDS_MODEL].includes(target.model) ? 'audio' : target.model === QWEN_ENDPOINT ? 'speech' : IMAGE_MODELS[target.model] || CRUN_IMAGE_TOOL_MODELS.includes(target.model) ? 'image' : 'video') : null;
}

/**
 * Map gateway-validated inputs onto a Crun CreateTask body. Refuses what the
 * model cannot take instead of changing what the user asked for.
 * @returns {{ok:true, body:object}|{ok:false, error:string}}
 */
export function buildRequest(target, inputs) {
    if (target.model === QWEN_ENDPOINT) return buildQwenRequest(inputs);
    if (seedance25Task(target.model)) return buildSeedance25Request(seedance25Task(target.model), inputs);
    if (target.model === SUNO_MODEL) return buildSunoRequest(inputs);
    if (target.model === SUNO_SOUNDS_MODEL) return buildSunoSoundsRequest(inputs);
    if (target.model === WAN_ANIMATE_MODEL) return buildWanAnimateRequest(inputs);
    if (isKlingO1Swap(target.model)) return buildKlingO1SwapRequest(inputs, KLING_O1_SWAP_TIERS[target.model]);
    if (target.model === FLUX_2_PRO_MODEL) return buildFluxRequest(inputs);
    if (target.model === KLING_AVATAR_MODEL) return buildKlingAvatarRequest(inputs);
    if (target.model === SEEDANCE_R2V_MODEL) return buildSeedanceReferenceRequest(inputs);
    if (target.model === CRUN_KLING_O1_REFERENCE_ENDPOINT_MODEL) return buildKlingO1ReferenceRequest(inputs);
    if (CRUN_IMAGE_TOOL_MODELS.includes(target.model)) return buildCrunImageToolRequest(target.model, inputs);
    const image = IMAGE_MODELS[target.model];
    if (image) return buildImageRequest(target, image, inputs);
    const kling = KLING_MODELS[target.model];
    if (kling) return buildKlingRequest(target, kling, inputs);
    const spec = MODELS[target.model];
    if (!spec) return { ok: false, error: 'provider_unsupported' };
    const prompt = typeof inputs.prompt === 'string' ? inputs.prompt : '';
    if (!prompt.trim()) return { ok: false, error: 'prompt_required' };
    // One priced unit per request: the catalog row is costed at this length, so it is pinned and the page's
    // default duration_seconds is ignored, exactly as the kie Veo builder does (the studio sends 5 for every video).
    const seconds = [...spec.seconds][0];
    const aspect = inputs.aspect_ratio === undefined ? '16:9' : inputs.aspect_ratio;
    if (!spec.aspects.has(aspect)) return { ok: false, error: 'aspect_ratio_unsupported' };
    const veo = target.model.startsWith('google/veo3-1-');
    const imageRequest = veo && (inputs.image_url !== undefined || target.model.endsWith('-i2v'));
    if (inputs.img_urls !== undefined || inputs.reference_urls !== undefined || inputs.video_url !== undefined || inputs.audio_url !== undefined || inputs.endImage_url !== undefined
        || (!veo && inputs.image_url !== undefined)) return { ok: false, error: 'input_media_unsupported' };
    if (imageRequest) {
        const images = Array.isArray(inputs.image_url) ? inputs.image_url : [inputs.image_url];
        if (images.length !== 1) return { ok: false, error: 'source_count_exceeded' };
        try { if (typeof images[0] !== 'string' || new URL(images[0]).protocol !== 'https:') throw new Error(); }
        catch { return { ok: false, error: 'inputs_invalid:image_url' }; }
        if (inputs.resolution !== undefined && inputs.resolution !== '720p') return { ok: false, error: 'resolution_not_supported' };
        // Five is the existing UI billing unit; the output remains eight seconds.
        if (inputs.duration_seconds !== undefined && ![5, 8].includes(inputs.duration_seconds)) return { ok: false, error: 'duration_not_supported' };
        return { ok: true, body: { model: target.model.replace(/-t2v$/, '-i2v'), input: {
            prompt, duration: 8, resolution: '720p', aspect_ratio: aspect, img_urls: [...images],
        } } };
    }
    return {
        ok: true,
        body: { model: target.model, input: { prompt, duration: seconds, resolution: [...spec.resolutions][0], aspect_ratio: aspect, ...(spec.audio ? { audio: true } : {}) } },
    };
}

function textField(input, field, max, { required = false } = {}) {
    const value = input[field];
    if (value === undefined || value === null || value === '') return required ? { error: `inputs_invalid:${field}` } : { value: undefined };
    if (typeof value !== 'string' || [...value].length > max || (required && !value.trim())) return { error: `inputs_invalid:${field}` };
    return { value };
}

/** Strict Suno v1 payload builder. Unknown fields are refused before spend. */
function buildSunoRequest(inputs) {
    if (!inputs || typeof inputs !== 'object' || Array.isArray(inputs)) return { ok: false, error: 'inputs_invalid' };
    const allowed = new Set(['mode', 'prompt', 'instrumental', 'suno_model', 'title', 'tags', 'lyrics', 'negative_tags',
        'vocal_gender', 'style_weight', 'weirdness_constraint', 'duration', 'variety']);
    for (const key of Object.keys(inputs)) if (!allowed.has(key)) return { ok: false, error: `inputs_key_not_allowed:${key.slice(0, 32)}` };
    const mode = inputs.mode || 'simple';
    // Generic Create sells this route as instrumental music and does not expose
    // the CRUN-only switch, so preserve that contract when simple mode omits it.
    // Custom mode still requires an explicit choice because it governs lyrics.
    const instrumental = inputs.instrumental === undefined && mode === 'simple' ? true : inputs.instrumental;
    if (typeof instrumental !== 'boolean') return { ok: false, error: 'inputs_invalid:instrumental' };
    const requestedModel = inputs.suno_model || 'v6';
    const version = requestedModel === 'chirp-v6' ? 'v6' : requestedModel;
    if (!SUNO_MODELS.has(requestedModel) || !SUNO_VERSIONS.has(version)) return { ok: false, error: 'inputs_invalid:suno_model' };
    if (mode === 'simple') {
        const prompt = textField(inputs, 'prompt', 500, { required: true });
        if (prompt.error) return { ok: false, error: prompt.error };
        if (Object.keys(inputs).some((key) => !['mode', 'prompt', 'instrumental', 'suno_model'].includes(key))) return { ok: false, error: 'inputs_invalid:mode' };
        return { ok: true, body: { model: SUNO_MODEL, input: { mode, prompt: prompt.value, instrumental, model: version } } };
    }
    if (mode !== 'custom') return { ok: false, error: 'inputs_invalid:mode' };
    const title = textField(inputs, 'title', 80);
    const tags = textField(inputs, 'tags', 1000, { required: true });
    const lyrics = textField(inputs, 'lyrics', 5000, { required: !instrumental });
    const negative = textField(inputs, 'negative_tags', 200);
    for (const field of [title, tags, lyrics, negative]) if (field.error) return { ok: false, error: field.error };
    if (inputs.vocal_gender !== undefined && !['m', 'f'].includes(inputs.vocal_gender)) return { ok: false, error: 'inputs_invalid:vocal_gender' };
    for (const field of ['style_weight', 'weirdness_constraint']) {
        if (inputs[field] !== undefined && (typeof inputs[field] !== 'number' || !Number.isFinite(inputs[field]) || inputs[field] < 0 || inputs[field] > 1)) return { ok: false, error: `inputs_invalid:${field}` };
    }
    if (inputs.duration !== undefined && (!Number.isInteger(inputs.duration) || inputs.duration < 1 || inputs.duration > 360)) return { ok: false, error: 'inputs_invalid:duration' };
    if (inputs.variety !== undefined && (!Number.isInteger(inputs.variety) || inputs.variety < 0 || inputs.variety > 4)) return { ok: false, error: 'inputs_invalid:variety' };
    const input = { mode, instrumental, model: version, tags: tags.value };
    for (const [field, value] of [['title', title.value], ['lyrics', lyrics.value], ['negative_tags', negative.value],
        ['vocal_gender', inputs.vocal_gender], ['style_weight', inputs.style_weight], ['weirdness_constraint', inputs.weirdness_constraint],
        ['duration', inputs.duration], ['variety', inputs.variety]]) if (value !== undefined) input[field] = value;
    return { ok: true, body: { model: SUNO_MODEL, input } };
}

/** CRUN's dedicated short sound-effects endpoint; only controls exposed by Veyrnox are forwarded. */
function buildSunoSoundsRequest(inputs) {
    if (!inputs || typeof inputs !== 'object' || Array.isArray(inputs)) return { ok: false, error: 'inputs_invalid' };
    const refused = refuseOtherKeys(inputs, new Set(['prompt', 'loop']));
    if (refused) return refused;
    const prompt = textField(inputs, 'prompt', 500, { required: true });
    if (prompt.error) return { ok: false, error: prompt.error };
    if (inputs.loop !== undefined && typeof inputs.loop !== 'boolean') return { ok: false, error: 'inputs_invalid:loop' };
    return { ok: true, body: { model: SUNO_SOUNDS_MODEL, input: {
        model: 'v6', prompt: prompt.value, sound_loop: inputs.loop === true, grab_lyrics: false,
    } } };
}

const safeCode = (value, fallback = 0) => Number.isInteger(value) && value >= 0 && value <= 999 ? value : fallback;

/** CreateTask classification contains only allowlisted codes and numeric statuses. */
export function classifyCreateTaskResponse(httpStatus, body) {
    const status = safeCode(httpStatus);
    const bodyCode = safeCode(body?.code, status);
    const base = { httpStatus: status, bodyCode };
    // A known non-200 HTTP status is authoritative. A contradictory success
    // code in the body must never turn 401/429 into acceptance or a refund.
    if (status === 408 || status >= 500) return { ...base, class: 'unknown', errorCode: status === 408 ? 'provider_timeout' : 'provider_unreachable' };
    if ([401, 402, 403].includes(status)) return { ...base, class: 'account', errorCode: status === 402 ? 'provider_payment_required' : 'provider_auth_failed' };
    if (status === 429) return { ...base, class: 'deferred', errorCode: 'provider_rate_limited' };
    if ([455, 505].includes(status)) return { ...base, class: 'route', errorCode: 'provider_route_unavailable' };
    if (status === 422) return { ...base, class: 'rejected', errorCode: 'provider_input_rejected' };
    if (status === 451) return { ...base, class: 'rejected', errorCode: 'provider_moderation' };
    if (status === 200 && bodyCode === 200) {
        const taskId = body?.data?.task_id;
        return typeof taskId === 'string' && TASK_ID_RE.test(taskId)
            ? { ...base, class: 'accepted', taskId }
            : { ...base, class: 'unknown', errorCode: 'provider_missing_task_id' };
    }
    // HTTP 200 may carry the documented refusal code. For other compatible
    // responses, a matching body code corroborates the HTTP classification.
    const code = status === 200 ? bodyCode : status;
    if (code === 422) return { ...base, class: 'rejected', errorCode: 'provider_input_rejected' };
    if (code === 451) return { ...base, class: 'rejected', errorCode: 'provider_moderation' };
    if ([401, 402, 403].includes(code)) return { ...base, class: 'account', errorCode: code === 402 ? 'provider_payment_required' : 'provider_auth_failed' };
    if (code === 429) return { ...base, class: 'deferred', errorCode: 'provider_rate_limited' };
    if ([455, 505].includes(code)) return { ...base, class: 'route', errorCode: 'provider_route_unavailable' };
    if (status === 408 || status >= 500 || code >= 500) return { ...base, class: 'unknown', errorCode: status === 408 ? 'provider_timeout' : 'provider_unreachable' };
    return { ...base, class: 'rejected', errorCode: 'provider_refused' };
}

/** TaskInfo classification: only authoritative failure 501 is terminal. */
export function classifyTaskInfoResponse(httpStatus, body, kind = 'video') {
    const status = safeCode(httpStatus);
    const bodyCode = Number.isInteger(body?.code) ? safeCode(body.code) : 0;
    const base = { httpStatus: status, bodyCode };
    if ((status === 200 || status === 501) && bodyCode === 501) return { ...base, ok: true, state: 'fail', errorCode: 'provider_task_failed' };
    if (status !== 200 || bodyCode !== 200) return { ...base, ok: false, errorCode: 'provider_status_unavailable' };
    const interpreted = interpretTask(body, kind);
    if (!interpreted.ok) return { ...base, ok: false, errorCode: 'provider_bad_response' };
    return interpreted.state === 'fail'
        ? { ...base, ok: true, state: 'fail', errorCode: 'provider_task_failed' }
        : { ...base, ...interpreted };
}

function klingO1RefusalReason(message) {
    const text = String(message || '');
    if (/moderat|sensitive|policy|nsfw|prohibit/i.test(text)) return 'content_policy';
    if (/insufficient|balance|quota/i.test(text)) return 'insufficient_balance';
    if (/invalid|parameter|unsupported/i.test(text)) return 'invalid_input';
    return '';
}

/** Public/log-safe projection of a Crun failure. Never copies message/msg. */
export function sanitizeCrunFailure(value) {
    const errorCode = /^[a-z0-9_]{1,64}$/.test(String(value?.errorCode || '')) ? value.errorCode : 'provider_error';
    return { errorCode, httpStatus: safeCode(value?.httpStatus), bodyCode: safeCode(value?.bodyCode) };
}

function buildWanAnimateRequest(inputs) {
    const allowed = new Set(['image_url', 'video_url', 'duration_seconds']);
    for (const key of Object.keys(inputs)) {
        if (!allowed.has(key)) return { ok: false, error: `inputs_key_not_allowed:${key.slice(0, 32)}` };
    }
    if (inputs.duration_seconds !== undefined && inputs.duration_seconds !== 5) return { ok: false, error: 'duration_not_supported' };
    const input = {};
    for (const [key, field] of [['image_url', 'img_urls'], ['video_url', 'video_urls']]) {
        const urls = Array.isArray(inputs[key]) ? inputs[key] : [inputs[key]];
        if (urls.length !== 1) return { ok: false, error: 'source_count_exceeded' };
        try {
            if (typeof urls[0] !== 'string' || new URL(urls[0]).protocol !== 'https:') throw new Error('invalid URL');
        } catch { return { ok: false, error: `inputs_invalid:${key}` }; }
        input[field] = [...urls];
    }
    return { ok: true, body: { model: WAN_ANIMATE_MODEL, input: { ...input, resolution: '720P' } } };
}

const isHttpsUrl = (value) => {
    try { return typeof value === 'string' && new URL(value).protocol === 'https:'; } catch { return false; }
};

// Crun has no element grouping, so the swap prompt's tags become plain references to the ordered images.
function klingO1SwapPrompt(prompt, imageCount) {
    const images = imageCount === 2 ? 'reference images 1 and 2' : `reference images 1 to ${imageCount}`;
    return prompt.replaceAll('@Video1', 'the reference video')
        .replaceAll("@Element1's", "that person's")
        .replaceAll('@Element1', `the person shown in ${images}`)
        .replaceAll('the element images', 'the reference images');
}

function buildKlingO1SwapRequest(inputs, resolution) {
    const allowed = new Set(['prompt', 'duration_seconds', 'video_url', 'elements']);
    for (const key of Object.keys(inputs)) {
        if (!allowed.has(key)) return { ok: false, error: `inputs_key_not_allowed:${key.slice(0, 32)}` };
    }
    if (inputs.duration_seconds !== 5) return { ok: false, error: 'duration_not_supported' };
    if (!isHttpsUrl(inputs.video_url)) return { ok: false, error: 'inputs_invalid:video_url' };
    const elements = inputs.elements;
    // One person only: two-person swaps are refused before debit until a live test proves them.
    if (!Array.isArray(elements) || elements.length !== 1) return { ok: false, error: 'inputs_invalid:elements' };
    const [{ frontal_image_url: frontal, reference_image_urls: references, ...extra } = {}] = elements;
    if (Object.keys(extra).length || !Array.isArray(references) || references.length < 1 || references.length > 2) return { ok: false, error: 'inputs_invalid:elements' };
    const images = [frontal, ...references];
    if (!images.every(isHttpsUrl)) return { ok: false, error: 'inputs_invalid:elements' };
    const source = typeof inputs.prompt === 'string' ? inputs.prompt.trim() : '';
    if (!source) return { ok: false, error: 'prompt_required' };
    const prompt = klingO1SwapPrompt(source, images.length);
    if (prompt.length > KLING_PROMPT_MAX || /@(?:video|element|image)/i.test(prompt)) return { ok: false, error: 'inputs_invalid:prompt' };
    return { ok: true, body: { model: KLING_O1_SWAP_MODEL, input: {
        prompt, reference_videos: [inputs.video_url], reference_video_type: 'base_video', reference_images: images,
        resolution, aspect_ratio: 'auto', audio: false,
    } } };
}

function buildKlingRequest(target, spec, inputs) {
    const allowed = new Set(['prompt', 'duration_seconds', ...(spec.image === 'required' ? ['image_url'] : ['aspect_ratio'])]);
    for (const key of Object.keys(inputs)) {
        if (!allowed.has(key)) return { ok: false, error: `inputs_key_not_allowed:${key.slice(0, 32)}` };
    }
    const prompt = typeof inputs.prompt === 'string' ? inputs.prompt.trim() : '';
    if (!prompt) return { ok: false, error: 'prompt_required' };
    if (prompt.length > KLING_PROMPT_MAX) return { ok: false, error: 'inputs_invalid:prompt' };
    const seconds = inputs.duration_seconds === undefined ? 5 : inputs.duration_seconds;
    if (!KLING_SECONDS.has(seconds)) return { ok: false, error: 'duration_not_supported' };
    // Audio is pinned off: the catalog rows are costed without it, and Crun bills sound extra (1.5x on 3.0, 2x on 2.6).
    const input = { mode: spec.mode, prompt, duration: seconds, audio: false };
    if (spec.image === 'required') {
        const url = inputs.image_url;
        if (typeof url !== 'string' || !/^https:\/\//.test(url)) return { ok: false, error: 'inputs_invalid:image_url' };
        // The film studio's versioned passport handles are labels, not Kling @element references (which need an
        // element_list payload): send them as plain text, exactly as the kie builder does.
        input.prompt = prompt.replace(/@([a-zA-Z][a-zA-Z0-9_]{0,39}:v[1-9]\d{0,3})\b/g, '$1');
        input.img_urls = [url];
        input.multi_shots = false;
    } else {
        const aspect = inputs.aspect_ratio === undefined ? '16:9' : inputs.aspect_ratio;
        if (!KLING_ASPECTS.has(aspect)) return { ok: false, error: 'inputs_invalid:aspect_ratio' };
        input.aspect_ratio = aspect;
    }
    return { ok: true, body: { model: spec.apiModel, input } };
}

function refuseOtherKeys(inputs, allowed) {
    const extra = Object.keys(inputs).find(key => !allowed.has(key));
    if (extra) return { ok: false, error: `inputs_key_not_allowed:${extra.slice(0, 32)}` };
    // Both offers are one priced unit: the page's default 5 is accepted and any other length is refused, as for the fal rows.
    // A null length means "not set": the route prices it as the default unit, and no length is sent to Crun.
    return inputs.duration_seconds === undefined || inputs.duration_seconds === null || inputs.duration_seconds === 5 ? null : { ok: false, error: 'duration_not_supported' };
}

function buildFluxRequest(inputs) {
    const refused = refuseOtherKeys(inputs, new Set(['prompt', 'seed', 'aspect_ratio', 'duration_seconds']));
    if (refused) return refused;
    const prompt = typeof inputs.prompt === 'string' ? inputs.prompt.trim() : '';
    if (!prompt || prompt.length > CRUN_FLUX_2_PRO_PROMPT_MAX) return { ok: false, error: 'inputs_invalid:prompt' };
    const aspect = inputs.aspect_ratio === undefined ? '4:3' : inputs.aspect_ratio;
    if (!IMAGE_MODELS[FLUX_2_PRO_MODEL].aspects.has(aspect)) return { ok: false, error: 'inputs_invalid:aspect_ratio' };
    const { seed } = inputs;
    if (seed !== undefined && (!Number.isInteger(seed) || seed < 0 || seed > 2147483647)) return { ok: false, error: 'inputs_invalid:seed' };
    return { ok: true, body: { model: FLUX_2_PRO_MODEL, input: {
        prompt, aspect_ratio: aspect, ...IMAGE_MODELS[FLUX_2_PRO_MODEL].fixed, ...(seed === undefined ? {} : { seed }),
    } } };
}

function buildKlingAvatarRequest(inputs) {
    const refused = refuseOtherKeys(inputs, new Set(['prompt', 'image_url', 'audio_url', 'duration_seconds']));
    if (refused) return refused;
    if (!isHttpsUrl(inputs.image_url)) return { ok: false, error: 'inputs_invalid:image_url' };
    if (!isHttpsUrl(inputs.audio_url)) return { ok: false, error: 'inputs_invalid:audio_url' };
    if (inputs.prompt !== undefined && typeof inputs.prompt !== 'string') return { ok: false, error: 'inputs_invalid:prompt' };
    const prompt = (inputs.prompt || '').trim();
    if (prompt.length > CRUN_KLING_AVATAR_PROMPT_MAX) return { ok: false, error: 'inputs_invalid:prompt' };
    return { ok: true, body: { model: KLING_AVATAR_MODEL, input: {
        mode: 'std', image_url: inputs.image_url, audio_url: inputs.audio_url, ...(prompt ? { prompt } : {}),
    } } };
}

function buildImageRequest(target, spec, inputs) {
    const prompt = typeof inputs.prompt === 'string' ? inputs.prompt.trim() : '';
    if (!prompt) return { ok: false, error: 'prompt_required' };
    const aspect = inputs.aspect_ratio === undefined ? '1:1' : inputs.aspect_ratio;
    if (!spec.aspects.has(aspect)) return { ok: false, error: 'aspect_ratio_unsupported' };
    if (inputs.image_url || inputs.reference_urls || inputs.img_urls) return { ok: false, error: 'input_media_unsupported' };
    return { ok: true, body: { model: target.model, input: { prompt, aspect_ratio: aspect, ...spec.fixed } } };
}

/**
 * @returns {Promise<{ok:true, providerJobId:string}|{ok:false, outcome:'rejected'|'unknown', error:string, errorCode?:string, clientError?:string}>}
 */
export async function submitTask(job, cfg) {
    if (!/^[A-Za-z0-9._-]{1,128}$/.test(String(job.job_id || ''))) return { ok: false, outcome: 'rejected', error: 'invalid job_id' };
    const target = parseEndpoint(job.provider_endpoint);
    if (!target) return { ok: false, outcome: 'rejected', error: 'invalid provider_endpoint' };
    const req = buildRequest(target, job.inputs || {});
    if (!req.ok) return { ok: false, outcome: 'rejected', error: req.error, clientError: req.error };
    if (!cfg?.apiKey) return { ok: false, outcome: 'rejected', error: 'provider_not_configured' };
    // The same submit-only template wording fal's Kling Pro request gets (ADR-0351); stored inputs never change.
    let requestBody = req.body;
    if (cfg.faceIdentity === true && target.model === 'kling/v3') {
        const worded = templateFacePrompt(req.body.input.prompt);
        if (worded === null) console.warn('face_wording_omitted_length', job.job_id);
        else requestBody = { ...req.body, input: { ...req.body.input, prompt: worded } };
    }

    const redactRefusal = redactsRefusal(target.model) || redactsRefusal(requestBody.model);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), cfg.timeoutMs ?? 15000);
    try {
        let res;
        try {
            res = await fetch(`${CRUN_API_BASE}/api/v1/client/job/CreateTask`, {
                method: 'POST',
                redirect: 'manual',
                signal: controller.signal,
                headers: { 'X-API-KEY': cfg.apiKey, 'Content-Type': 'application/json' },
                body: JSON.stringify(requestBody),
            });
        } catch (err) {
            // Nothing is known about whether the task was created: ambiguous (0329).
            // Models whose refusal text may carry signed media keep the legacy `transport` string and shape.
            if (redactRefusal) return { ok: false, outcome: 'unknown', error: 'transport' };
            return { ok: false, outcome: 'unknown', error: 'provider_unreachable', errorCode: err?.name === 'AbortError' ? 'provider_timeout' : 'provider_unreachable' };
        }
        let data = null;
        try {
            const bytes = await readBoundedBody(res.body, 128 * 1024, controller.signal);
            data = JSON.parse(new TextDecoder().decode(bytes));
        } catch {
            if (res.ok) return { ok: false, outcome: 'unknown', error: 'provider_bad_response', errorCode: 'provider_bad_response' };
        }
        const classified = classifyCreateTaskResponse(res.status, data);
        if (classified.class === 'accepted') return { ok: true, providerJobId: classified.taskId };
        const safe = sanitizeCrunFailure(classified);
        // Generic image/video/swap callers only understand rejected vs unknown.
        // Music's durable outbox consumes the typed scope/class directly and may
        // turn account, route, or rate refusals into READY/DEFERRED itself.
        // Models whose refusal text may carry signed media keep the reviewed reason slug in the legacy
        // `crun <http>/<code>: <reason>` shape (callers and failover match on it); never vendor text.
        let error = safe.errorCode;
        if (redactRefusal) {
            const reason = klingO1RefusalReason(data && (data.message || data.msg));
            error = `crun ${res.status}/${Number.isInteger(classified.bodyCode) ? classified.bodyCode : 0}${reason ? `: ${reason}` : ''}`;
        }
        // These models keep exactly their legacy result shape for ordinary refusals; only the supplier-level
        // classes (account, route, deferred) carry a typed scope so the shared Crun boundary can act on them.
        if (redactRefusal && !['account', 'route', 'deferred'].includes(classified.class)) {
            return { ok: false, outcome: classified.class === 'unknown' ? 'unknown' : 'rejected', error,
                ...(isVeoI2v(requestBody.model) && classified.class === 'rejected' ? { errorCode: safe.errorCode } : {}) };
        }
        return { ok: false, outcome: classified.class === 'unknown' ? 'unknown' : 'rejected',
            ...safe, error, scope: classified.class };
    } finally {
        clearTimeout(timer);
    }
}

/**
 * Map a TaskInfo body onto the shape the sweeps use. An unknown status is
 * pending: a surprise word must never complete a job.
 * @returns {{ok:true, state:'success', outputUrl:string}|{ok:true, state:'fail', errorCode:string}|{ok:true, state:'pending'}|{ok:false, error:string}}
 */
export function interpretTask(data, kind = 'video') {
    const task = data && data.data;
    if (!task || typeof task.status !== 'string') return { ok: false, error: 'crun task info missing' };
    if (task.status === 'success') {
        const url = kind === 'audio'
            ? (Array.isArray(task.suno_data) ? task.suno_data[0]?.suno_audio_url : task.result?.suno_data?.[0]?.suno_audio_url)
            : task.result && Array.isArray(task.result.media_urls) ? task.result.media_urls[0] : null;
        if (typeof url !== 'string' || !/^https:\/\//.test(url)) return { ok: false, error: 'crun success without an https output' };
        return { ok: true, state: 'success', outputUrl: url };
    }
    if (task.status === 'failed') return { ok: true, state: 'fail', errorCode: String((task.result && task.result.code) || 'provider_failed').slice(0, 40) };
    return { ok: true, state: 'pending' };
}

export async function fetchTask(taskId, cfg) {
    if (!TASK_ID_RE.test(String(taskId || ''))) return { ok: false, error: 'invalid task_id' };
    const url = new URL(`${CRUN_API_BASE}/api/v1/client/job/TaskInfo`);
    url.searchParams.set('task_id', taskId);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), cfg.timeoutMs ?? 15000);
    try {
        const res = await fetch(url.toString(), { signal: controller.signal, redirect: 'manual', headers: { 'X-API-KEY': cfg.apiKey } });
        let data = null;
        try {
            const bytes = await readBoundedBody(res.body, 128 * 1024, controller.signal);
            data = JSON.parse(new TextDecoder().decode(bytes));
        } catch { /* classified below as an unreadable transient */ }
        const classified = classifyTaskInfoResponse(res.status, data, cfg?.kind);
        if (classified.ok) return classified;
        return { ok: false, ...sanitizeCrunFailure(classified) };
    } catch (err) {
        return { ok: false, errorCode: err?.name === 'AbortError' ? 'provider_timeout' : 'provider_unreachable' };
    } finally {
        clearTimeout(timer);
    }
}

function buildQwenRequest(inputs) {
    const refused = refuseOtherKeys(inputs, new Set(['prompt', 'tts_voice', 'tts_language', 'duration_seconds']));
    if (refused) return refused;
    const text = typeof inputs.prompt === 'string' ? inputs.prompt : '';
    if (!text.trim()) return { ok: false, error: 'prompt_required' };
    if (text.length > QWEN_SCRIPT_LIMIT) return { ok: false, error: 'inputs_invalid:prompt' };
    const voice = inputs.tts_voice === undefined ? 'Cherry' : inputs.tts_voice;
    const language = inputs.tts_language === undefined ? 'auto' : inputs.tts_language;
    if (!QWEN_INPUT_RULES.tts_voice.values.includes(voice)) return { ok: false, error: 'inputs_invalid:tts_voice' };
    if (!QWEN_INPUT_RULES.tts_language.values.includes(language)) return { ok: false, error: 'inputs_invalid:tts_language' };
    return { ok: true, body: { model: QWEN_ENDPOINT, input: { text, voice, language_type: language === 'auto' ? 'Auto' : language } } };
}
