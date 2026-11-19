// Longest source each paid song action accepts, in seconds. Mirrors the server constants in lib/musicBackend.js
// (kept separate so the browser bundle does not pull in server code; tests/musicActionLimits.test.mjs keeps them equal).
// The server stays the authority: it measures the stored file and refuses an over-length source before any quote.
export const MUSIC_ACTION_SOURCE_LIMITS = Object.freeze({
  cover: 120,
  extend: 120,
  add_section: 120,
  target_stem: 120,
  add_track: 120,
  replace_section: 60,
});

/** The limit an action exceeds for this source, or null when it fits or the length is unknown. */
export function musicActionOverLimit(action, sourceSeconds) {
  const limit = MUSIC_ACTION_SOURCE_LIMITS[action];
  if (!limit || !Number.isFinite(sourceSeconds) || sourceSeconds <= 0) return null;
  // Same strict comparison as the quote routes (`seconds > MAX`), so the menu and the server agree at the boundary.
  return sourceSeconds > limit ? limit : null;
}

/** Short, single-line reason shown beside a disabled action. */
export function musicActionLimitReason(limit) {
  return limit % 60 === 0 && limit >= 120 ? `up to ${limit / 60} min` : `up to ${limit} s`;
}
