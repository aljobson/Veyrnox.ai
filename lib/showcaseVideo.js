// Template preview videos under /showcase/ are static assets. The Workers
// Assets binding ignores a Range header and always answers 200 with the whole
// file, and Apple's video player (the iOS app, and Safari on iPhone) refuses
// to play an MP4 from a server that cannot answer byte ranges. wrangler.jsonc
// sends /showcase/* to the Worker first, and this answers ranges itself.

const SHOWCASE_PATH = /^\/showcase\//;
const MP4_PATH = /\.mp4$/i;
const SINGLE_RANGE = /^bytes=(\d*)-(\d*)$/;

// _headers is not applied to a response built here, so its site-wide rules are repeated.
const SITE_HEADERS = Object.freeze({
    'X-Content-Type-Options': 'nosniff',
    'Strict-Transport-Security': 'max-age=63072000; includeSubDomains; preload',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
});

/**
 * Parse one `bytes=` range against a file size.
 * @param {string | null} header
 * @param {number} size
 * @returns {{ start: number, end: number } | 'none' | 'unsatisfiable'}
 */
export function parseRange(header, size) {
    if (!header) return 'none';
    const match = SINGLE_RANGE.exec(header.trim());
    // Several ranges, or another unit: answer with the whole file, which RFC 9110 allows.
    if (!match) return 'none';
    const [, from, to] = match;
    if (from === '' && to === '') return 'none';
    if (from === '') {
        const suffix = Number(to);
        if (suffix === 0 || size === 0) return 'unsatisfiable';
        return { start: Math.max(0, size - suffix), end: size - 1 };
    }
    const start = Number(from);
    if (start >= size) return 'unsatisfiable';
    const end = to === '' ? size - 1 : Math.min(Number(to), size - 1);
    if (end < start) return 'none';
    return { start, end };
}

/**
 * Serve a request under /showcase/. Returns null for any other path.
 * @param {Request} request
 * @param {{ ASSETS?: { fetch(request: Request): Promise<Response> } }} env
 * @returns {Promise<Response | null>}
 */
export async function serveShowcase(request, env) {
    const url = new URL(request.url);
    if (!SHOWCASE_PATH.test(url.pathname) || !env.ASSETS) return null;
    if (!MP4_PATH.test(url.pathname) || (request.method !== 'GET' && request.method !== 'HEAD')) {
        return env.ASSETS.fetch(request);
    }
    const asset = await env.ASSETS.fetch(new Request(url.toString(), { method: 'GET' }));
    if (!asset.ok) return asset;
    const body = await asset.arrayBuffer();
    const size = body.byteLength;
    const headers = new Headers(SITE_HEADERS);
    for (const name of ['Content-Type', 'Cache-Control', 'ETag', 'Last-Modified']) {
        const value = asset.headers.get(name);
        if (value) headers.set(name, value);
    }
    headers.set('Accept-Ranges', 'bytes');
    const ifRange = request.headers.get('If-Range');
    const etag = asset.headers.get('ETag');
    const range = ifRange && ifRange !== etag ? 'none' : parseRange(request.headers.get('Range'), size);
    const head = request.method === 'HEAD';
    if (range === 'unsatisfiable') {
        headers.set('Content-Range', `bytes */${size}`);
        return new Response(null, { status: 416, headers });
    }
    if (range === 'none') {
        headers.set('Content-Length', String(size));
        return new Response(head ? null : body, { status: 200, headers });
    }
    headers.set('Content-Range', `bytes ${range.start}-${range.end}/${size}`);
    headers.set('Content-Length', String(range.end - range.start + 1));
    return new Response(head ? null : body.slice(range.start, range.end + 1), { status: 206, headers });
}
