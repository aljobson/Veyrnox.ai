// Next data files (/_next/data/<build>/<page>.json) belong to the pages
// router. This app has none, so nothing legitimate asks for one, and the
// framework would otherwise map the prefix onto another path after the edge
// has already applied its path rules to the one that was asked for (ADR-0078).
import { REFUSAL_HEADERS, normalizedPath } from './adminEdgeRateLimit.js';

const DATA_PATH = /^\/_next\/data(?:\/|$)/i;
const NAMES_API = /\/api(?:\/|$)/i;

/**
 * Answer a data-file request with 404 before the framework sees it.
 * The path is tested both as sent and as normalised, so neither spelling gets through.
 * @param {Request} request
 * @returns {Response | null}
 */
export function refuseNextData(request) {
    const sent = new URL(request.url).pathname;
    const normalised = normalizedPath(request.url);
    if (!DATA_PATH.test(sent) && !DATA_PATH.test(normalised)) return null;
    // One that names an API route is no stray crawler. Only those are logged,
    // so a scan of /_next/ cannot flood the log, and no part of the path is.
    if (NAMES_API.test(sent) || NAMES_API.test(normalised)) console.error('[next-data] refused a data path naming an API route');
    return new Response(JSON.stringify({ error: 'not_found' }), { status: 404, headers: REFUSAL_HEADERS });
}
