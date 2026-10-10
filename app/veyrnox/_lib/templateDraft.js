import { modelIdForName } from './tokens.js';

const nonEmptyString = (value) => typeof value === 'string' && value.trim().length > 0;
const supportedDuration = (value) => value === 5 || value === 10;

// Resolve the template from the URL even when session storage is unavailable.
// A recipe belongs only to the model it names; changing the model must not
// restore that recipe's settings or count an unrelated template start.
export function draftForTemplate(preset, modelId) {
  if (!preset || typeof modelId !== 'string' || !modelId
    || modelIdForName(preset.model) !== modelId
    || !nonEmptyString(preset.prompt) || !nonEmptyString(preset.id)) return null;
  return {
    prompt: preset.prompt,
    aspect: nonEmptyString(preset.aspect) ? preset.aspect : null,
    durationSeconds: supportedDuration(preset.durationSeconds) ? preset.durationSeconds : 5,
    negativePrompt: nonEmptyString(preset.negativePrompt) ? preset.negativePrompt : '',
    templateId: preset.id,
  };
}

// A saved edit can override its own recipe, but never another template that
// happens to use the same model. Older drafts did not carry a template id.
export function resolveTemplateDraft(preset, modelId, storedDraft) {
  if (!preset) return storedDraft;
  const draft = draftForTemplate(preset, modelId);
  if (!draft) return null;
  if (!storedDraft || typeof storedDraft !== 'object'
    || (storedDraft.templateId !== undefined && storedDraft.templateId !== preset.id)) return draft;
  return {
    ...draft,
    ...(nonEmptyString(storedDraft.prompt) ? { prompt: storedDraft.prompt } : {}),
    ...(nonEmptyString(storedDraft.aspect) ? { aspect: storedDraft.aspect } : {}),
    ...(supportedDuration(storedDraft.durationSeconds) ? { durationSeconds: storedDraft.durationSeconds } : {}),
    ...(nonEmptyString(storedDraft.negativePrompt) ? { negativePrompt: storedDraft.negativePrompt } : {}),
  };
}
