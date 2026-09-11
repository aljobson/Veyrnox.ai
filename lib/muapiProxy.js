// Shared MuAPI proxy helpers. The Next.js routes under /api/agents,
// /api/workflow, /api/v1, /api/app, /api/v1/creative-agent, and
// /api/v1/get_upload_url all forward to https://api.muapi.ai with the same
// header scrub + cookie-to-x-api-key rewrite. Keep the shared shape here.
import { NextResponse } from 'next/server';
import { parseJsonOr502 } from '@/lib/parseJsonOr502';
import { getApiKeyFromCookies } from '@/lib/authCookie';

export const MUAPI_BASE = 'https://api.muapi.ai';

// Only these request headers are forwarded upstream. An allowlist, not a
// blocklist: cf-connecting-ip, true-client-ip, cf-ipcountry, x-veyrnox-*
// and anything else the client sends never reaches MuAPI.
const FORWARDED_HEADERS = ['content-type', 'accept', 'accept-encoding', 'content-length'];

export function cleanHeaders(request) {
    const headers = new Headers();
    for (const name of FORWARDED_HEADERS) {
        const v = request.headers.get(name);
        if (v) headers.set(name, v);
    }
    return headers;
}

// Path segments come from Next's decoded catch-all params. Refuse dot
// segments and separators so `/api/app/%2e%2e/x` cannot leave the prefix,
// then re-encode each segment for the upstream URL.
export function safeUpstreamPath(prefix, segments) {
    const parts = [];
    for (const seg of segments || []) {
        if (typeof seg !== 'string' || seg === '' || seg === '.' || seg === '..' || /[\\/?#]/.test(seg)) {
            return null;
        }
        parts.push(encodeURIComponent(seg));
    }
    return parts.length ? `${prefix}/${parts.join('/')}` : prefix;
}

// JSON responses go through parseJsonOr502 so a truncated body becomes a
// clean 502 instead of throwing. Non-JSON (binary thumbnails, exported
// files) is forwarded verbatim.
async function forwardResponse(response, context) {
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
        const { data, status } = await parseJsonOr502(response, context);
        return NextResponse.json(data, { status });
    }
    const body = await response.arrayBuffer();
    return new Response(body, {
        status: response.status,
        headers: { 'content-type': contentType || 'application/octet-stream' },
    });
}

// Generic proxy. `upstreamPath` is the absolute path on MuAPI, e.g.
// `/agents/by-slug/foo` or `/workflow/bar`. Options:
//   forwardBinary — pass the upstream body through unchanged if non-JSON
//                   (default: false, i.e. all responses go through
//                   parseJsonOr502 so a truncated body becomes a 502).
export async function proxyToMuapi(request, upstreamPath, method, options = {}) {
    const { forwardBinary = false } = options;
    const { search, pathname } = new URL(request.url);
    if (upstreamPath === null) {
        return NextResponse.json({ error: 'invalid_path' }, { status: 400 });
    }
    const targetUrl = `${MUAPI_BASE}${upstreamPath}${search}`;

    // No session cookie, no relay. This is a same-origin proxy for a
    // signed-in studio user, not an anonymous forwarder to MuAPI.
    const apiKey = getApiKeyFromCookies(request);
    if (!apiKey) {
        return NextResponse.json({ error: 'not_authenticated' }, { status: 401 });
    }
    const headers = cleanHeaders(request);
    headers.set('x-api-key', apiKey);

    const init = { method, headers };
    if (method !== 'GET' && method !== 'DELETE' && method !== 'HEAD') {
        init.body = await request.arrayBuffer();
    }

    try {
        const response = await fetch(targetUrl, init);
        if (forwardBinary) return await forwardResponse(response, pathname);
        const { data, status } = await parseJsonOr502(response, pathname);
        return NextResponse.json(data, { status });
    } catch (error) {
        console.error(`[muapi proxy ${method}] ${pathname}: ${error?.message || error}`);
        return NextResponse.json({ error: 'Upstream request failed' }, { status: 502 });
    }
}
