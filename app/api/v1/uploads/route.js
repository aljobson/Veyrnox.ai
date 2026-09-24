/**
 * POST /api/v1/uploads — mint a presigned PUT so the browser can send a
 * source file straight to R2 for a Transform generation.
 *
 * Not the retired /api/v1/get_upload_url (ADR-0007), which proxied to
 * api.muapi.ai and was removed on 2026-09-24 (owner-approved early sunset).
 *
 * Path:
 *   1. middleware.js verified the JWT and set x-veyrnox-auth-id
 *   2. Judge the claim: media type on the allowlist, size under its cap
 *   3. Confirm the caller is provisioned and holds credits
 *   4. Derive uploads/{auth_id}/{uuid}.{ext} — server values only
 *   5. Return a 15-minute presigned PUT pinned to that exact Content-Type
 *
 * The bytes never pass through the Worker. What the client uploads is
 * verified against its magic number later, before the file is ever handed
 * to a provider — see lib/uploadSource.js and the generations route.
 */

import { NextResponse } from 'next/server';
import { rpc, envConfig } from '../../../../packages/db/supabase-client.js';
import { presignPutUrl, listObjects, isConfigured as r2IsConfigured, envConfig as r2EnvConfig } from '../../../../packages/adapters/r2.js';
import { checkDeclared, uploadKeyFor, UPLOAD_URL_TTL_SECONDS, UPLOAD_PREFIX } from '../../../../lib/uploadSource.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// How many un-swept sources one account may be holding. Sources are consumed
// within seconds of upload and swept after 24h, so a caller with more than a
// handful pending is not using the product.
//
// This is a snapshot of stored objects, not a reservation for outstanding PUT
// URLs. Concurrent issuance and later uploads can exceed it. The request quota
// separately bounds signing and listing work; neither enforces a byte budget.
const MAX_PENDING_UPLOADS = 10;

export async function POST(req) {
    const authId = req.headers.get('x-veyrnox-auth-id');
    if (!authId || !UUID_RE.test(authId)) return NextResponse.json({ error: 'not_authenticated' }, { status: 401 });

    const cfg = envConfig();
    const r2cfg = r2EnvConfig();
    if (!cfg.supabaseUrl || !cfg.serviceRoleKey || !r2IsConfigured(r2cfg)) {
        return NextResponse.json({ error: 'not_configured' }, { status: 503 });
    }

    let body;
    try { body = await req.json(); } catch { return NextResponse.json({ error: 'invalid_json' }, { status: 400 }); }
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
        return NextResponse.json({ error: 'body_must_be_object' }, { status: 400 });
    }

    // Gate 1: judge what the client claims, before signing anything.
    const declared = checkDeclared(body.content_type, body.size_bytes);
    if (!declared.ok) return NextResponse.json({ error: declared.error }, { status: 400 });

    // Enable only after migration 0116. Every valid request consumes a slot,
    // including requests later denied for balance or storage state.
    if (process.env.UPLOAD_REQUEST_RATE_LIMIT_ENABLED === 'true') {
        let rate;
        try {
            rate = await rpc('consume_upload_request', { p_auth_id: authId }, cfg);
        } catch {
            console.error('[uploads] rate limit unavailable');
        }
        const headers = { 'Cache-Control': 'no-store' };
        if (rate?.ok === false && rate.code === 'RATE_LIMITED') {
            const retry = Number.isInteger(rate.retry_after_seconds)
                ? Math.max(1, Math.min(60, rate.retry_after_seconds)) : 60;
            return NextResponse.json({ error: 'rate_limited', retry_after_seconds: retry },
                { status: 429, headers: { ...headers, 'Retry-After': String(retry) } });
        }
        if (rate?.ok === false && rate.code === 'NOT_FOUND') {
            return NextResponse.json({ error: 'user_not_provisioned' }, { status: 409, headers });
        }
        if (rate?.ok !== true) {
            return NextResponse.json({ error: 'rate_limit_unavailable' },
                { status: 503, headers: { ...headers, 'Retry-After': '30' } });
        }
    }

    // Storing a source for someone who cannot spend it is pure cost. This
    // also confirms the user row exists — an unprovisioned caller has no
    // balance row, so there is nothing to prefix a key with.
    let balance;
    try {
        balance = await rpc('read_user_balance', { p_auth_id: authId }, cfg);
    } catch (err) {
        // Fail closed. A degraded balance read must not become an open
        // upload endpoint.
        console.error('[uploads] balance read failed:', err);
        return NextResponse.json({ error: 'balance_unavailable' }, { status: 503 });
    }
    if (typeof balance !== 'number') {
        return NextResponse.json({ error: 'user_not_provisioned' }, { status: 409 });
    }
    if (balance <= 0) {
        return NextResponse.json({ error: 'insufficient_credits' }, { status: 402 });
    }

    // Refuse issuance when the stored-object snapshot is already at the cap.
    const held = await listObjects(`${UPLOAD_PREFIX}/${authId.toLowerCase()}/`, r2cfg, { maxKeys: MAX_PENDING_UPLOADS + 1 });
    if (!held.ok) {
        // Fail closed: an unreadable bucket must not become an open endpoint.
        console.error('[uploads] could not count pending uploads:', held.error);
        return NextResponse.json({ error: 'upload_check_unavailable' }, { status: 503 });
    }
    if (held.objects.length >= MAX_PENDING_UPLOADS) {
        return NextResponse.json({ error: 'too_many_pending_uploads' }, { status: 429 });
    }

    // Gate: the key is built from the verified auth id and a fresh UUID. No
    // filename, no path, nothing the client sent.
    const derived = uploadKeyFor(authId, declared.contentType, crypto.randomUUID());
    if (!derived.ok) {
        console.error('[uploads] key derivation refused:', derived.error);
        return NextResponse.json({ error: derived.error }, { status: 400 });
    }

    let signed;
    try {
        signed = await presignPutUrl(derived.key, declared.contentType, UPLOAD_URL_TTL_SECONDS, r2cfg);
    } catch (err) {
        console.error('[uploads] presign failed:', err);
        return NextResponse.json({ error: 'internal' }, { status: 502 });
    }

    // The body carries a presigned URL that is valid for anyone holding it,
    // so no cache may keep it after delivery — same rule as the asset route.
    return NextResponse.json({
        key: derived.key,
        upload_url: signed.url,
        // The client must send exactly this, or R2 rejects the PUT: the
        // Content-Type is inside the signature.
        content_type: signed.contentType,
        max_bytes: declared.maxBytes,
        expires_in: signed.expires,
    }, { headers: { 'Cache-Control': 'no-store' } });
}
