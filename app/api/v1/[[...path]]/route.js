import { NextResponse } from 'next/server';
import { getApiKeyFromCookies } from '@/lib/legacyCookieCutoff';

// Internal proxy for /api/v1/* -> https://api.muapi.ai/api/v1/*.
// Replaces the previous middleware-based NextResponse.rewrite() approach,
// whose semantics differ across Vercel Edge vs OpenNext-Cloudflare (external
// rewrites can 404 or leak internals). Sibling routes with custom logic
// (creative-agent, get_upload_url, upload-binary) live at more specific
// segments and take precedence over this catch-all.

const MUAPI_BASE = 'https://api.muapi.ai';

function cleanHeaders(request) {
    const headers = new Headers(request.headers);
    // Strip anything that could leak client identity to the upstream API.
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

async function proxy(request, method, pathSegments) {
    const path = pathSegments.join('/');
    const { search } = new URL(request.url);
    const targetUrl = `${MUAPI_BASE}/api/v1/${path}${search}`;

    const headers = cleanHeaders(request);
    const apiKey = getApiKeyFromCookies(request);
    if (apiKey) headers.set('x-api-key', apiKey);

    const init = { method, headers };
    if (method !== 'GET' && method !== 'DELETE' && method !== 'HEAD') {
        init.body = await request.arrayBuffer();
    }

    try {
        const response = await fetch(targetUrl, init);
        // Some upstream endpoints return non-JSON; forward the body verbatim.
        const contentType = response.headers.get('content-type') || '';
        if (contentType.includes('application/json')) {
            const data = await response.json();
            return NextResponse.json(data, { status: response.status });
        }
        const body = await response.arrayBuffer();
        return new Response(body, {
            status: response.status,
            headers: { 'content-type': contentType || 'application/octet-stream' },
        });
    } catch (error) {
        console.error(`[v1 proxy ${method}] upstream error`);
        return NextResponse.json({ error: 'Upstream request failed' }, { status: 502 });
    }
}

async function handle(request, ctx, method) {
    const { path = [] } = await ctx.params;
    return proxy(request, method, path);
}

export const GET = (req, ctx) => handle(req, ctx, 'GET');
export const POST = (req, ctx) => handle(req, ctx, 'POST');
export const PUT = (req, ctx) => handle(req, ctx, 'PUT');
export const PATCH = (req, ctx) => handle(req, ctx, 'PATCH');
export const DELETE = (req, ctx) => handle(req, ctx, 'DELETE');
