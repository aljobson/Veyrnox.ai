import { NextResponse } from 'next/server';
import { getApiKeyFromCookies } from '@/lib/legacyCookieCutoff';

const MUAPI_BASE = 'https://api.muapi.ai';

function cleanHeaders(request) {
    const headers = new Headers(request.headers);
    // Strip anything that could leak client identity upstream.
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
    const targetUrl = `${MUAPI_BASE}/workflow/${path}${search}`;

    const headers = cleanHeaders(request);
    const apiKey = getApiKeyFromCookies(request);
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
        console.error(`[workflow proxy ${method}] upstream error`);
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
