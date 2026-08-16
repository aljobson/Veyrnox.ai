import { NextResponse } from 'next/server';

const MUAPI_BASE = 'https://api.muapi.ai';
const COOKIE_NAME = '__Host-muapi_key';
const LEGACY_COOKIE_NAME = 'muapi_key';

function getApiKey(request) {
    // Priority 1: Direct x-api-key header
    const headerKey = request.headers.get('x-api-key');
    if (headerKey) return headerKey;

    // Priority 2: server-set cookie (prefer __Host- prefixed).
    return (
        request.cookies.get(COOKIE_NAME)?.value ||
        request.cookies.get(LEGACY_COOKIE_NAME)?.value
    );
}

function cleanHeaders(request) {
    const headers = new Headers(request.headers);
    // Strip anything that could leak client identity upstream.
    headers.delete('host');
    headers.delete('connection');
    headers.delete('cookie');
    headers.delete('authorization');
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
    const targetUrl = `${MUAPI_BASE}/workflow/${path}${search}`;

    const headers = cleanHeaders(request);
    const apiKey = getApiKey(request);
    if (apiKey) headers.set('x-api-key', apiKey);

    const init = { method, headers };
    if (method !== 'GET' && method !== 'DELETE' && method !== 'HEAD') {
        init.body = await request.arrayBuffer();
    }

    try {
        const response = await fetch(targetUrl, init);
        const data = await response.json();
        return NextResponse.json(data, { status: response.status });
    } catch (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
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
