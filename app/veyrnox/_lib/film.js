// The landing film: fifteen seconds of the product's own screens, drawn in
// code (scripts/landing-film) and captured frame by frame. It is motion
// design, not model output, so it never sits in a tile that advertises a
// model (those take SHOWCASE_CLIPS, see _lib/showcase.js).
//
// Served same-origin, which the CSP's `media-src 'self'` allows without an
// ADR. tests/landingFilm.test.mjs checks the files and the size cap.

export const LANDING_FILM = {
  video: '/film/price-on-the-button.mp4',
  poster: '/film/price-on-the-button.jpg',
  width: 1280,
  height: 720,
  // The hash of scripts/landing-film the MP4 was rendered from (render.mjs
  // prints it). The test fails when the source has moved on without a render.
  renderedFrom: 'c8913418893af8bb',
};

// Owner-approved two-hit robot video with the Veyrnox.ai logo and creative
// question composited into the frames. Provenance: docs/product/showcase-clips.md.
export const BREAKTHROUGH_FILM = {
  video: '/film/robot-creative-v5.mp4',
  poster: '/film/robot-creative-v5.jpg',
  width: 1280,
  height: 720,
  // A separate portrait composition preserves both hands on narrow screens.
  mobile: {
    video: '/film/robot-creative-portrait-v3.mp4',
    poster: '/film/robot-creative-portrait-v3.jpg',
    width: 720,
    height: 1440,
  },
};

// The brand intro: the Veyrnox.ai logo over Earth, shown above the hero
// headline, with the original aqua V. Phones get the portrait version.
export const BRAND_FILM = {
  video: '/film/brand-intro.mp4',
  poster: '/film/brand-intro.jpg',
  width: 896,
  height: 512,
  mobile: {
    video: '/film/brand-intro-portrait.mp4',
    poster: '/film/brand-intro-portrait.jpg',
    width: 512,
    height: 396,
  },
};

// Each film is fetched only once half on screen. The cap catches a careless
// re-encode before it reaches the landing page.
export const MAX_FILM_BYTES = 2 * 1024 * 1024;
