// Pure helpers for _components/GenerationSettings.js and VoiceDescription.js (unit-tested).

export const SEED_MAX = 2147483647;
// The gateway and the capability record refuse a longer voice description.
export const VOICE_MAX = 500;

/** Inputs to send for these settings: only what the model takes and the user set. */
export function settingsInputs(model, { seed, negative, voice = '' }) {
  const out = {};
  if (model?.takesSeed && /^\d+$/.test(seed) && Number(seed) <= SEED_MAX) out.seed = Number(seed);
  if (model?.takesNegative && negative.trim()) out.negative_prompt = negative.trim();
  if (model?.takesVoice && voice.trim()) out.voice_description = voice.trim();
  return out;
}

/** True when the model needs a described voice and none is typed, so Generate can wait for it. */
export function voiceIsMissing(model, voice) {
  return !!model?.takesVoice && !String(voice || '').trim();
}

/** True when a typed seed would be dropped, so the form can say so. */
export function seedIsInvalid(seed) {
  return seed !== '' && !(/^\d+$/.test(seed) && Number(seed) <= SEED_MAX);
}
