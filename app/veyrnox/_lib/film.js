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
// in the hero on every screen, beside the headline. It is shown whole, never
// cropped and never covered by text or controls. Silent 720 x 1280 H.264 re-encode of the
// owner's 1080 x 1920 export, under MAX_FILM_BYTES.
export const BREAKTHROUGH_FILM = {
  video: '/film/veyrnox-promo.mp4',
  poster: '/film/veyrnox-promo.jpg',
  width: 720,
  height: 1280,
};

// Each film is fetched only once half on screen. The cap catches a careless
// re-encode before it reaches the landing page.
export const MAX_FILM_BYTES = 2 * 1024 * 1024;
