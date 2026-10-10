// Guides and templates are fixed lists, so an address outside them can be
// refused before rendering. Their pages call notFound(), but the marketing
// shell streams (app/veyrnox/loading.js), so by then the 200 status has been
// sent: the "not found" page went out as a soft 404. middleware.js uses this
// to answer a real 404 instead. /models/<id> needs the catalog, which the
// middleware cannot read, so it keeps the streamed not-found (noindex).
import { GUIDES } from '../app/veyrnox/_lib/guides.js';
import { ALL_TEMPLATES } from '../app/veyrnox/_lib/templates.js';

const LISTS = {
    guides: new Set(GUIDES.map((g) => g.id)),
    presets: new Set(ALL_TEMPLATES.map((p) => p.id)),
};

/** True for /guides/<id> or /presets/<id> (either public or /veyrnox-prefixed) naming nothing we publish. */
export function isUnknownStaticPage(pathname) {
    const match = /^(?:\/veyrnox)?\/(guides|presets)\/([^/]+)\/?$/.exec(String(pathname || ''));
    if (!match) return false;
    let id;
    try { id = decodeURIComponent(match[2]); } catch { return true; }
    return !LISTS[match[1]].has(id);
}
