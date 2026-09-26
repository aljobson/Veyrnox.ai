// Landing-page showcase clips, keyed by FEATURE_CARDS `key` or EFFECT_PRESETS
// `name`. The manifest is the only place a clip is named, so a tile with no
// entry keeps its gradient and makes no media request at all.
//
// Clips are generated on Veyrnox itself. Shot list and encode settings:
// docs/product/showcase-clips.md
//
// Add an entry only once the file is in public/showcase/ (tests/showcaseClips
// checks it). Served same-origin, which the CSP's `media-src 'self'` allows
// without an ADR; a Stream or R2 host would need one.
//
//   'wan-2.5-kie': { video: '/showcase/wan-2-5.mp4', poster: '/showcase/wan-2-5.jpg' },

export const SHOWCASE_CLIPS = {};

// A hover preview, not a film. Phones fetch a clip per tile as it scrolls into
// view, so 15 preset tiles at the cap is the worst case: 2 MB keeps that near
// 30 MB, and a 4 s 720p loop encodes well under it (aim for 1 MB).
export const MAX_CLIP_BYTES = 2 * 1024 * 1024;
