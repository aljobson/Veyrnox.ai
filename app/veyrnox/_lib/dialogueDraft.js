import { validateDialogueTurns, validatePhotoDialogueTurns } from './dialogueStudio.js';

const KEY = 'veyrnox.dialogue-draft.v1';

export function normalizeDialogueDraft(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !Array.isArray(value.turns)) return null;
  const turns = value.turns.map((turn) => ({
    speaker: typeof turn?.speaker === 'string' ? turn.speaker.trim() : '',
    text: typeof turn?.text === 'string' ? turn.text.trim() : '',
  }));
  const mode = value.mode === 'photo-dialogue' ? 'photo-dialogue' : 'audio-script';
  const validation = mode === 'photo-dialogue' ? validatePhotoDialogueTurns(turns) : validateDialogueTurns(turns);
  return validation.ok ? { mode, turns } : null;
}

export function writeDialogueDraft(storage, value) {
  const draft = normalizeDialogueDraft(value);
  if (!storage || !draft) return false;
  try {
    storage.setItem(KEY, JSON.stringify(draft));
    return true;
  } catch {
    return false;
  }
}

export function readDialogueDraft(storage) {
  if (!storage) return null;
  let raw = null;
  try {
    raw = storage.getItem(KEY);
    storage.removeItem(KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    return normalizeDialogueDraft(JSON.parse(raw));
  } catch {
    return null;
  }
}
