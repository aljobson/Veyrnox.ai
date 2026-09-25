// ADR-0049: a client-side route change cannot replace the document's CSP.
// Site navigation uses root-relative URLs; include the redirected app alias.
export function needsNonceDocument(href) {
  return typeof href === 'string' && /^\/(?:veyrnox\/)?(?:app|auth)(?:[/?#]|$)/.test(href);
}
