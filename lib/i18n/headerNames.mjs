// Request headers the middleware sets for the public site's language
// (ADR-0106). Plain strings so the middleware and server helpers share them
// without the middleware importing next/headers.
export const LOCALE_HEADER = 'x-site-locale';
export const PATH_HEADER = 'x-site-path';
