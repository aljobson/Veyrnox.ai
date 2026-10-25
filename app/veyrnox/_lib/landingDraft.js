import { generationSlotKind, generationMimeTypes } from '../../../lib/generationSourceSlots.mjs';
import { isUploadKey } from '../../../lib/uploadSource.js';

// The landing hero's prompt, handed to app/create through sessionStorage so
// it never travels in a URL. Read once and cleared, so a reload of the studio
// does not keep restoring it. It carries the model it was priced for and is
// applied only when the studio opens on that model, so a later visit from the
// nav does not pick it up.
export const LANDING_DRAFT_KEY = 'veyrnox_landing_draft';

// A draft older than this came from an earlier visit, not the click that
// opened the studio.
const MAX_AGE_MS = 10 * 60 * 1000;

function safeDraftSources(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const entries = Object.entries(value);
  if (!entries.length || entries.length > 4) return null;
  const safe = {};
  for (const [slot, source] of entries) {
    const kind = generationSlotKind(slot);
    if (!kind || !source || typeof source !== 'object' || !isUploadKey(source.sourceKey)) return null;
    if (!generationMimeTypes(kind).includes(source.mimeType)) return null;
    safe[slot] = {
      sourceKey: source.sourceKey,
      mimeType: source.mimeType,
      label: typeof source.label === 'string' ? source.label.slice(0, 160) : '',
    };
  }
  return safe;
}

// Prompt, plus the aspect ratio a template was designed for, when present.
// `aspect` is only a request: the studio drops one its model does not take.
export function takeStudioDraft(storage, modelId, now = Date.now()) {
  try {
    const raw = storage.getItem(LANDING_DRAFT_KEY);
    if (!raw) return null;
    storage.removeItem(LANDING_DRAFT_KEY);
    const draft = JSON.parse(raw);
    if (!draft || typeof draft.prompt !== 'string' || !draft.prompt) return null;
    if (!Number.isFinite(draft.at) || now - draft.at > MAX_AGE_MS) return null;
    if (!modelId || draft.model !== modelId) return null;
    const sources = safeDraftSources(draft.sources);
    return {
      prompt: draft.prompt,
      aspect: typeof draft.aspect === 'string' ? draft.aspect : null,
      ...(Number.isInteger(draft.durationSeconds) && draft.durationSeconds >= 1 && draft.durationSeconds <= 60 ? { durationSeconds: draft.durationSeconds } : {}),
      ...(typeof draft.negativePrompt === 'string' ? { negativePrompt: draft.negativePrompt } : {}),
      ...(typeof draft.templateId === 'string' ? { templateId: draft.templateId } : {}),
      ...(draft.followup === 'generated-sound' ? { followup: draft.followup } : {}),
      ...(draft.oddlingPicks && typeof draft.oddlingPicks === 'object'
        ? { oddlingPicks: draft.oddlingPicks }
        : {}),
      ...(sources ? { sources, consent: draft.consent === true } : {}),
    };
  } catch {
    return null;
  }
}

export function takeLandingDraft(storage, modelId, now = Date.now()) {
  const draft = takeStudioDraft(storage, modelId, now);
  return draft ? draft.prompt : null;
}

/** Hand a prompt (and optional aspect) to the studio. False if storage is blocked. */
export function writeStudioDraft(storage, { prompt, model, aspect = null, durationSeconds, negativePrompt, templateId, oddlingPicks, followup, sources, consent }, now = Date.now()) {
  try {
    const safeSources = safeDraftSources(sources);
    storage.setItem(LANDING_DRAFT_KEY, JSON.stringify({
      prompt, model, aspect, durationSeconds, negativePrompt, templateId, at: now,
      ...(oddlingPicks && typeof oddlingPicks === 'object' ? { oddlingPicks } : {}),
      ...(followup === 'generated-sound' ? { followup } : {}),
      ...(safeSources ? { sources: safeSources, consent: consent === true } : {}),
    }));
    return true;
  } catch {
    return false;
  }
}
