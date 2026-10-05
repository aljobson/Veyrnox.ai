// What the chat screen says while a Deep research reply (ADR-0070) plans, searches and writes. The server sends
// `progress` events; this only turns one into a short line for the waiting reply, and says nothing for anything it
// does not recognise so a future step can never show a raw value.
const isCount = (n) => Number.isInteger(n) && n >= 0 && n <= 99;

/** @returns {string|null} e.g. "Searching the web: 2 of 4 done"; null when there is no known step. */
export function researchProgressLabel(progress) {
  if (!progress || typeof progress !== 'object') return null;
  if (progress.step === 'plan') return 'Planning the research';
  if (progress.step === 'search') {
    return isCount(progress.done) && isCount(progress.of) && progress.of > 0
      ? `Searching the web: ${progress.done} of ${progress.of} done`
      : 'Searching the web';
  }
  if (progress.step === 'write') return 'Writing the answer';
  return null;
}
