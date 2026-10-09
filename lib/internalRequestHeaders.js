// Request headers that are never a caller's to send. worker.js removes them
// from every request before the framework builds its event, which is the one
// place a removal holds: the middleware's own deletions are not applied
// (ADR-0078, amendments 3 and 4).
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
const startsWith = (...prefixes) => (name) => prefixes.some((prefix) => name.startsWith(prefix));

// What is removed, with the word a log line uses for it. Geolocation gets no line.
const KINDS = [
    ['revalidation', (name) => REVALIDATION.has(name)],
    // Who the caller is. Only middleware.js sets these, so a handler that sees
    // one knows the middleware ran; a request it never saw arrives with none.
    ['identity', startsWith('x-veyrnox-auth-')],
    // What the framework's routing half hands its rendering half. It takes the
    // first prefix off there, which would turn the rest into a request header.
    ['framework', startsWith('x-middleware-response-', 'x-opennext-')],
    // Geolocation the framework sets itself from request.cf, after this runs.
    [null, startsWith('x-open-next-', 'x-vercel-ip-')],
];

/**
 * The same request without those headers. A request that carries none is
 * returned as it is; otherwise only the headers differ.
 * @param {Request} request
 * @returns {Request}
 */
export function dropInternalHeaders(request) {
    const names = [...request.headers.keys()].filter((name) => KINDS.some(([, matches]) => matches(name)));
    if (names.length === 0) return request;
    // No caller outside the Worker has a reason to send these, so it is worth
    // a line. Only the kind is logged: a value can be a build secret or a user id.
    const kinds = KINDS.filter(([word, matches]) => word && names.some(matches)).map(([word]) => word);
    if (kinds.length > 0) console.error(`[internal-headers] dropped from an outside request: ${kinds.join(', ')}`);
    const headers = new Headers(request.headers);
    for (const name of names) headers.delete(name);
    return new Request(request, { headers });
}
