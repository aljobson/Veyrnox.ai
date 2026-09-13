/**
 * POST /api/webhook/stripe — Stripe events for credit top-ups (ADR-0020).
 *
 *   1. Read raw bytes; verify Stripe-Signature (HMAC-SHA256, 5 min window).
 *   2. Dedup on webhook_events(source='stripe', external_id=event.id).
 *   3. checkout.session.completed / async_payment_succeeded (paid)
 *        → purchase_fulfil (user comes from our purchases row)
 *      charge.refunded (full or partial) → purchase_reverse('reversal:refund')
 *        with the cumulative amount_refunded / amount, so each Top-up gives
 *        back a proportional, rounded-down share of its credits
 *      charge.dispute.closed (lost)      → purchase_reverse('reversal:dispute')
 *        as a whole-charge reversal
 *      Either Freezes the account when credits were spent since that
 *      Top-up (a Chargeback).
 *   4. Mark processed. Any non-2xx makes Stripe redeliver; every RPC is
 *      idempotent, so a replay is safe.
 *
 * The stored payload is {type, object_id}: Checkout events carry customer
 * name, email and address we have no reason to keep.
 */

import { NextResponse } from 'next/server';
import { verifyWebhookSignature } from '../../../../packages/adapters/stripe.js';
import { rpc, envConfig } from '../../../../packages/db/supabase-client.js';

const SOURCE = 'stripe';
const EVENT_ID_RE = /^evt_[A-Za-z0-9]{1,255}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PI_RE = /^pi_[A-Za-z0-9]{1,255}$/;
// A lost dispute returns the whole charge: refunded / amount = 1 / 1.
const WHOLE_CHARGE = { refunded: 1, amount: 1 };
// A reversal whose purchase is still missing this long after the event is
// not racing fulfilment; stop redelivery and leave the log for an operator.
const REVERSAL_RETRY_SECONDS = 60 * 60;

function serviceHeaders(cfg) {
    return { apikey: cfg.serviceRoleKey, Authorization: `Bearer ${cfg.serviceRoleKey}` };
}

// A row with processed_at IS NULL is a delivery we 500'd on part-way.
async function alreadyProcessed(cfg, eventId) {
    const url = new URL('/rest/v1/webhook_events', cfg.supabaseUrl);
    url.searchParams.set('select', 'processed_at');
    url.searchParams.set('source', `eq.${SOURCE}`);
    url.searchParams.set('external_id', `eq.${eventId}`);
    url.searchParams.set('limit', '1');
    const res = await fetch(url, { headers: serviceHeaders(cfg) });
    if (!res.ok) throw new Error(`webhook_events read ${res.status}`);
    const rows = await res.json().catch(() => []);
    return !(Array.isArray(rows) && rows[0] && rows[0].processed_at === null);
}

async function markProcessed(cfg, eventId) {
    await fetch(new URL(
        `/rest/v1/webhook_events?source=eq.${encodeURIComponent(SOURCE)}&external_id=eq.${encodeURIComponent(eventId)}`,
        cfg.supabaseUrl,
    ), {
        method: 'PATCH',
        headers: { ...serviceHeaders(cfg), 'Content-Type': 'application/json' },
        body: JSON.stringify({ processed_at: new Date().toISOString() }),
    }).catch((err) => console.error('[stripe-webhook] processed patch failed:', err));
}

const ok = (extra) => NextResponse.json({ ok: true, ...extra });
const retry = (error) => NextResponse.json({ error }, { status: 500 });

async function fulfil(cfg, session) {
    if (session.mode !== 'payment' || session.payment_status !== 'paid') return { done: true };
    const purchaseId = session.client_reference_id;
    if (typeof purchaseId !== 'string' || !UUID_RE.test(purchaseId)) {
        console.error('[stripe-webhook] session without purchase id', session.id);
        return { done: true, warn: 'unknown_purchase' };
    }
    const res = await rpc('purchase_fulfil', {
        p_purchase_id: purchaseId,
        p_session_id: session.id,
        p_payment_intent: typeof session.payment_intent === 'string' ? session.payment_intent : null,
    }, cfg);
    if (res && res.ok === true) {
        // Checkout opened before a Freeze and paid after it: credits granted, not spendable.
        if (res.frozen === true && !res.idempotent) {
            console.error('[stripe-webhook] top-up paid into frozen account', res.user_id, purchaseId);
        }
        return { done: true };
    }
    // Redelivery cannot fix these: paid money with no matching purchase.
    console.error('[stripe-webhook] purchase_fulfil rejected', purchaseId, session.id, res && res.code);
    if (res && (res.code === 'PURCHASE_NOT_FOUND' || res.code === 'SESSION_MISMATCH')) {
        return { done: true, warn: 'unmatched_payment' };
    }
    return { done: false };
}

async function reverse(cfg, paymentIntent, reason, eventCreated, share) {
    if (typeof paymentIntent !== 'string' || !PI_RE.test(paymentIntent)) {
        console.error('[stripe-webhook] reversal without payment intent', reason);
        return { done: true, warn: 'no_payment_intent' };
    }
    if (!Number.isSafeInteger(share.refunded) || !Number.isSafeInteger(share.amount)
        || share.amount <= 0 || share.refunded < 0 || share.refunded > share.amount) {
        console.error('[stripe-webhook] reversal with invalid amounts', paymentIntent, share.refunded, share.amount);
        return { done: true, warn: 'invalid_amount' };
    }
    const res = await rpc('purchase_reverse', {
        p_payment_intent: paymentIntent,
        p_reason: reason,
        p_amount_refunded: share.refunded,
        p_amount: share.amount,
    }, cfg);
    if (!res || res.ok !== true) {
        console.error('[stripe-webhook] purchase_reverse rejected', paymentIntent, res && res.code);
        // PURCHASE_NOT_FOUND may be a refund racing ahead of fulfilment:
        // 500 so Stripe redelivers once the purchase is PAID — for a while.
        const ageSec = Math.floor(Date.now() / 1000) - Number(eventCreated);
        if (res && res.code === 'PURCHASE_NOT_FOUND' && ageSec > REVERSAL_RETRY_SECONDS) {
            return { done: true, warn: 'unmatched_reversal' };
        }
        return { done: false };
    }
    if (res.shortfall > 0 && !res.idempotent) {
        console.error('[stripe-webhook] reversal shortfall', paymentIntent, reason, res.shortfall);
    }
    if (res.frozen === true) {
        console.error('[stripe-webhook] chargeback: account frozen', res.user_id, paymentIntent, reason);
    }
    return { done: true };
}

export async function POST(req) {
    const cfg = envConfig();
    const secret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!cfg.supabaseUrl || !cfg.serviceRoleKey || !secret) {
        return NextResponse.json({ error: 'not_configured' }, { status: 503 });
    }

    const raw = new Uint8Array(await req.arrayBuffer());
    let verified;
    try {
        verified = await verifyWebhookSignature(raw, req.headers.get('stripe-signature'), secret);
    } catch (err) {
        console.error('[stripe-webhook] verify threw:', err);
        return retry('internal');
    }
    if (!verified) {
        console.error('[stripe-webhook] invalid signature');
        return NextResponse.json({ error: 'invalid_signature' }, { status: 401 });
    }

    let event;
    try {
        event = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw));
    } catch {
        return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
    }
    const eventId = event && event.id;
    const object = event && event.data && event.data.object;
    if (typeof eventId !== 'string' || !EVENT_ID_RE.test(eventId) || !object || typeof object !== 'object') {
        return NextResponse.json({ error: 'invalid_event' }, { status: 400 });
    }

    const dedupRes = await fetch(new URL('/rest/v1/webhook_events?on_conflict=source,external_id', cfg.supabaseUrl), {
        method: 'POST',
        headers: {
            ...serviceHeaders(cfg),
            'Content-Type': 'application/json',
            Prefer: 'return=representation,resolution=ignore-duplicates',
        },
        body: JSON.stringify({
            source: SOURCE,
            external_id: eventId,
            payload: { type: String(event.type).slice(0, 64), object_id: String(object.id || '').slice(0, 255) },
        }),
    });
    if (dedupRes.status !== 201 && dedupRes.status !== 200) {
        console.error('[stripe-webhook] dedup insert failed:', dedupRes.status);
        return retry('internal');
    }
    const dedupBody = await dedupRes.json().catch(() => []);
    try {
        if (Array.isArray(dedupBody) && dedupBody.length === 0 && await alreadyProcessed(cfg, eventId)) {
            return ok({ duplicate: true });
        }

        let result = { done: true };
        switch (event.type) {
            case 'checkout.session.completed':
            case 'checkout.session.async_payment_succeeded':
                result = await fulfil(cfg, object);
                break;
            case 'charge.refunded':
                result = await reverse(cfg, object.payment_intent, 'reversal:refund', event.created,
                    { refunded: object.amount_refunded, amount: object.amount });
                break;
            case 'charge.dispute.closed':
                if (object.status === 'lost') result = await reverse(cfg, object.payment_intent, 'reversal:dispute', event.created, WHOLE_CHARGE);
                break;
            default:
                break;
        }
        if (!result.done) return retry('processing_failed');
        await markProcessed(cfg, eventId);
        return ok(result.warn ? { warn: result.warn } : undefined);
    } catch (err) {
        console.error('[stripe-webhook] processing threw:', err);
        return retry('internal');
    }
}
