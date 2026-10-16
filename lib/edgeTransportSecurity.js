const CANONICAL_HOST = 'veyrnox.ai';

/** Redirect insecure or www requests before application code runs. */
export function canonicalHttpsRedirect(request) {
    const url = new URL(request.url);
    const isCanonicalHost = url.hostname.toLowerCase() === CANONICAL_HOST;
    const isWww = url.hostname.toLowerCase() === `www.${CANONICAL_HOST}`;
    if ((!isCanonicalHost || url.protocol === 'https:') && !isWww) return null;
    url.protocol = 'https:';
    url.hostname = CANONICAL_HOST;
    url.port = '';
    return Response.redirect(url, 308);
}

/** Remove framework fingerprints without cloning every normal response. */
export function stripTechnologyHeaders(response) {
    if (!response.headers.has('x-powered-by') && !response.headers.has('x-opennext')) return response;
    const headers = new Headers(response.headers);
    headers.delete('x-powered-by');
    headers.delete('x-opennext');
    return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
    });
}
