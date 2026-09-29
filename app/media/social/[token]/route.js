/**
 * GET /media/social/:token — public, unauthenticated by design. This is
 * the server-mediated transfer TikTok's PULL_FROM_URL fetch hits directly
 * (ADR-0061 Phase 5) — see lib/social/mediaProxyToken.js for why a raw R2
 * presigned URL can't be used here (TikTok requires DNS-verifying the
 * host, and that host has to be ours, not Cloudflare's).
 *
 * `token` is a short-lived HMAC-signed token (SOCIAL_MEDIA_PROXY_SECRET,
 * a dedicated secret — never SOCIAL_TOKEN_ENCRYPTION_KEY or
 * SOCIAL_OAUTH_STATE_SECRET) binding this fetch to exactly one R2 object
 * key. Nothing about the caller is trusted beyond that token: no auth
 * header exists on this path, and the response streams straight from R2
 * with no caching (Cache-Control: no-store) since the token itself is the
 * only thing standing between "anyone on the internet" and this object.
 */

import { NextResponse } from 'next/server';
import { verifyMediaProxyToken } from '../../../../lib/social/mediaProxyToken.js';
import { getObject, envConfig as r2EnvConfig, isConfigured as r2IsConfigured } from '../../../../packages/adapters/r2.js';

export async function GET(req, { params }) {
    const { token } = await params;
    const secret = process.env.SOCIAL_MEDIA_PROXY_SECRET;
    const r2cfg = r2EnvConfig();
    if (!secret || !r2IsConfigured(r2cfg)) {
        return NextResponse.json({ error: 'not_configured' }, { status: 503 });
    }

    const r2Key = await verifyMediaProxyToken(token, secret);
    if (!r2Key) {
        return NextResponse.json({ error: 'invalid_or_expired_token' }, { status: 404 });
    }

    const result = await getObject(r2Key, r2cfg);
    if (!result.ok) {
        console.error('[media/social] R2 fetch failed:', result.error);
        return NextResponse.json({ error: 'not_found' }, { status: 404 });
    }

    const headers = new Headers();
    const contentType = result.response.headers.get('content-type');
    const contentLength = result.response.headers.get('content-length');
    if (contentType) headers.set('content-type', contentType);
    if (contentLength) headers.set('content-length', contentLength);
    headers.set('cache-control', 'no-store');
    return new NextResponse(result.response.body, { status: 200, headers });
}
