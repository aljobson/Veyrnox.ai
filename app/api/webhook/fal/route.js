/**
 * POST /api/webhook/fal — fal.ai completion callback.
 *
 * Sequence:
 *   1. Read raw body bytes (for signature verification — do NOT let
 *      Next parse first, HMAC/Ed25519 both need exact bytes).
 *   2. Verify Ed25519 signature via `packages/adapters/fal.js` against
 *      fal's JWKS. §5.4 invariant: fal uses Ed25519 (NOT HMAC).
 *   3. Dedup via `webhook_events(source='fal', external_id=request_id)`.
 *   4. Look up job by (provider='fal', provider_job_id=request_id).
 *   5. Success → job_succeeded RPC. Fail → job_failed RPC + ledger_refund.
 *   6. Mark webhook_events row processed.
 *
 * Never trust the body until step 2 succeeds. All log output is
 * server-only; the response body is always generic.
 */

import { NextResponse } from 'next/server';
import { verifyWebhookSignature } from '../../../../packages/adapters/fal.js';
import { rpc, envConfig } from '../../../../packages/db/supabase-client.js';
import { copyUrlToR2, envConfig as r2EnvConfig } from '../../../../packages/adapters/r2.js';

const SOURCE = 'fal';

export async function POST(req) {
    const cfg = envConfig();
    if (!cfg.supabaseUrl || !cfg.serviceRoleKey) {
        return NextResponse.json({ error: 'not_configured' }, { status: 503 });
    }

    // Fal splits its signature across four headers, per
    // fal.ai/docs/model-endpoints/webhooks — signature is hex, message is
    // request_id + \n + user_id + \n + timestamp + \n + sha256(body).hex.
    const sigHeaders = {
        signature: req.headers.get('x-fal-webhook-signature'),
        timestamp: req.headers.get('x-fal-webhook-timestamp'),
        requestId: req.headers.get('x-fal-webhook-request-id'),
        userId: req.headers.get('x-fal-webhook-user-id'),
    };
    const rawBuf = await req.arrayBuffer();
    const raw = new Uint8Array(rawBuf);

    let verified;
    try {
        verified = await verifyWebhookSignature(raw, sigHeaders);
    } catch (err) {
        console.error('[fal-webhook] verify threw:', err);
        return NextResponse.json({ error: 'internal' }, { status: 500 });
    }
    if (!verified) return NextResponse.json({ error: 'invalid_signature' }, { status: 401 });

    /** @type {any} */
    let event;
    try {
        event = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw));
    } catch {
        return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
    }
    const requestId = event && (event.request_id || event.id);
    if (typeof requestId !== 'string' || !requestId) {
        return NextResponse.json({ error: 'missing_request_id' }, { status: 400 });
    }
    const status = event && event.status;

    // Dedup — insert-only on webhook_events; duplicate = silent success.
    const dedupRes = await fetch(new URL('/rest/v1/webhook_events', cfg.supabaseUrl), {
        method: 'POST',
        headers: {
            apikey: cfg.serviceRoleKey,
            Authorization: `Bearer ${cfg.serviceRoleKey}`,
            'Content-Type': 'application/json',
            Prefer: 'return=representation,resolution=ignore-duplicates',
        },
        body: JSON.stringify({ source: SOURCE, external_id: requestId, payload: event }),
    });
    if (dedupRes.status !== 201 && dedupRes.status !== 200) {
        console.error('[fal-webhook] dedup insert failed:', dedupRes.status);
        return NextResponse.json({ error: 'internal' }, { status: 500 });
    }
    let dedupBody;
    try { dedupBody = await dedupRes.json(); } catch { dedupBody = []; }
    if (Array.isArray(dedupBody) && dedupBody.length === 0) {
        return NextResponse.json({ ok: true, duplicate: true });
    }

    // Route by status. fal's success shape has status='completed' or
    // 'OK'; failure shape has status='failed' or a non-null error.
    const isSuccess = status === 'completed' || status === 'OK' || status === 'SUCCESS';
    const isFail = status === 'failed' || status === 'ERROR' || (event && event.error);

    try {
        if (isSuccess) {
            // 1. Mark job SUCCEEDED. Even if R2 copy fails, the state
            //    reflects that the provider succeeded — we can retry
            //    the R2 copy later via a reconcile job (Phase 4).
            const succeededRes = await rpc('job_succeeded',
                { p_provider_job_id: requestId, p_provider: SOURCE }, cfg);
            if (!succeededRes || succeededRes.ok !== true) {
                console.warn('[fal-webhook] job_succeeded returned', succeededRes);
            }

            // 2. Extract the provider-hosted URL from the fal payload.
            //    Shape varies per model — best-effort probe of common
            //    fields. If we can't find one, log and stop (job stays
            //    SUCCEEDED without an asset; reconcile job can retry).
            const outputUrl = extractOutputUrl(event);
            if (!outputUrl) {
                console.error('[fal-webhook] no output url in payload for', requestId);
                return NextResponse.json({ ok: true, warn: 'no output url' });
            }

            // 3. Copy the object into R2. The key is content-addressable
            //    on the fal request id + a modality hint so retries
            //    upsert to the same R2 key (0009 ON CONFLICT handles it).
            const r2cfg = r2EnvConfig();
            const key = `fal/${requestId}/${suggestFilename(event, outputUrl)}`;
            const copy = await copyUrlToR2(outputUrl, key, r2cfg);
            if (!copy.ok) {
                console.error('[fal-webhook] R2 copy failed for', requestId, copy.error);
                return NextResponse.json({ ok: true, warn: 'r2 copy failed' });
            }

            // 4. Transition job to STORED and record the asset row.
            const storedRes = await rpc('job_stored', {
                p_provider_job_id: requestId,
                p_provider: SOURCE,
                p_r2_key: copy.r2Key,
                p_mime_type: copy.mimeType,
                p_size_bytes: copy.size,
            }, cfg);
            if (!storedRes || storedRes.ok !== true) {
                console.warn('[fal-webhook] job_stored returned', storedRes);
            }
        } else if (isFail) {
            const errCode = (event && event.error && event.error.code) || 'provider_error';
            const failRes = await rpc('job_failed', {
                p_provider_job_id: requestId,
                p_provider: SOURCE,
                p_error_code: String(errCode).slice(0, 128),
            }, cfg);
            if (failRes && failRes.ok && failRes.user_id && failRes.credits) {
                await rpc('ledger_refund', {
                    p_job_id: failRes.job_id,
                    p_user_id: failRes.user_id,
                    p_credits: failRes.credits,
                    p_reason: 'refund:provider_failed',
                }, cfg);
            }
        }
        // else: intermediate/unknown status — leave the job row alone.
    } catch (err) {
        console.error('[fal-webhook] state RPC failed:', err);
        return NextResponse.json({ error: 'internal' }, { status: 500 });
    }

    // Mark processed.
    await fetch(new URL(
        `/rest/v1/webhook_events?source=eq.${encodeURIComponent(SOURCE)}&external_id=eq.${encodeURIComponent(requestId)}`,
        cfg.supabaseUrl,
    ), {
        method: 'PATCH',
        headers: {
            apikey: cfg.serviceRoleKey,
            Authorization: `Bearer ${cfg.serviceRoleKey}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ processed_at: new Date().toISOString() }),
    }).catch((err) => console.error('[fal-webhook] processed patch failed:', err));

    return NextResponse.json({ ok: true });
}


// ─── payload helpers ────────────────────────────────────────────────────────

/**
 * Best-effort extraction of the provider-hosted asset URL from a fal
 * completion payload. Shapes we've seen:
 *   { output: { url } }              simple video/audio
 *   { output: { video: { url } } }
 *   { output: { images: [{ url }] } } image generators
 *   { images: [{ url }] }             sometimes at top level
 *   { video: { url } }                sometimes at top level
 * Returns null if none found — caller logs + no-ops.
 */
function extractOutputUrl(event) {
    // Fal's real shape wraps the payload under `.payload` and puts arrays
    // under `.images`; try that first before falling back to older shapes.
    const p = event && event.payload;
    if (p) {
        if (Array.isArray(p.images) && p.images[0] && typeof p.images[0].url === 'string') {
            return p.images[0].url;
        }
        if (p.video && typeof p.video.url === 'string') return p.video.url;
        if (p.audio && typeof p.audio.url === 'string') return p.audio.url;
        if (typeof p.url === 'string') return p.url;
    }
    const out = (event && event.output) || event || {};
    if (out && typeof out.url === 'string') return out.url;
    if (out.video && typeof out.video.url === 'string') return out.video.url;
    if (out.audio && typeof out.audio.url === 'string') return out.audio.url;
    if (Array.isArray(out.images) && out.images[0] && typeof out.images[0].url === 'string') {
        return out.images[0].url;
    }
    if (event.video && typeof event.video.url === 'string') return event.video.url;
    if (Array.isArray(event.images) && event.images[0] && typeof event.images[0].url === 'string') {
        return event.images[0].url;
    }
    return null;
}

function suggestFilename(event, url) {
    // Trailing path segment of the fal URL if it looks like a file; else
    // fall back to a mime-based name.
    try {
        const path = new URL(url).pathname;
        const seg = path.split('/').pop();
        if (seg && /\.[A-Za-z0-9]{2,5}$/.test(seg)) return seg;
    } catch { /* ignore */ }
    const guess = (event && event.output && event.output.content_type)
        || (event && event.content_type)
        || 'application/octet-stream';
    const ext = mimeExt(guess);
    return `output${ext}`;
}

function mimeExt(mime) {
    if (mime.startsWith('image/')) {
        if (mime.includes('png')) return '.png';
        if (mime.includes('webp')) return '.webp';
        if (mime.includes('jpeg') || mime.includes('jpg')) return '.jpg';
        return '.img';
    }
    if (mime.startsWith('video/')) {
        if (mime.includes('mp4')) return '.mp4';
        if (mime.includes('webm')) return '.webm';
        return '.vid';
    }
    if (mime.startsWith('audio/')) {
        if (mime.includes('mpeg')) return '.mp3';
        if (mime.includes('wav')) return '.wav';
        return '.aud';
    }
    return '.bin';
}
