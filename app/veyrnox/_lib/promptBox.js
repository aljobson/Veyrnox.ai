// Pure helpers for the create page's prompt box (unit-tested).

// A shot to try, shown until the user types. For pictures and clips only.
export const STARTER_PROMPT = 'A neon-lit Tokyo alley at 3am, low anamorphic tracking shot';

// Speech reads the box aloud; music and sound effects make audio about it.
// Every audio and speech capability record requires its prompt.
const isAudio = (model) => !!model?.isSpeech || model?.kind === 'audio';

/**
 * The text in the box. `typed` is null until the user types or a draft is
 * restored; from then on it is theirs and is never replaced. Until then an
 * audio model gets an empty box: speech would read the starter aloud, music
 * and sound effects would make audio about a shot, and both charge for it.
 */
export function promptText(typed, model) {
  if (typeof typed === 'string') return typed;
  return isAudio(model) ? '' : STARTER_PROMPT;
}

/**
 * True when an audio model has nothing in the box, so Generate can wait for
 * it. The gateway refuses that request (`inputs_invalid:prompt`); picture
 * and clip models are left to it, as before.
 */
export function promptIsMissing(model, prompt) {
  return isAudio(model) && !String(prompt || '').trim();
}

export function promptPlaceholder(model) {
  if (model?.takesTopic) return 'A topic for a 32-second short, e.g. 3 facts about octopuses';
  if (model?.id === 'elevenlabs-dialogue') return 'One line per speaker, e.g.\nAna: Did you hear that?\nBen: [whispers] Stay quiet.';
  if (model?.isSpeech) return 'Type the words to say…';
  return model?.kind === 'audio' ? 'Describe the sound or music…' : 'Describe the shot…';
}
