import { TTS_LANGUAGES } from './textToSpeech.js';

const KEY = 'veyrnox.dubbing-draft.v1';
export const DUBBING_SPEECH_SOURCES = ['script', 'upload', 'record'];
export const MAX_DUBBING_DRAFT_SCRIPT = 360;

export function normalizeDubbingDraft(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const targetLanguage = TTS_LANGUAGES.includes(value.targetLanguage) && value.targetLanguage !== 'auto'
    ? value.targetLanguage
    : null;
  const speechSource = DUBBING_SPEECH_SOURCES.includes(value.speechSource) ? value.speechSource : null;
  if (!targetLanguage || !speechSource) return null;
  const script = typeof value.script === 'string'
    ? value.script.trim().slice(0, MAX_DUBBING_DRAFT_SCRIPT)
    : '';
  if (speechSource === 'script' && !script) return null;
  return { targetLanguage, speechSource, script: speechSource === 'script' ? script : '' };
}

export function writeDubbingDraft(storage, value) {
  const draft = normalizeDubbingDraft(value);
  if (!storage || !draft) return false;
  try {
    storage.setItem(KEY, JSON.stringify(draft));
    return true;
  } catch {
    return false;
  }
}

export function readDubbingDraft(storage) {
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
    return normalizeDubbingDraft(JSON.parse(raw));
  } catch {
    return null;
  }
}
