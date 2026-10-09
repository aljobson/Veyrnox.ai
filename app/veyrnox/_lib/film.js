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
  renderedFrom: '37e3a2940363ef2a',
};

// One film, fetched only once it is half on screen. 720p of flat colour
// encodes well under this; the cap is here to catch a careless re-encode.
export const MAX_FILM_BYTES = 2 * 1024 * 1024;
