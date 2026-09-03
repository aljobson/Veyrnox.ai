import { NextResponse } from 'next/server';
import { validateUploadProxyTarget } from '../../../lib/uploadProxyTarget';
import { getApiKeyFromCookies } from '@/lib/authCookie';

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10 MB

// Fail closed on requests that were not initiated from this same site so a
// leaked cookie / extension with host permissions cannot invoke the
// upload-proxy with a victim's cookie. Old browsers without Sec-Fetch-Site
// hit the closed branch — acceptable for a settings-style endpoint.
function requireSameOrigin(request) {
    return request.headers.get('sec-fetch-site') === 'same-origin';
}

// Buffer the body while enforcing a hard byte cap. Content-Length is
// optional/spoofable (chunked or omitted), so we must count bytes as they
// arrive rather than trusting the header, and must not call
// request.formData() before the cap check — that would buffer the full
// body first and defeat the cap (memory DoS).
async function readBodyWithCap(request, maxBytes) {
    const reader = request.body?.getReader();
    if (!reader) return { ok: true, bytes: new Uint8Array(0) };
    const chunks = [];
    let total = 0;
    for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > maxBytes) {
            try { await reader.cancel(); } catch {}
            return { ok: false };
        }
        chunks.push(value);
    }
    const buf = new Uint8Array(total);
    let offset = 0;
    for (const c of chunks) { buf.set(c, offset); offset += c.byteLength; }
    return { ok: true, bytes: buf };
}

export async function POST(request) {
    if (!requireSameOrigin(request)) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    if (!getApiKeyFromCookies(request)) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    // Fast reject on an honestly-declared oversized body; the streaming
    // counter below is the source of truth for spoofed/omitted CL.
    const declaredLength = Number(request.headers.get('content-length') || 0);
    if (declaredLength > MAX_UPLOAD_BYTES) {
        return NextResponse.json({ error: 'Payload too large' }, { status: 413 });
    }
    const capped = await readBodyWithCap(request, MAX_UPLOAD_BYTES);
    if (!capped.ok) {
        return NextResponse.json({ error: 'Payload too large' }, { status: 413 });
    }
    try {
        const contentType = request.headers.get('content-type') || '';
        // Re-parse the capped body as multipart FormData via a synthetic
        // Request so we still get the same form-field API downstream.
        const formData = await new Request('http://local/upload', {
            method: 'POST',
            headers: { 'content-type': contentType },
            body: capped.bytes,
        }).formData();

        // Extract the original S3 target URL we injected earlier
        const targetUrl = formData.get('x-proxy-target-url');

        if (!targetUrl) {
            return NextResponse.json({ error: 'Missing proxy target URL' }, { status: 400 });
        }

        const validatedTarget = validateUploadProxyTarget(targetUrl);
        if (!validatedTarget.ok) {
            return NextResponse.json(
                { error: 'Invalid upload target', reason: validatedTarget.reason },
                { status: 400 }
            );
        }

        // Reconstruct the FormData for S3 (excluding our internal proxy marker)
        const s3FormData = new FormData();
        
        // S3 is very sensitive to field ordering. We must ensure 'file' is likely last
        // or at least that all signature fields come before what S3 expects.
        // The original library code appends 'file' last, so iterating should preserve that.
        for (const [key, value] of formData.entries()) {
            if (key !== 'x-proxy-target-url') {
                s3FormData.append(key, value);
            }
        }

        // Perform the server-to-server POST to S3
        // This bypasses browser CORS/Preflight security entirely
        const s3Response = await fetch(validatedTarget.url, {
            method: 'POST',
            body: s3FormData,
        });

        if (s3Response.ok || s3Response.status === 204) {
            return new Response(null, { status: 204 });
        }
        // Log the raw S3 error server-side; never echo it back to the client
        // (it can leak signed URL fields, bucket/host, and request-id headers).
        const errorText = await s3Response.text();
        console.error(`S3 Proxy Error (status ${s3Response.status}):`, errorText);
        return NextResponse.json({ error: 'Upload failed' }, { status: s3Response.status });
    } catch (error) {
        console.error('Upload Proxy Exception:', error);
        return NextResponse.json({ error: 'Upload failed' }, { status: 500 });
    }
}
