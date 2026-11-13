// Tracks which quote request is still wanted. Anything that changes what a
// quote was for (an edit, a mode switch, removing a template) calls
// invalidate(); a request that began earlier then finds its token stale and
// must not publish its result.
export function createQuoteGate() {
  let revision = 0;
  let lastStarted = 0;
  return {
    /** Revision to remember before slow preparation work such as saving a draft. */
    current: () => revision,
    /** Drop every quote request that has not finished. */
    invalidate: () => { revision += 1; },
    /** True while nothing has invalidated the revision a caller captured. */
    unchanged: (captured) => revision === captured,
    /** Begin a request; returns its token. */
    start: () => { revision += 1; lastStarted = revision; return revision; },
    isCurrent: (token) => revision === token,
    /** True for the most recent request, even if it was invalidated, so busy state still clears. */
    isLatestStart: (token) => lastStarted === token,
  };
}
