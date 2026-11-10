import { TTS_VOICES } from './textToSpeech.js';

const STORAGE_SLOT = 'veyrnox_voice_favourites_v1';
const KNOWN_VOICES = new Set(TTS_VOICES.map((voice) => voice.id));

/** Browser-local stock-voice shortlist. It contains provider voice ids only. */
export function readVoiceFavourites(storage) {
  try {
    const value = JSON.parse(storage.getItem(STORAGE_SLOT) || '[]');
    return Array.isArray(value)
      ? [...new Set(value.filter((id) => typeof id === 'string' && KNOWN_VOICES.has(id)))].slice(0, TTS_VOICES.length)
      : [];
  } catch {
    return [];
  }
}

export function toggleVoiceFavourite(storage, voiceId) {
  const current = readVoiceFavourites(storage);
  if (!KNOWN_VOICES.has(voiceId)) return current;
  const next = current.includes(voiceId)
    ? current.filter((id) => id !== voiceId)
    : [voiceId, ...current].slice(0, TTS_VOICES.length);
  try {
    storage.setItem(STORAGE_SLOT, JSON.stringify(next));
    return next;
  } catch {
    return current;
  }
}
