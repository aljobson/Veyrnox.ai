// Pure helpers for the create page's prompt box (unit-tested).

// A shot to try, shown until the user types. For pictures and clips only.
export const STARTER_PROMPT = 'A neon-lit Tokyo alley at 3am, low anamorphic tracking shot';

/**
 * The text in the box. `typed` is null until the user types or a draft is
 * restored; from then on it is theirs and is never replaced. Until then a
 * speech model gets an empty box: it would read the starter aloud and charge
 * for it.
 */
export function promptText(typed, model) {
  if (typeof typed === 'string') return typed;
  return model?.isSpeech ? '' : STARTER_PROMPT;
}

/**
 * True when a speech model has no words to say, so Generate can wait for
 * them. The gateway refuses that request (`inputs_invalid:prompt`); other
 * models are left to it, as before.
 */
export function promptIsMissing(model, prompt) {
  return !!model?.isSpeech && !String(prompt || '').trim();
}

export function promptPlaceholder(model) {
  if (model?.takesTopic) return 'A topic for a 32-second short, e.g. 3 facts about octopuses';
  if (model?.id === 'elevenlabs-dialogue') return 'One line per speaker, e.g.\nAna: Did you hear that?\nBen: [whispers] Stay quiet.';
  return model?.isSpeech ? 'Type the words to say…' : 'Describe the shot…';
}
