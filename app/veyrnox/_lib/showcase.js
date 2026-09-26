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

// A hover preview, not a film: 3 MB keeps 15 preset tiles cheap on mobile data.
export const MAX_CLIP_BYTES = 3 * 1024 * 1024;
