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
  renderedFrom: '7f476632c8ca2503',
};

// Owner-supplied promo (veyrnox_promo_one_app_v2): one 49 s portrait film used
// on phones and the web alike. It is shown whole, never cropped; on a wide
// screen it sits centred in the frame. Silent 720 x 1280 H.264 re-encode of the
// owner's 1080 x 1920 export, under MAX_FILM_BYTES.
export const BREAKTHROUGH_FILM = {
  video: '/film/veyrnox-promo.mp4',
  poster: '/film/veyrnox-promo.jpg',
  width: 720,
  height: 1280,
};

// The brand intro: the Veyrnox.ai logo over Earth, shown above the hero
// headline, with the original aqua V. Both files are 10.3 s re-encodes of the
// owner's 2160 x 3840 export: the wide one is the 16:9 picture cut out of it,
// the phone one is a sharp square cut from its middle (no blurred bands).
export const BRAND_FILM = {
  video: '/film/brand-intro.mp4',
  poster: '/film/brand-intro.jpg',
  width: 1920,
  height: 1080,
  mobile: {
    video: '/film/brand-intro-portrait.mp4',
    poster: '/film/brand-intro-portrait.jpg',
    width: 1080,
    height: 1080,
  },
};

// Each film is fetched only once half on screen. The cap catches a careless
// re-encode before it reaches the landing page.
export const MAX_FILM_BYTES = 2 * 1024 * 1024;
