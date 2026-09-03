// Shared MuAPI proxy helpers. The Next.js routes under /api/agents,
// /api/workflow, /api/v1, /api/app, /api/v1/creative-agent, and
// /api/v1/get_upload_url all forward to https://api.muapi.ai with the same
// header scrub + cookie-to-x-api-key rewrite. Keep the shared shape here.
import { NextResponse } from 'next/server';
import { parseJsonOr502 } from '@/lib/parseJsonOr502';
import { getApiKeyFromCookies } from '@/lib/authCookie';

export const MUAPI_BASE = 'https://api.muapi.ai';

// Strip anything that could leak client identity or inject auth upstream.
export function cleanHeaders(request) {
    const headers = new Headers(request.headers);
    headers.delete('host');
    headers.delete('connection');
    headers.delete('cookie');
    headers.delete('authorization');
    headers.delete('x-api-key');
    headers.delete('x-forwarded-for');
    headers.delete('x-forwarded-host');
    headers.delete('x-forwarded-proto');
    headers.delete('x-forwarded-port');
    headers.delete('x-real-ip');
    return headers;
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
    const targetUrl = `${MUAPI_BASE}${upstreamPath}${search}`;

    const headers = cleanHeaders(request);
    const apiKey = getApiKeyFromCookies(request);
    if (apiKey) headers.set('x-api-key', apiKey);

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
