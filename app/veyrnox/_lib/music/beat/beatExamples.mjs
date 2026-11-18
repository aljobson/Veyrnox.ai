// Example prompts shown as the placeholder of an empty beat-editor prompt field. They rotate so
// a person sees what kinds of parts they can ask for. Each is an instrumental part, because the
// beat editor only makes instrumental loops. The text lives in the i18n catalog.

export const EXAMPLE_PROMPT_KEYS = Object.freeze([
  'app.music.beat.ui.warm.rhodes.chords.laid.back',
  'app.music.beat.ui.dusty.boom.bap.drums.with.vinyl.crackle',
  'app.music.beat.ui.walking.upright.bass.line.warm.and.round',
  'app.music.beat.ui.airy.synth.pad.slow.and.wide',
]);

export const EXAMPLE_ROTATE_MS = 6000;

/** The next example, wrapping at the end. Anything that is not a valid index starts over at the first. */
export function nextExampleIndex(index, count = EXAMPLE_PROMPT_KEYS.length) {
  const size = Math.max(1, Math.trunc(count) || 1);
  return Number.isInteger(index) && index >= 0 ? (index + 1) % size : 0;
}
