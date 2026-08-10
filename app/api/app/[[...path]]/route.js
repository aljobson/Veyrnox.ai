import { NextResponse } from 'next/server';

const MUAPI_BASE = 'https://api.muapi.ai';

function getApiKey(request) {
    // Priority 1: Direct x-api-key header
    const headerKey = request.headers.get('x-api-key');
    if (headerKey) return headerKey;

    // Priority 2: muapi_key cookie (used by the fixed builder library)
    const cookieKey = request.cookies.get('muapi_key')?.value;
    return cookieKey;
}

function cleanHeaders(request) {
    const headers = new Headers(request.headers);
    headers.delete('host');
    headers.delete('connection');
    headers.delete('cookie'); // CRITICAL: Stop forwarding browser cookies to MuAPI to avoid auth conflicts
    return headers;
}

async function parseJsonOr502(response, pathname) {
    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
        console.error(`[api/app] upstream non-JSON ${response.status} for ${pathname}`);
        return { data: { error: 'Bad upstream response' }, status: 502 };
    }
    try {
        return { data: await response.json(), status: response.status };
    } catch (err) {
        console.error(`[api/app] JSON parse error for ${pathname}:`, err.message);
        return { data: { error: 'Bad upstream response' }, status: 502 };
    }
}

export async function GET(request, { params }) {
    const slug = await params;
    const pathSegments = slug.path || [];
    const path = pathSegments.join('/');

    // Handle alias: get_upload_file -> get_file_upload_url
    const effectivePath = path === 'get_upload_file' ? 'get_file_upload_url' : path;

    const { search, pathname } = new URL(request.url);
    const targetUrl = `${MUAPI_BASE}/app/${effectivePath}${search}`;

    const headers = cleanHeaders(request);
    const apiKey = getApiKey(request);
    if (apiKey) headers.set('x-api-key', apiKey);

    try {
        const response = await fetch(targetUrl, { headers, method: 'GET' });
        const { data, status } = await parseJsonOr502(response, pathname);

        // SPECIAL CASE: Intercept upload URL and redirect to local binary proxy
        if (status < 300 && effectivePath === 'get_file_upload_url' && data && data.url) {
            const originalS3Url = data.url;
            data.url = `/api/upload-binary`;
            data.fields = {
                ...data.fields,
                'x-proxy-target-url': originalS3Url,
            };
        }

        return NextResponse.json(data, { status });
    } catch (error) {
        console.error(`[api/app GET] ${pathname}:`, error.message);
        return NextResponse.json({ error: 'Upstream request failed' }, { status: 500 });
    }
}

export async function POST(request, { params }) {
    const slug = await params;
    const pathSegments = slug.path || [];
    const path = pathSegments.join('/');

    const { search, pathname } = new URL(request.url);
    const targetUrl = `${MUAPI_BASE}/app/${path}${search}`;

    const headers = cleanHeaders(request);
    const apiKey = getApiKey(request);
    if (apiKey) headers.set('x-api-key', apiKey);

    try {
        const body = await request.arrayBuffer();
        const response = await fetch(targetUrl, { method: 'POST', headers, body });
        const { data, status } = await parseJsonOr502(response, pathname);
        return NextResponse.json(data, { status });
    } catch (error) {
        console.error(`[api/app POST] ${pathname}:`, error.message);
        return NextResponse.json({ error: 'Upstream request failed' }, { status: 500 });
    }
}

export async function DELETE(request, { params }) {
    const slug = await params;
    const pathSegments = slug.path || [];
    const path = pathSegments.join('/');

    const { search, pathname } = new URL(request.url);
    const targetUrl = `${MUAPI_BASE}/app/${path}${search}`;

    const headers = cleanHeaders(request);
    const apiKey = getApiKey(request);
    if (apiKey) headers.set('x-api-key', apiKey);

    try {
        const response = await fetch(targetUrl, { method: 'DELETE', headers });
        const { data, status } = await parseJsonOr502(response, pathname);
        return NextResponse.json(data, { status });
    } catch (error) {
        console.error(`[api/app DELETE] ${pathname}:`, error.message);
        return NextResponse.json({ error: 'Upstream request failed' }, { status: 500 });
    }
}

export async function PUT(request, { params }) {
    const slug = await params;
    const pathSegments = slug.path || [];
    const path = pathSegments.join('/');

    const { search, pathname } = new URL(request.url);
    const targetUrl = `${MUAPI_BASE}/app/${path}${search}`;

    const headers = cleanHeaders(request);
    const apiKey = getApiKey(request);
    if (apiKey) headers.set('x-api-key', apiKey);

    try {
        const body = await request.arrayBuffer();
        const response = await fetch(targetUrl, { method: 'PUT', headers, body });
        const { data, status } = await parseJsonOr502(response, pathname);
        return NextResponse.json(data, { status });
    } catch (error) {
        console.error(`[api/app PUT] ${pathname}:`, error.message);
        return NextResponse.json({ error: 'Upstream request failed' }, { status: 500 });
    }
}
