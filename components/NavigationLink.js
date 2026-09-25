import { createElement } from 'react';
import NextLink from 'next/link';
import { needsNonceDocument } from '../lib/nonceNavigation.mjs';

// A real anchor fetches fresh HTML/CSP even before React hydrates, when opening
// a new tab, and after returning from a static public page. App links trade
// client-side navigation for a fresh document policy (ADR-0049).
export default function NavigationLink({ href, children, ...props }) {
  return createElement(needsNonceDocument(href) ? 'a' : NextLink, { href, ...props }, children);
}
