// Where and when Vey moves on its own: a hop while the page scrolls and a landing in the gutter beside the section being
// read. Pure, so the rules are testable; the hooks hold the listeners and the timers. None of it grants or changes anything: it is motion only.
import { VEY_SIZE } from './veyPointer.js';

// How far the page must scroll before Vey hops, and the pause between hops, so a long scroll is a few hops, not a buzz.
export const HOP_SCROLL_PX = 360;
export const HOP_COOLDOWN_MS = 1800;
// A section is "being read" while it crosses this fraction of the viewport height.
export const READING_LINE = 0.5;
// Landing beside a section needs a gutter this wide on that side; without one Vey stays put, so it never covers text.
export const PERCH_MIN_VIEWPORT = 1100;
export const PERCH_GAP = 12;
export const PERCH_EDGE = 8;
const PERCH_BAND = 0.58;
const TOP_LIMIT = 72;

export const HOP_MS = 720;
export const CHEER_MS = 900;

/**
 * Scrolling is turned into hops. `state` is {y, travelled, lastHopAt}; the result carries the next state and whether
 * Vey hops now. Direction does not matter, only how far the page moved since the last hop.
 */
export function nextScrollState(state, y, now) {
  const travelled = state.travelled + Math.abs(y - state.y);
  const rested = now - state.lastHopAt >= HOP_COOLDOWN_MS;
  if (travelled >= HOP_SCROLL_PX && rested) return { state: { y, travelled: 0, lastHopAt: now }, hop: true };
  return { state: { y, travelled, lastHopAt: state.lastHopAt }, hop: false };
}

/** The id of the section crossing the reading line, or null between sections. `items` are {id, top, bottom}. */
export function readingSection(items, viewportHeight) {
  const line = viewportHeight * READING_LINE;
  return items.find((item) => item.top <= line && item.bottom > line)?.id ?? null;
}

/**
 * The spot beside a section: in the page gutter on the chosen side ('start' or 'end', mirrored for right-to-left),
 * level with the reading band, facing the content. Null when the viewport is small or the gutter cannot hold Vey.
 */
export function perchPlacement({ rect, viewport, side = 'start', rtl = false, size = VEY_SIZE }) {
  if (!rect || viewport.width < PERCH_MIN_VIEWPORT) return null;
  const left = (side === 'start') !== rtl;
  const room = left ? rect.left : viewport.width - rect.right;
  if (room < size.width + PERCH_GAP + PERCH_EDGE) return null;
  const x = left ? rect.left - size.width - PERCH_GAP : rect.right + PERCH_GAP;
  const y = Math.round(Math.min(viewport.height - size.height - PERCH_EDGE, Math.max(TOP_LIMIT, viewport.height * PERCH_BAND - size.height / 2)));
  return { position: { x: Math.round(x), y }, facing: left ? 1 : -1 };
}

/** Landings alternate sides, so Vey crosses the page as the reader moves down it. */
export const perchSide = (landing) => (landing % 2 === 0 ? 'start' : 'end');
