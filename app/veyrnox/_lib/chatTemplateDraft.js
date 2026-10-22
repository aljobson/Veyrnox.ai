const KEY = 'veyrnox_chat_template_draft_v1';
const MAX_PROMPT = 2000;
const MAX_AGE_MS = 10 * 60 * 1000;

function clean(value, max) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

/** Carry an edited public-template prompt into LLM Chat without exposing it in the URL. */
export function writeTemplateChatDraft(storage, preset, prompt, now = Date.now()) {
  if (!storage) return false;
  const draft = {
    templateId: clean(preset?.id, 100),
    prompt: clean(prompt, MAX_PROMPT),
    at: now,
  };
  if (!draft.templateId || !draft.prompt) return false;
  try {
    storage.setItem(KEY, JSON.stringify(draft));
    return true;
  } catch {
    return false;
  }
}

/** Read the handoff once so later visits from the nav do not restore an old template prompt. */
export function takeTemplateChatDraft(storage, now = Date.now()) {
  if (!storage) return null;
  let raw;
  try {
    raw = storage.getItem(KEY);
    storage.removeItem(KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const draft = JSON.parse(raw);
    const templateId = clean(draft?.templateId, 100);
    const prompt = clean(draft?.prompt, MAX_PROMPT);
    if (!templateId || !prompt || !Number.isFinite(draft?.at) || now - draft.at > MAX_AGE_MS || draft.at > now) return null;
    return { templateId, prompt };
  } catch {
    return null;
  }
}
