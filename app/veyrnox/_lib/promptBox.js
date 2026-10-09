// Pure helpers for the create page's prompt box (unit-tested).

// A shot to try, shown until the user types. For pictures and clips only.
export const STARTER_PROMPT = 'A neon-lit Tokyo alley at 3am, low anamorphic tracking shot';

// Models that use the box as it stands: speech reads it aloud, music and
// sound effects make audio about it, an Auto Short is written about it.
// Every such capability record requires its prompt or topic.
const usesOwnWords = (model) => !!model?.isSpeech || model?.kind === 'audio' || !!model?.takesTopic;

/**
 * The text in the box. `typed` is null until the user types or a draft is
 * restored; from then on it is theirs and is never replaced. Until then an
 * audio model or an Auto Short gets an empty box: speech would read the
 * starter aloud, music and sound effects would make audio about a shot, a
 * short would be written about one, and all of them charge for it.
 */
export function promptText(typed, model) {
  if (typeof typed === 'string') return typed;
  return usesOwnWords(model) ? '' : STARTER_PROMPT;
}

/**
 * True when an audio model or an Auto Short has nothing in the box, so
 * Generate can wait for it. The gateway refuses that request
 * (`inputs_invalid:prompt`, `inputs_invalid:topic`); picture and clip
 * models are left to it, as before.
 */
export function promptIsMissing(model, prompt) {
  return usesOwnWords(model) && !String(prompt || '').trim();
}

export function promptPlaceholder(model) {
  if (model?.takesTopic) return 'A topic for a 32-second short, e.g. 3 facts about octopuses';
  if (model?.id === 'elevenlabs-dialogue') return 'One line per speaker, e.g.\nAna: Did you hear that?\nBen: [whispers] Stay quiet.';
  if (model?.isSpeech) return 'Type the words to say…';
  return model?.kind === 'audio' ? 'Describe the sound or music…' : 'Describe the shot…';
}
