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

const REDUCED_MOTION = '(prefers-reduced-motion: reduce)';

/**
 * Rotate the example index while a prompt field is empty. `onIndex` takes a number or an updater
 * (a React state setter). With reduced motion on, the first example is shown and nothing rotates,
 * including when the preference changes while the field is open. Returns the cleanup function.
 * Without a window (server render, tests) it does nothing.
 */
export function startExampleRotation({ win, onIndex }) {
  if (!win) return () => {};
  const query = win.matchMedia?.(REDUCED_MOTION);
  let timer = null;
  const stop = () => { if (timer !== null) { win.clearInterval(timer); timer = null; } };
  const sync = () => {
    stop();
    if (query?.matches) { onIndex(0); return; }
    timer = win.setInterval(() => onIndex((index) => nextExampleIndex(index)), EXAMPLE_ROTATE_MS);
  };
  sync();
  query?.addEventListener?.('change', sync);
  return () => { stop(); query?.removeEventListener?.('change', sync); };
}

/** The next example, wrapping at the end. Anything that is not a valid index starts over at the first. */
export function nextExampleIndex(index, count = EXAMPLE_PROMPT_KEYS.length) {
  const size = Math.max(1, Math.trunc(count) || 1);
  return Number.isInteger(index) && index >= 0 ? (index + 1) % size : 0;
}
