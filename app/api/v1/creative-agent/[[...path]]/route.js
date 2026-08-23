import { NextResponse } from 'next/server';
import { getApiKeyFromCookies } from '@/lib/legacyCookieCutoff';

const MUAPI_BASE = 'https://api.muapi.ai';

function cleanHeaders(request) {
    const headers = new Headers(request.headers);
    headers.delete('host');
    headers.delete('connection');
    headers.delete('cookie');
    headers.delete('Authorization');
    headers.delete('x-api-key');
    headers.delete('x-forwarded-for');
    headers.delete('x-forwarded-host');
    headers.delete('x-forwarded-proto');
    headers.delete('x-forwarded-port');
    headers.delete('x-real-ip');
    return headers;
}

async function proxy(request, method, path) {
    const { search, pathname } = new URL(request.url);
    const targetUrl = `${MUAPI_BASE}/api/v1/creative-agent/${path}${search}`;
    const headers = cleanHeaders(request);
    const apiKey = getApiKeyFromCookies(request);
    if (apiKey) headers.set('x-api-key', apiKey);

    const init = { method, headers };
    if (method !== 'GET' && method !== 'DELETE') {
        init.body = await request.arrayBuffer();
    }

    try {
        const response = await fetch(targetUrl, init);
        console.log(`[creative-agent proxy ${method}] ${pathname} ${response.status}`);
        const data = await response.json();
        return NextResponse.json(data, { status: response.status });
    } catch (error) {
        console.error(`[creative-agent proxy ${method} ERROR] ${pathname}:`, error.message);
        return NextResponse.json({ error: 'Upstream request failed' }, { status: 502 });
    }
}

export async function GET(request, { params }) {
    const slug = await params;
    return proxy(request, 'GET', (slug.path || []).join('/'));
}

export async function POST(request, { params }) {
    const slug = await params;
    return proxy(request, 'POST', (slug.path || []).join('/'));
}

export async function PATCH(request, { params }) {
    const slug = await params;
    return proxy(request, 'PATCH', (slug.path || []).join('/'));
}

export async function DELETE(request, { params }) {
    const slug = await params;
    return proxy(request, 'DELETE', (slug.path || []).join('/'));
}
