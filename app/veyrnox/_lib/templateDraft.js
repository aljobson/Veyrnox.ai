import { templateModelId } from './tokens.js';
import { ratioOf } from '../../../lib/aspectShapes.mjs';
import { GENERATION_PROMPT_MAX } from '../../../lib/generationPromptLimits.js';

// The longest prompt POST /api/v1/generations accepts (app/api/v1/generations/route.js).
export const TEMPLATE_PROMPT_MAX = GENERATION_PROMPT_MAX;

const nonEmptyString = (value) => typeof value === 'string' && value.trim().length > 0;
const previewRatio = (preset) => { const text = preset.clip?.aspectRatio ?? preset.previewAspect; return ratioOf(text) === null ? null : text.trim(); };
const supportedDuration = (value) => value === 5 || value === 10;

// Shared with Create's model list; topic starts remain behind its local flag.
export const createPromptModelAvailable = (model, autoShortOn = false) => Boolean(model
  && !model.isEdit && !model.takesPlan && (autoShortOn || !model.takesTopic));

export const templateModelEligible = (model, templateModel) => Boolean(
  model?.modality && templateModel?.modality && model.modality === templateModel.modality
  && !model.gated && !model.premium && createPromptModelAvailable(model));

// Resolve the template from the URL even when session storage is unavailable.
// Only the initial, validated arrival can bind a recipe to a different model.
export function draftForTemplate(preset, modelId, arrivalTemplateId) {
  const originalModel = preset && templateModelId(preset);
  if (!preset || typeof modelId !== 'string' || !modelId
    || !originalModel || (originalModel !== modelId && arrivalTemplateId !== preset.id)
    || !nonEmptyString(preset.prompt) || !nonEmptyString(preset.id)) return null;
  return {
    prompt: preset.sourcePromptOrigin === 'community-source-exact' && nonEmptyString(preset.sourcePrompt) ? preset.sourcePrompt : preset.prompt,
    // A template that records no aspect keeps its preview's own ratio, unsnapped; the Create page matches it once against the options its model offers.
    aspect: nonEmptyString(preset.aspect) ? preset.aspect : previewRatio(preset),
    durationSeconds: supportedDuration(preset.durationSeconds) ? preset.durationSeconds : 5,
    negativePrompt: nonEmptyString(preset.negativePrompt) ? preset.negativePrompt : '',
    templateId: preset.id,
  };
}

// A saved edit can override its own recipe, but never another template that
// happens to use the same model. Older drafts did not carry a template id.
export function resolveTemplateDraft(preset, modelId, storedDraft, arrivalTemplateId) {
  if (!preset) return storedDraft;
  const draft = draftForTemplate(preset, modelId, arrivalTemplateId);
  if (!draft) return null;
  if (!storedDraft || typeof storedDraft !== 'object'
    || (storedDraft.templateId !== preset.id && (arrivalTemplateId || storedDraft.templateId !== undefined))) return draft;
  return {
    ...draft,
    ...(nonEmptyString(storedDraft.prompt) ? { prompt: storedDraft.prompt } : {}),
    ...(nonEmptyString(storedDraft.aspect) ? { aspect: storedDraft.aspect } : {}),
    ...(supportedDuration(storedDraft.durationSeconds) ? { durationSeconds: storedDraft.durationSeconds } : {}),
    ...(nonEmptyString(storedDraft.negativePrompt) ? { negativePrompt: storedDraft.negativePrompt } : {}),
  };
}

// Called once on arrival, after the catalog settles. URL settings win, even
// with blocked storage; unrelated stored recipes never enter this binding.
export function templateArrival(preset, models, params, storedDraft) {
  const original = models.find(model => model.id === templateModelId(preset));
  const saved = storedDraft?.templateId === preset.id ? storedDraft : null;
  const requested = params.get('model') || saved?.model;
  const candidate = models.find(model => model.id === requested);
  const model = templateModelEligible(candidate, original) ? candidate : original;
  const modelId = model?.id || templateModelId(preset);
  const draft = resolveTemplateDraft(preset, modelId, saved, preset.id);
  if (!draft) return { modelId, draft: null };
  const seconds = /^\d{1,2}s?$/.test(params.get('duration') || '') ? Number(params.get('duration').replace('s', '')) : null;
  const durationSeconds = model?.durations?.includes(seconds) ? seconds
    : model?.durations?.includes(saved?.durationSeconds) ? saved.durationSeconds : draft.durationSeconds;
  return { modelId, draft: {
    ...draft,
    ...(ratioOf(params.get('aspect')) !== null ? { aspect: params.get('aspect') } : {}),
    durationSeconds,
  } };
}
