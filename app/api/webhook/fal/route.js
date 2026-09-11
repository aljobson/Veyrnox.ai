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

const SOURCE = 'fal';

export async function POST(req) {
    const cfg = envConfig();
    if (!cfg.supabaseUrl || !cfg.serviceRoleKey) {
        return NextResponse.json({ error: 'not configured' }, { status: 503 });
    }

    const signature = req.headers.get('x-fal-signature-256');
    const rawBuf = await req.arrayBuffer();
    const raw = new Uint8Array(rawBuf);

    let verified;
    try {
        verified = await verifyWebhookSignature(raw, signature);
    } catch (err) {
        console.error('[fal-webhook] verify threw:', err);
        return NextResponse.json({ error: 'internal' }, { status: 500 });
    }
    if (!verified) return NextResponse.json({ error: 'signature' }, { status: 401 });

    /** @type {any} */
    let event;
    try {
        event = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw));
    } catch {
        return NextResponse.json({ error: 'invalid json' }, { status: 400 });
    }
    const requestId = event && (event.request_id || event.id);
    if (typeof requestId !== 'string' || !requestId) {
        return NextResponse.json({ error: 'missing request_id' }, { status: 400 });
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
            await rpc('job_succeeded', { p_provider_job_id: requestId, p_provider: SOURCE }, cfg);
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
