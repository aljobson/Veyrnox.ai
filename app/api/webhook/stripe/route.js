/**
 * POST /api/webhook/stripe — paid Credit Pack orders (#93, ADR-0031).
 *
 * Same shape as /api/webhook/lemonsqueezy, which this replaces:
 *
 *   1. Verify `Stripe-Signature` over the exact raw bytes. Invalid -> 401
 *      plus console.error. Nothing in the body is read before this.
 *   2. Only checkout.session.completed, charge.refunded, charge.dispute.created
 *      and charge.dispute.closed are handled; every other type -> 200 ignored.
 *   3. Dedupe in webhook_events(source 'billing:stripe') on the Stripe event
 *      id, which is already unique per delivery (LemonSqueezy needed a
 *      composed key). Already processed -> 200.
 *   4. checkout.session.completed: a buyer cannot set metadata on a session we
 *      created, but a second integration could, so only a session carrying the
 *      top_up_sig our checkout signed is credited. The session is then re-read
 *      from Stripe — the webhook body is a pointer, not the truth — and its
 *      livemode must match the key we hold.
 *   5. credit_top_up locks the pending Top-up and grants to ITS user, once. A
 *      second paid order for a credited Top-up, or a mismatched amount, is
 *      flagged for an Operator refund and never granted.
 *      charge.refunded claws back the Top-up's share for the cumulative
 *      `amount_refunded` (#96) and Freezes the account if the user generated
 *      since that Top-up (#97). charge.dispute.created Freezes the order's
 *      owner; charge.dispute.closed only logs (ADR-0019).
 *   6. Transient Stripe or database failure -> 5xx so Stripe retries; the
 *      event row stays unprocessed.
 *
 * The signature carries a timestamp, so a captured delivery cannot be replayed
 * days later — the replay window ADR-0018 §replay could not have.
 * Response bodies stay generic; details go to server logs only.
 */

import { NextResponse } from 'next/server';
import { verifyWebhookSignature, verifyTopUpMetadata, fetchSession, interpretSession } from '../../../../packages/adapters/stripe.js';
import { rpc, envConfig } from '../../../../packages/db/supabase-client.js';
import { dedup, markProcessed } from '../../../../lib/providerCompletion.js';

const SOURCE = 'billing:stripe';
const LOG = '[stripe-webhook]';
const EVENT_ID_RE = /^evt_[A-Za-z0-9_]{1,250}$/;
const PAYMENT_INTENT_RE = /^pi_[A-Za-z0-9_]{1,250}$/;
const HANDLED = new Set(['checkout.session.completed', 'charge.refunded', 'charge.dispute.created', 'charge.dispute.closed']);
// Paid orders we took money for but must not grant: an Operator refunds them.
const FLAGGED = new Set(['ALREADY_CREDITED', 'VARIANT_MISMATCH', 'AMOUNT_MISMATCH', 'CURRENCY_MISMATCH']);
// Final refusals a redelivery cannot change.
const REFUSED = new Set(['TOP_UP_NOT_FOUND', 'ORDER_ALREADY_USED', 'INVALID_ORDER_ID']);
const REFUND_REFUSED = new Set(['ORDER_NOT_FOUND', 'INVALID_ORDER_ID', 'INVALID_AMOUNT']);
const DISPUTE_REFUSED = new Set(['TOP_UP_NOT_FOUND', 'INVALID_ORDER_ID']);

export async function POST(req) {
    const cfg = envConfig();
    const secret = process.env.STRIPE_WEBHOOK_SECRET;
    const apiKey = process.env.STRIPE_SECRET_KEY;
    if (!cfg.supabaseUrl || !cfg.serviceRoleKey || !secret || !apiKey) {
        return NextResponse.json({ error: 'not_configured' }, { status: 503 });
    }

    const raw = new Uint8Array(await req.arrayBuffer());
    let verified;
    try {
        verified = await verifyWebhookSignature(raw, req.headers.get('stripe-signature'), secret);
    } catch (err) {
        console.error(LOG, 'verify threw:', err && err.name);
        return NextResponse.json({ error: 'internal' }, { status: 500 });
    }
    if (!verified) {
        console.error(LOG, 'invalid signature');
        return NextResponse.json({ error: 'invalid_signature' }, { status: 401 });
    }

    let event;
    try {
        event = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw));
    } catch {
        return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
    }
    const type = event && event.type;
    if (!HANDLED.has(type)) return NextResponse.json({ ok: true, ignored: true });

    const eventId = String((event && event.id) ?? '');
    const object = event.data && event.data.object;
    if (!EVENT_ID_RE.test(eventId) || !object || typeof object !== 'object') {
        console.error(LOG, 'signed event without a usable id or object:', type);
        return NextResponse.json({ error: 'invalid_event' }, { status: 400 });
    }
    // The key we hold decides which world this event may come from: a test
    // delivery can never credit a live account, or the other way round.
    const expectLiveMode = apiKey.startsWith('sk_live_');
    if (Boolean(event.livemode) !== expectLiveMode) {
        console.error(LOG, 'event mode mismatch, ignored:', type, eventId);
        return NextResponse.json({ ok: true, ignored: true });
    }

    try {
        const seen = await dedup(cfg, SOURCE, eventId, { type });
        if (seen === 'duplicate') return NextResponse.json({ ok: true, duplicate: true });

        if (type === 'checkout.session.completed') {
            return await handleCheckout(cfg, { object, eventId, secret, apiKey, expectLiveMode });
        }
        if (type === 'charge.refunded') return await handleRefund(cfg, { object, eventId, secret });
        return await handleDispute(cfg, { object, eventId, type });
    } catch (err) {
        console.error(LOG, 'processing failed:', err && (err.status ?? err.message));
        return NextResponse.json({ error: 'internal' }, { status: 500 });
    }
}

// checkout.session.completed: credit the Top-up the session was signed for.
async function handleCheckout(cfg, { object, eventId, secret, apiKey, expectLiveMode }) {
    if (!(await verifyTopUpMetadata(object.metadata, secret))) {
        console.error(LOG, 'session without our Top-up signature, not credited:', object.id);
        await markProcessed(cfg, SOURCE, eventId);
        return NextResponse.json({ ok: true, warn: 'session_not_creditable' });
    }

    const fetched = await fetchSession(object.id, { fetch: fetch.bind(globalThis), apiKey });
    if (!fetched.ok) {
        console.error(LOG, 'session re-fetch failed:', object.id, fetched.error);
        return NextResponse.json({ error: 'session_fetch_failed' }, { status: 503 });
    }
    const interp = interpretSession(fetched.session, { expectLiveMode });
    if (!interp.ok) {
        // Not ours, wrong mode, or never paid: nothing to credit, ever.
        console.error(LOG, 'session not creditable:', object.id, interp.error);
        await markProcessed(cfg, SOURCE, eventId);
        return NextResponse.json({ ok: true, warn: 'session_not_creditable' });
    }
    const o = interp.order;

    const res = await rpc('credit_top_up', {
        p_top_up_id: o.topUpId,
        p_order_id: o.orderId,
        p_paid_usd_cents: o.paidCents,
        // credit_top_up compares against the literal 'USD'; Stripe reports 'usd'.
        p_currency: o.currency.toUpperCase(),
        // Stripe prices the session from the Top-up row itself, so there is no
        // variant to match. Left null until a migration drops the check (ADR-0031).
        p_variant_id: null,
    }, cfg);
    if (!res || typeof res.ok !== 'boolean' || (res.ok === false && !FLAGGED.has(res.code) && !REFUSED.has(res.code))) {
        console.error(LOG, 'credit_top_up gave no usable verdict:', o.orderId, res && res.code);
        return NextResponse.json({ error: 'internal' }, { status: 500 });
    }
    if (res.ok === false) {
        const why = FLAGGED.has(res.code) ? 'paid order flagged for Operator refund' : 'order refused';
        console.error(LOG, `${why}:`, res.code, 'order', o.orderId, 'top_up', o.topUpId);
    }
    await markProcessed(cfg, SOURCE, eventId);
    return NextResponse.json({ ok: true });
}

// charge.refunded: claw back the Top-up's share of the CUMULATIVE amount
// refunded so far. The Top-up is found by the charge's PaymentIntent, which is
// what credit_top_up recorded; no user is taken from the payload.
async function handleRefund(cfg, { object, eventId, secret }) {
    const orderId = String(object.payment_intent ?? '');
    if (!PAYMENT_INTENT_RE.test(orderId)) {
        console.error(LOG, 'charge.refunded without a usable payment intent:', eventId);
        await markProcessed(cfg, SOURCE, eventId);
        return NextResponse.json({ ok: true, warn: 'no_order_id' });
    }
    // Only a hint for the NOT_CREDITED_YET probe below, so it must be ours.
    const topUpId = (await verifyTopUpMetadata(object.metadata, secret)) ? object.metadata.top_up_id : null;

    const res = await rpc('apply_top_up_refund', {
        p_order_id: orderId,
        p_refunded_cents: object.amount_refunded,
        p_total_cents: object.amount,
        p_top_up_id: topUpId,
    }, cfg);
    if (res && res.code === 'NOT_CREDITED_YET') {
        // checkout.session.completed hasn't credited it yet; retry until it has.
        return NextResponse.json({ error: 'not_credited_yet' }, { status: 503 });
    }
    if (!refundVerdict(orderId, res)) return NextResponse.json({ error: 'internal' }, { status: 500 });
    await markProcessed(cfg, SOURCE, eventId);
    return NextResponse.json({ ok: true });
}

// Logs the outcome. False when the result is unusable and the event must be retried.
function refundVerdict(orderId, res) {
    if (!res || typeof res.ok !== 'boolean' || (res.ok === false && !REFUND_REFUSED.has(res.code))) {
        console.error(LOG, 'apply_top_up_refund gave no usable verdict:', orderId, res && res.code);
        return false;
    }
    if (res.ok === false) {
        console.error(LOG, 'refund not applied:', res.code, 'order', orderId);
        return true;
    }
    if (res.shortfall > 0) {
        console.error(LOG, 'refund clawback short:', 'order', orderId, 'taken', res.taken, 'shortfall', res.shortfall);
    }
    if (res.frozen) console.error(LOG, 'account Frozen on refund after generating:', 'order', orderId, 'user', res.user_id);
    return true;
}

// charge.dispute.created Freezes the order's owner; charge.dispute.closed only
// logs (ADR-0019 dispute_resolved). Only the PaymentIntent is taken from the
// payload; the user is the credited Top-up's owner.
async function handleDispute(cfg, { object, eventId, type }) {
    const orderId = String(object.payment_intent ?? '');
    const reference = String(object.id ?? '').slice(0, 64);
    if (!PAYMENT_INTENT_RE.test(orderId)) {
        console.error(LOG, `${type} without a usable payment intent, not applied:`, reference);
        await markProcessed(cfg, SOURCE, eventId);
        return NextResponse.json({ ok: true, warn: 'no_order_id' });
    }
    if (type === 'charge.dispute.closed') {
        console.error(LOG, 'dispute closed:', 'order', orderId, 'dispute', reference, 'status', String(object.status ?? '').slice(0, 32));
        await markProcessed(cfg, SOURCE, eventId);
        return NextResponse.json({ ok: true });
    }

    const res = await rpc('apply_dispute_event', {
        p_order_id: orderId,
        p_event: 'created',
        p_reference: reference,
    }, cfg);
    if (!res || typeof res.ok !== 'boolean' || (res.ok === false && !DISPUTE_REFUSED.has(res.code))) {
        console.error(LOG, 'apply_dispute_event gave no usable verdict:', orderId, res && res.code);
        return NextResponse.json({ error: 'internal' }, { status: 500 });
    }
    if (res.ok === false) {
        console.error(LOG, `${type} not applied:`, res.code, 'order', orderId);
    } else {
        console.error(LOG, 'account Frozen on dispute:', 'order', orderId, 'user', res.user_id);
    }
    await markProcessed(cfg, SOURCE, eventId);
    return NextResponse.json({ ok: true });
}
