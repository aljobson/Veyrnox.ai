// Guides and generated template ids are fixed lists, so an address outside them can be
// refused before rendering. Their pages call notFound(), but the marketing
// shell streams (app/veyrnox/loading.js), so by then the 200 status has been
// sent: the "not found" page went out as a soft 404. middleware.js uses this
// to answer a real 404 instead. /models/<id> needs the catalog, which the
// middleware cannot read, so it keeps the streamed not-found (noindex).
import { editorialSeries } from '../app/veyrnox/social-cinema/editorialSeries.js';
import { GUIDES } from '../app/veyrnox/_lib/guides.js';
import ids from './publicTemplateIds.json' with { type: 'json' };
import { publicTemplateId } from '../app/veyrnox/_lib/templateIds.js';
import { imageTemplatesEnabled } from '../app/veyrnox/_lib/imageTemplatesFlag.js';
const videos = new Set(ids.video), images = new Set(ids.image);

const LISTS = {
    'social-cinema/series': new Set(editorialSeries.map((series) => series.slug)),
    guides: new Set(GUIDES.map((g) => g.id)),
};

/** True for /guides/<id>, /presets/<id> or /social-cinema/series/<id> (either public or /veyrnox-prefixed) naming nothing we publish. */
export function isUnknownStaticPage(pathname) {
    const match = /^(?:\/veyrnox)?\/(guides|presets|social-cinema\/series)\/([^/]+)\/?$/.exec(String(pathname || ''));
    if (!match) return false;
    let id;
    try { id = decodeURIComponent(match[2]); } catch { return true; }
    // Resolve legacy aliases and the image publication flag on each request.
    if (match[1] === 'presets') {
        const wanted = publicTemplateId(id);
        return !(videos.has(wanted) || (imageTemplatesEnabled() && images.has(wanted)));
    }
    return !LISTS[match[1]].has(id);
}
