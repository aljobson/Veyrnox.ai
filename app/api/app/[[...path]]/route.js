import { NextResponse } from 'next/server';
import { parseJsonOr502 } from '@/lib/parseJsonOr502';
import { cleanHeaders, MUAPI_BASE, proxyToMuapi } from '@/lib/muapiProxy';
import { getApiKeyFromCookies } from '@/lib/authCookie';

// GET can return binary (thumbnails, exported files). Everything except the
// `get_file_upload_url` alias flows through the shared proxy with binary
// forwarding enabled.
const OPTS = { forwardBinary: true };

function upstreamPath(pathSegments) {
    return `/app/${pathSegments.join('/')}`;
}

export async function GET(request, { params }) {
    const slug = await params;
    const pathSegments = slug.path || [];
    const path = pathSegments.join('/');

    // Alias: get_upload_file -> get_file_upload_url
    const effectivePath = path === 'get_upload_file' ? 'get_file_upload_url' : path;

    // SPECIAL CASE: get_file_upload_url returns JSON we must rewrite so the
    // browser POSTs to our /api/upload-binary proxy instead of S3 directly.
    if (effectivePath === 'get_file_upload_url') {
        const { search, pathname } = new URL(request.url);
        const targetUrl = `${MUAPI_BASE}/app/${effectivePath}${search}`;
        const headers = cleanHeaders(request);
        const apiKey = getApiKeyFromCookies(request);
        if (apiKey) headers.set('x-api-key', apiKey);
        try {
            const response = await fetch(targetUrl, { headers, method: 'GET' });
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
        } catch (error) {
            console.error(`[api/app GET] ${pathname}:`, error.message);
            return NextResponse.json({ error: 'Upstream request failed' }, { status: 500 });
        }
    }

    return proxyToMuapi(request, `/app/${effectivePath}`, 'GET', OPTS);
}

export async function POST(request, { params }) {
    const slug = await params;
    return proxyToMuapi(request, upstreamPath(slug.path || []), 'POST');
}

export async function DELETE(request, { params }) {
    const slug = await params;
    return proxyToMuapi(request, upstreamPath(slug.path || []), 'DELETE');
}

export async function PUT(request, { params }) {
    const slug = await params;
    return proxyToMuapi(request, upstreamPath(slug.path || []), 'PUT');
}
