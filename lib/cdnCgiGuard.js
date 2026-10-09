// Cloudflare's network keeps /cdn-cgi/ for its own endpoints and answers them
// before a Worker runs. The app has nothing under the prefix, so a request for
// it that does arrive here is answered 404 instead of being handed to the
// framework: the answer is then the same whatever the edge passes on
// (ADR-0078 amendment 5).
import { normalizedPath } from './adminEdgeRateLimit.js';
import { notFound } from './nextDataGuard.js';

const CDN_CGI_PATH = /^\/cdn-cgi(?:\/|$)/i;

/**
 * Answer a request under the reserved prefix with 404 before the framework sees it.
 * The path is tested both as sent and as normalised, like the data-path guard.
 * Nothing is logged, so a scan of the prefix cannot fill the log.
 * @param {Request} request
 * @returns {Response | null}
 */
export function refuseCdnCgi(request) {
    const normalised = normalizedPath(request.url);
    // A path that cannot be normalised cannot be shown to be anything else.
    if (normalised === null) return notFound();
    if (!CDN_CGI_PATH.test(new URL(request.url).pathname) && !CDN_CGI_PATH.test(normalised)) return null;
    return notFound();
}
