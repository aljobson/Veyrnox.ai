import { NextResponse } from 'next/server';
import { parseJsonOr502 as sharedParseJsonOr502 } from '@/lib/parseJsonOr502';

const MUAPI_BASE = 'https://api.muapi.ai';
const COOKIE_NAME = '__Host-muapi_key';
const LEGACY_COOKIE_NAME = 'muapi_key';

function getApiKey(request) {
    // Cookie only. A client-supplied x-api-key header would let anyone use
    // this proxy as a MuAPI amplifier with an attacker-supplied key.
    return (
        request.cookies.get(COOKIE_NAME)?.value ||
        request.cookies.get(LEGACY_COOKIE_NAME)?.value
    );
}

function cleanHeaders(request) {
    const headers = new Headers(request.headers);
    // Strip anything that could leak client identity or inject auth upstream.
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

const parseJsonOr502 = (response, pathname) => sharedParseJsonOr502(response, pathname);

// GET can return binary (thumbnails, exported files). Forward the body
// verbatim when upstream signals a non-JSON content-type.
async function forwardResponse(response) {
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
        return NextResponse.json(await response.json(), { status: response.status });
    }
    const body = await response.arrayBuffer();
    return new Response(body, {
        status: response.status,
        headers: { 'content-type': contentType || 'application/octet-stream' },
    });
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

        // SPECIAL CASE: get_file_upload_url returns JSON we must rewrite.
        if (effectivePath === 'get_file_upload_url') {
            const { data, status } = await parseJsonOr502(response, pathname);
            if (status < 300 && data && data.url) {
                const originalS3Url = data.url;
                data.url = `/api/upload-binary`;
                data.fields = {
                    ...data.fields,
                    'x-proxy-target-url': originalS3Url,
                };
            }
            return NextResponse.json(data, { status });
        }

        // Generic: forward JSON or binary body verbatim.
        return await forwardResponse(response);
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
