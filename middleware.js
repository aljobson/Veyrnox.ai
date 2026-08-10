import { NextResponse } from 'next/server';

export function middleware(request) {
    const url = request.nextUrl;

    // Exclude paths that have their own dedicated route handlers with custom logic
    const isHandledByRoute = url.pathname.startsWith('/api/v1/creative-agent') ||
                            url.pathname.startsWith('/api/v1/get_upload_url') ||
                            url.pathname.startsWith('/api/v1/upload-binary');

    if (url.pathname.startsWith('/api/v1') && !isHandledByRoute) {
        const targetUrl = new URL(url.pathname + url.search, 'https://api.muapi.ai');
        // Strip browser cookies before forwarding to the upstream API to avoid
        // leaking session identity and to match the route-handler proxies.
        const requestHeaders = new Headers(request.headers);
        requestHeaders.delete('cookie');
        return NextResponse.rewrite(targetUrl, {
            request: { headers: requestHeaders },
        });
    }

    return NextResponse.next();
}

// Match the paths we want to proxy
export const config = {
    matcher: [
        '/api/workflow/:path*',
        '/api/app/:path*',
        '/api/v1/:path*'
    ],
};
