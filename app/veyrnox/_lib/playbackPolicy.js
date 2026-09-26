// When a landing tile may play its showcase clip. Pure, so it is unit-tested;
// MediaTile only feeds it what the browser reports.
//
//   'off'    : never play; the poster (or gradient) stays put
//   'hover'  : mouse. Play on hover or keyboard focus, while on screen
//   'inview' : touch. Play while on screen, one clip at a time, capped at
//              TOUCH_MAX_PLAY_MS
//
// The touch cap is the WCAG 2.2.2 (Pause, Stop, Hide) answer: auto-started
// motion that stops within 5 seconds does not need a pause control.

export const TOUCH_MAX_PLAY_MS = 5000;

// Chrome's effectiveType buckets. 3g is ~700 kbps, too slow to pull a clip
// per tile while someone scrolls.
const SLOW_CONNECTION = /^(slow-2g|2g|3g)$/;

export function playbackMode({ reducedMotion, saveData, effectiveType, canHover }) {
  if (reducedMotion || saveData) return 'off';
  if (canHover) return 'hover';
  if (SLOW_CONNECTION.test(effectiveType || '')) return 'off';
  return 'inview';
}
