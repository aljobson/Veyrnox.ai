// Copy for the studio's job states (app/create).

// State glyphs — colour-blind safety net matches the design system §08.
export const STATE_UI = {
  queued:    { glyph: '●', tone: 'accent',  label: 'QUEUED' },
  running:   { glyph: '●', tone: 'accent',  label: 'RUNNING' },
  succeeded: { glyph: '✓', tone: 'accent',  label: 'DONE' },
  failed:    { glyph: '✕', tone: 'danger',  label: 'FAILED · REFUNDED' },
};
// How many consecutive poll failures before we stop and tell the user. At
// 2s an interval that is ~1 minute of silence, which is long enough to ride
// out a blip and short enough that nobody watches a dead shimmer.
// Models measured well over a minute end to end in live tests (2026-09-13).
// ponytail: hand-kept list; move to the catalog if more slow models land.
export const SLOW_MODEL_WAIT = {
  'ace-step-1.5': 'Music takes about 3–4 minutes.',
  'mmaudio-v2': 'Sound effects take about 3 minutes.',
  'seedance-2.0-fast': 'Video takes about 2 minutes.',
  'auto-short-32s': 'About 2–10 minutes: script, voiceover, four scenes, then the stitch.',
};
