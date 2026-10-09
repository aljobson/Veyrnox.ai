// Request headers the framework's routing layer reads as its own instructions.
// It honours them from any caller, so worker.js removes them from every
// request before the framework builds its event (ADR-0078, amendment 3).
//
// x-isr and x-prerender-revalidate are what an OpenNext revalidation queue
// sends. None is configured (open-next.config.ts), so nothing legitimate sends
// them today. A queue would deliver its requests to this Worker's own `fetch`
// through a WORKER_SELF_REFERENCE service binding, carrying exactly these
// headers, and they would be removed here like anyone else's: revalidation
// would then never succeed. Whoever configures a queue has to revisit this
// first, and give those requests their own entrypoint rather than trust the
// headers again.
const REVALIDATION = new Set(['x-isr', 'x-prerender-revalidate', 'x-prerender-revalidate-if-generated']);
// Geolocation the framework sets itself from request.cf, after this runs.
const GEO_PREFIXES = ['x-open-next-', 'x-vercel-ip-'];
const internal = (name) => REVALIDATION.has(name) || GEO_PREFIXES.some((prefix) => name.startsWith(prefix));

/**
 * The same request without the framework's internal headers. A request that
 * carries none is returned as it is; otherwise only the headers differ.
 * @param {Request} request
 * @returns {Request}
 */
export function dropInternalHeaders(request) {
    const names = [...request.headers.keys()].filter(internal);
    if (names.length === 0) return request;
    // No caller outside the Worker has a reason to send these, so it is worth
    // a line. The value is never logged: a right one is a build secret.
    if (names.some((name) => REVALIDATION.has(name))) console.error('[internal-headers] dropped a revalidation header sent from outside');
    const headers = new Headers(request.headers);
    for (const name of names) headers.delete(name);
    return new Request(request, { headers });
}
