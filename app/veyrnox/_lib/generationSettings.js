// Pure helpers for _components/GenerationSettings.js (unit-tested).

export const SEED_MAX = 2147483647;

/** Inputs to send for these settings: only what the model takes and the user set. */
export function settingsInputs(model, { seed, negative }) {
  const out = {};
  if (model?.takesSeed && /^\d+$/.test(seed) && Number(seed) <= SEED_MAX) out.seed = Number(seed);
  if (model?.takesNegative && negative.trim()) out.negative_prompt = negative.trim();
  return out;
}

/** True when a typed seed would be dropped, so the form can say so. */
export function seedIsInvalid(seed) {
  return seed !== '' && !(/^\d+$/.test(seed) && Number(seed) <= SEED_MAX);
}
