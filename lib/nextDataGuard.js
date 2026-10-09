// Next data files (/_next/data/<build>/<page>.json) belong to the pages
// router. This app has none, so nothing legitimate asks for one, and the
// framework would otherwise map the prefix onto another path after the edge
// has already applied its path rules to the one that was asked for (ADR-0078).
import { REFUSAL_HEADERS, normalizedPath } from './adminEdgeRateLimit.js';

const DATA_PATH = /^\/_next\/data(?:\/|$)/i;

/**
 * Answer a data-file request with 404 before the framework sees it.
 * The path is tested both as sent and as normalised, so neither spelling gets through.
 * @param {Request} request
 * @returns {Response | null}
 */
export function refuseNextData(request) {
    if (!DATA_PATH.test(new URL(request.url).pathname) && !DATA_PATH.test(normalizedPath(request.url))) return null;
    return new Response(JSON.stringify({ error: 'not_found' }), { status: 404, headers: REFUSAL_HEADERS });
}
