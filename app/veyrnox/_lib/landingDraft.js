// The landing hero's prompt, handed to app/create through sessionStorage so
// it never travels in a URL. Read once and cleared, so a reload of the studio
// does not keep restoring it. It carries the model it was priced for and is
// applied only when the studio opens on that model, so a later visit from the
// nav does not pick it up.
export const LANDING_DRAFT_KEY = 'veyrnox_landing_draft';

// A draft older than this came from an earlier visit, not the click that
// opened the studio.
const MAX_AGE_MS = 10 * 60 * 1000;

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
    return { prompt: draft.prompt, aspect: typeof draft.aspect === 'string' ? draft.aspect : null };
  } catch {
    return null;
  }
}

export function takeLandingDraft(storage, modelId, now = Date.now()) {
  const draft = takeStudioDraft(storage, modelId, now);
  return draft ? draft.prompt : null;
}

/** Hand a prompt (and optional aspect) to the studio. False if storage is blocked. */
export function writeStudioDraft(storage, { prompt, model, aspect = null }, now = Date.now()) {
  try {
    storage.setItem(LANDING_DRAFT_KEY, JSON.stringify({ prompt, model, aspect, at: now }));
    return true;
  } catch {
    return false;
  }
}
