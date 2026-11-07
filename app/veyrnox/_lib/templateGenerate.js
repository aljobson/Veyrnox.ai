// Generate from the template page itself (ADR-0120 amendment 1). Pure pieces, so they are unit-tested without React.
// Everything sent is what Create sends for the same template with nothing attached: same body, same per-request
// idempotency key, same max_charge_credits from allocationSnapshot, same refund path. A template whose only media is one
// photo generates here too, with the photo as the start image and the rights tick Create asks for; a template that needs
// a video, audio or a described voice still goes through Create (inlineBlockReason).
import { sendInOrder, submitErrorCode, createBatch, allocationSnapshot } from './imageBatch.js';
import { audioDurationConfig, settingsInputs } from './generationSettings.js';
import { createPromptModelAvailable, TEMPLATE_PROMPT_MAX } from './templateDraft.js';
import { templateStartIdFor } from '../../../lib/templateStartCheck.js';

/** True when the model's one required media is a single photo (a start image), so the template page can take it. */
export function photoOnlyModel(model) {
  const required = Object.entries(model?.media || {}).filter(([, spec]) => spec?.required);
  return required.length === 1 && required[0][0] === 'image' && !(Number(required[0][1].minFiles) > 1);
}

const NON_PHOTO_NEEDS = /\b(video|audio|voice|clip|recording)\b/i;

/**
 * 'unavailable' | 'media' | 'options' | null (null = can generate here). With { photo: true } the page can attach one
 * photo, so a template whose only media is that photo is no longer blocked.
 */
export function inlineBlockReason(preset, model, { photo = false } = {}) {
  if (!preset || !model || model.gated || model.premium || !createPromptModelAvailable(model)) return 'unavailable';
  if (model.kind !== 'image' && model.kind !== 'video') return 'options';
  const photoOk = photo && photoOnlyModel(model) && !NON_PHOTO_NEEDS.test(String(preset.needs || ''));
  if (!photoOk && ((typeof preset.needs === 'string' && preset.needs.trim())
    || Object.values(model.media || {}).some(spec => spec?.required))) return 'media';
  if (model.takesVoice || audioDurationConfig(model)) return 'options';
  return null;
}

// A start image only fixes the first frame; this line keeps the person in it as the lead for the whole clip.
const PHOTO_CHARACTER_LINE = 'The person in the attached photo is the main character; keep their face, hair and clothing the same throughout.';

function withPhotoLine(text, withPhoto) {
  const joined = `${text}\n\n${PHOTO_CHARACTER_LINE}`;
  return withPhoto && joined.length <= TEMPLATE_PROMPT_MAX ? joined : text;
}

/** The inputs object Create builds for this template: prompt, shape, length, the template's own negative prompt. */
export function templateInputs(preset, model, { prompt, aspect, durationSeconds, aspectOptions, withPhoto = false }) {
  const exact = preset.sourcePromptOrigin === 'community-source-exact' && typeof preset.sourcePrompt === 'string' ? preset.sourcePrompt : preset.prompt;
  const uneditedExact = preset.sourcePromptOrigin === 'community-source-exact' && prompt === exact;
  const inputs = {
    // Like Create: the recipe's own words go unchanged, anything the person edited is trimmed.
    prompt: withPhotoLine(prompt === exact ? prompt : prompt.trim(), withPhoto && !uneditedExact),
    aspect_ratio: aspectOptions.length ? aspect : undefined,
    duration_seconds: model.kind === 'video' ? durationSeconds : undefined,
    ...settingsInputs(model, { seed: '', negative: preset.negativePrompt || '', voice: '', duration: '' }),
  };
  Object.keys(inputs).forEach(key => inputs[key] === undefined && delete inputs[key]);
  return inputs;
}

// GatewayError is matched by name so this module loads without the browser-only gateway.
export const errorFor = (e) => e?.name === 'GatewayError'
  ? { code: e.code, retryAfter: e.retryAfter, expectedCredits: e.body?.expected_credits } : { code: 'internal' };

// One id per File object, so two different files that share a name, size and date are never taken for the same photo.
const FILE_IDS = new WeakMap();
let nextFileId = 0;
export function fileIdentity(file) {
  if (!file || typeof file !== 'object') return null;
  if (!FILE_IDS.has(file)) FILE_IDS.set(file, ++nextFileId);
  return FILE_IDS.get(file);
}

// An uploaded photo is reused for the same file for this long, even when the request that used it was refused and its
// run (with its idempotency key) was discarded. Shorter than the 15-minute upload window, so a reused key is still valid.
export const UPLOAD_REUSE_MS = 10 * 60 * 1000;

// The server consumes an upload when a job is accepted, so a cached upload survives only a refusal that made no job.
const NO_JOB_REFUSALS = new Set(['rate_limited', 'insufficient_balance', 'price_changed']);
export const keepUpload = (error) => Boolean(error) && NO_JOB_REFUSALS.has(error.code);

/** The uploaded sources for this photo: the cached ones while fresh and unchanged, otherwise load() them once and cache. */
export async function cachedSources(cache, token, load, now = Date.now()) {
  if (cache.token === token && cache.sources && now - cache.at < UPLOAD_REUSE_MS) return cache.sources;
  const sources = await load();
  cache.token = token; cache.sources = sources; cache.at = now;
  return sources;
}

/** A new continuation, or the same one while the request is unchanged (so a retry keeps its key). */
export function templateRun(previous, identity, unit, makeKey) {
  return previous?.identity === identity ? previous : { ...createBatch(1, makeKey), identity, unit };
}

/**
 * Send the one request. Returns { error, confirm }: error is the banner object (null on success). Never retried under a
 * new key; the run keeps its key until the caller decides the batch is dead (templateRunDead).
 */
export async function submitTemplate({ run, quote, model, preset, inputs, makeKey, deps }) {
  const { gatewayFetch, onJob, freeAllowance } = deps;
  run.quote = quote;
  run.confirm = false;
  try {
    // An attached photo is uploaded once; a retry of the same request reuses its key.
    run.sources ??= deps.sources ? await deps.sources() : { references: [] };
    const references = run.sources.references;
    const { error: failure } = await sendInOrder(1, async (i) => {
      const submitted = await gatewayFetch('/generations', {
        method: 'POST',
        body: JSON.stringify({
          model_id: model.id, idempotency_key: run.keys[i], inputs,
          max_charge_credits: quote.ceilings[i],
          preset: templateStartIdFor(preset.id, preset, model.id) || undefined,
          references,
          consent: references.length ? true : undefined,
        }),
      });
      // A job that took a free allowance cost nothing; the server says so.
      onJob(submitted, submitted.free_allowance === true ? 0 : run.unit);
      return submitted;
    }, run, makeKey);
    if (!failure) return { error: null };
    const err = errorFor(failure);
    const code = submitErrorCode(err.code);
    if (code === 'price_changed' && Number.isInteger(err.expectedCredits) && err.expectedCredits >= 0) {
      let fresh = {};
      try { fresh = await freeAllowance(); } catch { /* a paid quote is safe */ }
      run.unit = err.expectedCredits;
      run.quote = allocationSnapshot(run, run.unit, fresh[model.id] > 0 ? fresh[model.id] : 0);
      run.confirm = true;
    } else run.quote = null;
    return { error: { ...err, code } };
  } catch (e) {
    const err = errorFor(e);
    return { error: { ...err, code: submitErrorCode(err.code) } };
  }
}

/** A definitive failure with nothing accepted or uncertain needs a new key next time. */
export function templateRunDead(run, error) {
  return Boolean(error) && !run.accepted.some(Boolean) && !run.confirm && !run.unknown.size && error.code !== 'outcome_unknown';
}
