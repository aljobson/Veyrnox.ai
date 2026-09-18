/**
 * POST /api/v1/uploads — mint a presigned PUT so the browser can send a
 * source file straight to R2 for a Transform generation.
 *
 * This is NOT the retired /api/v1/get_upload_url (ADR-0007), which proxied
 * to api.muapi.ai and still answers 410. Nothing here talks to that brand.
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
import { presignPutUrl, isConfigured as r2IsConfigured, envConfig as r2EnvConfig } from '../../../../packages/adapters/r2.js';
import { checkDeclared, uploadKeyFor, UPLOAD_URL_TTL_SECONDS } from '../../../../lib/uploadSource.js';

export async function POST(req) {
    const authId = req.headers.get('x-veyrnox-auth-id');
    if (!authId) return NextResponse.json({ error: 'not_authenticated' }, { status: 401 });

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
