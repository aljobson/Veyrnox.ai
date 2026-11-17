export const BEAT_TIP_STEPS = Object.freeze(['grid', 'library', 'play', 'arrangement', 'export', 'shortcuts'].map(id => Object.freeze({
  id, selector: `[data-beat-tip="${id}"]`, key: `app.music.beat.tip.${id}`,
})));
export const beatTipsSeenKey = userId => userId ? `veyrnox_beat_tips_v1:${userId}` : null;
export function beatTipsSeen(storage, userId) {
  try { return !userId || storage?.getItem(beatTipsSeenKey(userId)) === '1'; } catch { return !userId; }
}
export function markBeatTipsSeen(storage, userId) {
  try { if (userId) storage?.setItem(beatTipsSeenKey(userId), '1'); } catch { /* Private browsing can refuse storage. */ }
}
function visible(element) {
  const box = element.getBoundingClientRect();
  return element.getClientRects().length > 0 && box.width > 0 && box.height > 0;
}
// Owned copy of the FeatureTour blocker set. FeatureTour itself always takes priority.
export function beatTipsBlocked(doc) {
  try {
    return [...doc.querySelectorAll('[data-feature-tour], dialog[open], [role="dialog"][aria-modal="true"], [data-vey-walkthrough]')]
      .some(element => element.hasAttribute('data-feature-tour') || element.matches('dialog[open], [data-vey-walkthrough]') || visible(element));
  } catch { return false; }
}
export function nextVisibleBeatTip(doc, index, viewport) {
  for (let i = index; i < BEAT_TIP_STEPS.length; i++) {
    for (const element of doc.querySelectorAll(BEAT_TIP_STEPS[i].selector)) {
      const box = element.getBoundingClientRect();
      if (visible(element) && box.bottom > 0 && box.right > 0 && box.top < viewport.height && box.left < viewport.width) return { index: i, element };
    }
  }
  return null;
}
// The component and tests drive the same lifecycle. update() is also called after DOM mutations.
export function createBeatTipSession({ doc, viewport, storage, userId, replay = false, show, focusPrimary }) {
  let index = 0, started = false, closed = !userId || (!replay && beatTipsSeen(storage, userId));
  let previous, active = null, paused = false;
  if (closed) show(null);
  function close() {
    if (closed || beatTipsBlocked(doc)) return;
    closed = true; markBeatTipsSeen(storage, userId); show(null);
    if (previous?.isConnected) previous.focus({ preventScroll: true });
  }
  function update() {
    if (closed) return;
    if (beatTipsBlocked(doc)) { if (!paused) show(null); paused = true; return; }
    const found = nextVisibleBeatTip(doc, index, viewport());
    if (!found) { close(); return; }
    if (!started) { previous = doc.activeElement; started = true; }
    const changed = paused || active !== found.element || index !== found.index;
    index = found.index; active = found.element; paused = false;
    show({ ...found, box: active.getBoundingClientRect() });
    if (changed && !beatTipsBlocked(doc)) focusPrimary();
  }
  return {
    update,
    next() { if (closed || beatTipsBlocked(doc)) return; index++; active = null; update(); },
    skip: close,
    escape(event) { if (!closed && started && event.key === 'Escape' && !beatTipsBlocked(doc)) { event.preventDefault(); event.stopPropagation(); close(); } },
    dispose() { if (!closed && started && !beatTipsBlocked(doc) && previous?.isConnected) previous.focus({ preventScroll: true }); closed = true; },
  };
}
