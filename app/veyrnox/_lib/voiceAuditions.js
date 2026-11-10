import { TTS_VOICES } from './textToSpeech.js';

export const MIN_AUDITION_VOICES = 2;
export const MAX_AUDITION_VOICES = 3;

const KNOWN_VOICES = new Set(TTS_VOICES.map((voice) => voice.id));

export function normalizeAuditionVoices(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  return value.flatMap((voiceId) => {
    if (!KNOWN_VOICES.has(voiceId) || seen.has(voiceId)) return [];
    seen.add(voiceId);
    return [voiceId];
  }).slice(0, MAX_AUDITION_VOICES);
}

export function toggleAuditionVoice(value, voiceId) {
  const current = normalizeAuditionVoices(value);
  if (!KNOWN_VOICES.has(voiceId)) return current;
  if (current.includes(voiceId)) return current.filter((id) => id !== voiceId);
  return current.length < MAX_AUDITION_VOICES ? [...current, voiceId] : current;
}

export function auditionCost(unitCredits, voices) {
  const unit = Number(unitCredits);
  return Number.isFinite(unit) && unit >= 0 ? unit * normalizeAuditionVoices(voices).length : 0;
}

export function auditionBatchNote(started, voices, uncertain = false) {
  const count = normalizeAuditionVoices(voices).length;
  if (count < MIN_AUDITION_VOICES) return '';
  const next = started + 1;
  return uncertain
    ? `${started} of ${count} auditions started; voice ${next} may have too — check Library.`
    : `${started} of ${count} auditions started; voice ${next} did not.`;
}
