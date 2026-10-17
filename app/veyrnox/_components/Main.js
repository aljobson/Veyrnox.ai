// The one <main> on a page. It starts after the page's <header>, so "Skip to
// content" (app/layout.js) passes the nav, and it ends before any <footer>,
// so both stay top-level landmarks. tabIndex -1 lets the skip link and the
// back-to-top button land focus here without making the region a Tab stop.
// tests/uiLandmarksAndTheme.test.mjs holds every page to exactly one.
export function Main({ className, style, children, inert, 'aria-busy': ariaBusy }) {
  return <main id="main" tabIndex={-1} className={className} style={style} inert={inert} aria-busy={ariaBusy}>{children}</main>;
}
