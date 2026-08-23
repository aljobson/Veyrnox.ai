import { NextResponse } from 'next/server';
import { parseJsonOr502 } from '@/lib/parseJsonOr502';
import { getApiKeyFromCookies } from '@/lib/legacyCookieCutoff';

const MUAPI_BASE = 'https://api.muapi.ai';

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

export async function GET(request) {
    const { search, pathname } = new URL(request.url);
    const targetUrl = `${MUAPI_BASE}/app/get_file_upload_url${search}`;

    const headers = cleanHeaders(request);
    const apiKey = getApiKeyFromCookies(request);
    if (apiKey) headers.set('x-api-key', apiKey);

    try {
        const response = await fetch(targetUrl, {
            headers,
            method: 'GET',
        });

        const { data, status } = await parseJsonOr502(response, pathname);
        return NextResponse.json(data, { status });
    } catch (error) {
        // Log detail server-side; never echo raw error text back to the client
        // (it can leak upstream host/path/headers on network/DNS errors).
        console.error('[api/v1/get_upload_url] proxy error:', error?.message || error);
        return NextResponse.json({ error: 'Upstream request failed' }, { status: 500 });
    }
}
