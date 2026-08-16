import { NextResponse } from 'next/server';

const MUAPI_BASE = 'https://api.muapi.ai';
const COOKIE_NAME = '__Host-muapi_key';
const LEGACY_COOKIE_NAME = 'muapi_key';

function getApiKey(request) {
    // Cookie only — see /api/v1 route for rationale.
    return (
        request.cookies.get(COOKIE_NAME)?.value ||
        request.cookies.get(LEGACY_COOKIE_NAME)?.value
    );
}

function cleanHeaders(request) {
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

// e.g. GET /api/agents?is_template=true  → https://api.muapi.ai/agents?is_template=true
// e.g. GET /api/agents/by-slug/foo       → https://api.muapi.ai/agents/by-slug/foo
function buildTargetUrl(pathSegments, search) {
    const path = pathSegments.join('/');
    const base = `${MUAPI_BASE}/agents`;
    return path ? `${base}/${path}${search}` : `${base}${search}`;
}

async function proxy(request, method, pathSegments) {
    const { search } = new URL(request.url);
    const targetUrl = buildTargetUrl(pathSegments, search);

    const headers = cleanHeaders(request);
    const apiKey = getApiKey(request);
    if (apiKey) headers.set('x-api-key', apiKey);

    const init = { method, headers };
    if (method !== 'GET' && method !== 'DELETE' && method !== 'HEAD') {
        init.body = await request.arrayBuffer();
    }

    try {
        const response = await fetch(targetUrl, init);
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
        console.error(`[agents proxy ${method}] upstream error`);
        return NextResponse.json({ error: 'Upstream request failed' }, { status: 502 });
    }
}

export async function GET(request, { params }) {
    const { path = [] } = await params;
    return proxy(request, 'GET', path);
}

export async function POST(request, { params }) {
    const { path = [] } = await params;
    return proxy(request, 'POST', path);
}

export async function PUT(request, { params }) {
    const { path = [] } = await params;
    return proxy(request, 'PUT', path);
}

export async function DELETE(request, { params }) {
    const { path = [] } = await params;
    return proxy(request, 'DELETE', path);
}
