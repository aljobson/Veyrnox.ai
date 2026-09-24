/**
 * POST /api/webhook/lemonsqueezy — paid Credit Pack orders (#93, ADR-0018).
 *
 *   1. Verify X-Signature (hex HMAC-SHA256 of the raw body). Invalid -> 401
 *      plus console.error. Nothing in the body is read before this.
 *   2. Only order_created, order_refunded, dispute_created and
 *      dispute_resolved are handled; every other event -> 200 ignored.
 *   3. Dedupe in webhook_events(source 'billing:lemonsqueezy'):
 *      'order_created:<order id>', or for a refund
 *      'order_refunded:<order id>:<refunded amount cents>' so each distinct
 *      refund amount is processed once. Already processed -> 200.
 *   4. Re-fetch the order from the LemonSqueezy API: its status, amounts,
 *      currency, variant and test mode are the source of truth.
 *      Only the Top-up id comes from the signed body (meta.custom_data),
 *      because the API's order object has no custom data. A buyer can set
 *      custom data on any buy link, so order_created credits only a Top-up
 *      id carrying the top_up_sig our checkout signed; anything else is
 *      logged and left for the email-bound backfill or an Operator.
 *   5. order_created: credit_top_up locks the pending Top-up and grants to
 *      ITS user, once. A second paid order for a credited Top-up, or a
 *      mismatched one, is flagged for an Operator refund and never granted.
 *      order_refunded: apply_top_up_refund claws back the Top-up's share of
 *      Pack Credits for the re-fetched cumulative refunded amount (#96), and
 *      Freezes the account if the user generated since that Top-up (#97).
 *      dispute_created Freezes the order's owner; dispute_resolved only logs
 *      (ADR-0019).
 *   6. Transient LemonSqueezy or database failure -> 5xx so LemonSqueezy
 *      retries; the event row stays unprocessed.
 *
 * LemonSqueezy sends no timestamp, so there is no replay window (ADR-0018
 * deviation): the signature, the re-fetch and the dedupe make replays harmless.
 * Response bodies stay generic; details go to server logs only.
 */

import { NextResponse } from 'next/server';
import { verifyWebhookSignature, verifyTopUpCustomData, fetchOrder, normaliseOrder, checkOrderOrigin, disputeOrderId, CREDITABLE_ORDER_STATUSES } from '../../../../packages/adapters/lemonsqueezy.js';
import { rpc, envConfig } from '../../../../packages/db/supabase-client.js';
import { dedup, markProcessed } from '../../../../lib/providerCompletion.js';

const SOURCE = 'billing:lemonsqueezy';
const LOG = '[lemonsqueezy-webhook]';
const ORDER_ID_RE = /^[0-9]{1,20}$/;
// Paid orders we took money for but must not grant: an Operator refunds them.
const FLAGGED = new Set(['ALREADY_CREDITED', 'VARIANT_MISMATCH', 'AMOUNT_MISMATCH', 'CURRENCY_MISMATCH']);
// Final refusals a redelivery cannot change.
const REFUSED = new Set(['TOP_UP_NOT_FOUND', 'ORDER_ALREADY_USED', 'INVALID_ORDER_ID']);
const REFUND_REFUSED = new Set(['ORDER_NOT_FOUND', 'INVALID_ORDER_ID', 'INVALID_AMOUNT']);
const DISPUTE_REFUSED = new Set(['TOP_UP_NOT_FOUND', 'INVALID_ORDER_ID']);

export async function POST(req) {
    const cfg = envConfig();
    const secret = process.env.LEMONSQUEEZY_WEBHOOK_SECRET;
    const apiKey = process.env.LEMONSQUEEZY_API_KEY;
    const testMode = process.env.LEMONSQUEEZY_TEST_MODE;
    const storeId = process.env.LEMONSQUEEZY_STORE_ID;
    // Fail closed: without an explicit mode we can't tell test orders from live.
    if (!cfg.supabaseUrl || !cfg.serviceRoleKey || !secret || !apiKey || !storeId || (testMode !== 'true' && testMode !== 'false')) {
        return NextResponse.json({ error: 'not_configured' }, { status: 503 });
    }

    const raw = new Uint8Array(await req.arrayBuffer());
    let verified;
    try {
        verified = await verifyWebhookSignature(raw, req.headers.get('x-signature'), secret);
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
    const eventName = event && event.meta && event.meta.event_name;
    if (eventName === 'dispute_created' || eventName === 'dispute_resolved') {
        try {
            return await handleDispute(cfg, event, eventName, { apiKey, testMode, storeId });
        } catch (err) {
            console.error(LOG, 'dispute processing failed:', err && (err.status ?? err.message));
            return NextResponse.json({ error: 'internal' }, { status: 500 });
        }
    }
    if (eventName !== 'order_created' && eventName !== 'order_refunded') {
        return NextResponse.json({ ok: true, ignored: true });
    }
    const orderId = String(event.data && event.data.id);
    if (!event.data || event.data.type !== 'orders' || !ORDER_ID_RE.test(orderId)) {
        console.error(LOG, 'signed event without a valid order id:', eventName);
        return NextResponse.json({ error: 'invalid_order' }, { status: 400 });
    }

    try {
        if (eventName === 'order_refunded') return await handleRefund(cfg, event, orderId, { apiKey, testMode, storeId });

        const externalId = `order_created:${orderId}`;
        const seen = await dedup(cfg, SOURCE, externalId, { event_name: eventName, order_id: orderId });
        if (seen === 'duplicate') return NextResponse.json({ ok: true, duplicate: true });

        if (!(await verifyTopUpCustomData(event.meta.custom_data, secret))) {
            console.error(LOG, 'order without our Top-up signature, not credited:', orderId);
            await markProcessed(cfg, SOURCE, externalId);
            return NextResponse.json({ ok: true, warn: 'order_not_creditable' });
        }

        const fetched = await fetchOrder(orderId, { fetch: fetch.bind(globalThis), apiKey });
        if (!fetched.ok) {
            console.error(LOG, 'order re-fetch failed:', orderId, fetched.error);
            return NextResponse.json({ error: 'order_fetch_failed' }, { status: fetched.transient ? 503 : 502 });
        }

        const norm = normaliseOrder(fetched.order, event.meta.custom_data, { expectTestMode: testMode === 'true', expectStoreId: storeId });
        if (!norm.ok) {
            // Not from our checkout, or the wrong mode: nothing to credit, ever.
            console.error(LOG, 'order not creditable:', orderId, norm.error);
            await markProcessed(cfg, SOURCE, externalId);
            return NextResponse.json({ ok: true, warn: 'order_not_creditable' });
        }
        const o = norm.order;
        if (o.status === 'pending') {
            return NextResponse.json({ error: 'order_pending' }, { status: 503 });
        }
        // A refund can land before this event is processed; the order is still
        // credited, and the refund below takes its share back.
        if (!CREDITABLE_ORDER_STATUSES.has(o.status)) {
            console.error(LOG, 'order not paid, not credited:', orderId, o.status, o.topUpId);
            await markProcessed(cfg, SOURCE, externalId);
            return NextResponse.json({ ok: true, warn: 'order_not_paid' });
        }

        const res = await rpc('credit_top_up', {
            p_top_up_id: o.topUpId,
            p_order_id: o.orderId,
            p_paid_usd_cents: o.paidCents,
            p_currency: o.currency,
            p_variant_id: o.variantId,
        }, cfg);
        if (!res || typeof res.ok !== 'boolean' || (res.ok === false && !FLAGGED.has(res.code) && !REFUSED.has(res.code))) {
            console.error(LOG, 'credit_top_up gave no usable verdict:', orderId, res && res.code);
            return NextResponse.json({ error: 'internal' }, { status: 500 });
        }
        if (res.ok === false) {
            const why = FLAGGED.has(res.code) ? 'paid order flagged for Operator refund' : 'order refused';
            console.error(LOG, `${why}:`, res.code, 'order', orderId, 'top_up', o.topUpId);
        } else if (o.refundedCents > 0 && !(await applyRefund(cfg, o))) {
            return NextResponse.json({ error: 'internal' }, { status: 500 });
        }
        await markProcessed(cfg, SOURCE, externalId);
        return NextResponse.json({ ok: true });
    } catch (err) {
        console.error(LOG, 'processing failed:', err && (err.status ?? err.message));
        return NextResponse.json({ error: 'internal' }, { status: 500 });
    }
}

// order_refunded: dedupe on the re-fetched cumulative refunded amount, then
// claw back that Top-up's share. The order is looked up by id, never by a
// user named in the payload.
async function handleRefund(cfg, event, orderId, { apiKey, testMode, storeId }) {
    const fetched = await fetchOrder(orderId, { fetch: fetch.bind(globalThis), apiKey });
    if (!fetched.ok) {
        console.error(LOG, 'refunded order re-fetch failed:', orderId, fetched.error);
        return NextResponse.json({ error: 'order_fetch_failed' }, { status: fetched.transient ? 503 : 502 });
    }
    const norm = normaliseOrder(fetched.order, event.meta.custom_data, { expectTestMode: testMode === 'true', expectStoreId: storeId });
    if (!norm.ok) {
        console.error(LOG, 'refunded order not ours:', orderId, norm.error);
        return NextResponse.json({ ok: true, warn: 'order_not_creditable' });
    }
    const o = norm.order;

    const externalId = `order_refunded:${orderId}:${o.refundedCents}`;
    const seen = await dedup(cfg, SOURCE, externalId, { event_name: 'order_refunded', order_id: orderId });
    if (seen === 'duplicate') return NextResponse.json({ ok: true, duplicate: true });

    const res = await rpc('apply_top_up_refund', {
        p_order_id: o.orderId,
        p_refunded_cents: o.refundedCents,
        p_total_cents: o.totalCents,
        p_top_up_id: o.topUpId,
    }, cfg);
    if (res && res.code === 'NOT_CREDITED_YET') {
        // order_created hasn't credited it yet. Retry; when it does, it
        // applies the re-fetched refund itself.
        return NextResponse.json({ error: 'not_credited_yet' }, { status: 503 });
    }
    if (!refundVerdict(o.orderId, res)) return NextResponse.json({ error: 'internal' }, { status: 500 });
    await markProcessed(cfg, SOURCE, externalId);
    return NextResponse.json({ ok: true });
}

// After crediting an order that has already been refunded. False = retry.
async function applyRefund(cfg, o) {
    const res = await rpc('apply_top_up_refund', {
        p_order_id: o.orderId,
        p_refunded_cents: o.refundedCents,
        p_total_cents: o.totalCents,
        p_top_up_id: o.topUpId,
    }, cfg);
    return refundVerdict(o.orderId, res);
}

// Logs the outcome. False when the result is unusable and the event must be retried.
function refundVerdict(orderId, res) {
    if (!res || typeof res.ok !== 'boolean' || (res.ok === false && !REFUND_REFUSED.has(res.code))) {
        console.error(LOG, 'apply_top_up_refund gave no usable verdict:', orderId, res && res.code);
        return false;
    }
    if (res.ok === false) {
        console.error(LOG, 'refund not applied:', res.code, 'order', orderId);
    } else {
        if (res.shortfall > 0) {
            console.error(LOG, 'refund clawback short:', 'order', orderId, 'taken', res.taken, 'shortfall', res.shortfall);
        }
        if (res.frozen) console.error(LOG, 'account Frozen on refund after generating:', 'order', orderId, 'user', res.user_id);
    }
    return true;
}

// dispute_created Freezes the order's owner; dispute_resolved only logs
// (ADR-0019). Only the order id is taken from the payload; the user is the
// credited Top-up's owner. No usable order id or no Top-up: log, 200, no Freeze.
async function handleDispute(cfg, event, eventName, { apiKey, testMode, storeId }) {
    const orderId = disputeOrderId(event);
    const reference = String((event.data && event.data.id) ?? '').slice(0, 64);
    if (!orderId) {
        console.error(LOG, `${eventName} without a usable order id, not applied:`, reference);
        return NextResponse.json({ ok: true, warn: 'no_order_id' });
    }

    const externalId = `${eventName}:${reference || orderId}`;
    const seen = await dedup(cfg, SOURCE, externalId, { event_name: eventName, order_id: orderId });
    if (seen === 'duplicate') return NextResponse.json({ ok: true, duplicate: true });

    const fetched = await fetchOrder(orderId, { fetch: fetch.bind(globalThis), apiKey });
    if (!fetched.ok) {
        console.error(LOG, `${eventName} order re-fetch failed:`, orderId, fetched.error);
        if (fetched.transient) return NextResponse.json({ error: 'order_fetch_failed' }, { status: 503 });
        await markProcessed(cfg, SOURCE, externalId);
        return NextResponse.json({ ok: true, warn: 'order_not_found' });
    }
    const origin = checkOrderOrigin(fetched.order, { expectTestMode: testMode === 'true', expectStoreId: storeId });
    if (!origin.ok) {
        console.error(LOG, `${eventName} order not ours:`, orderId, origin.error);
        await markProcessed(cfg, SOURCE, externalId);
        return NextResponse.json({ ok: true, warn: 'order_not_ours' });
    }

    const res = await rpc('apply_dispute_event', {
        p_order_id: orderId,
        p_event: eventName === 'dispute_created' ? 'created' : 'resolved',
        p_reference: reference,
    }, cfg);
    if (!res || typeof res.ok !== 'boolean' || (res.ok === false && !DISPUTE_REFUSED.has(res.code))) {
        console.error(LOG, 'apply_dispute_event gave no usable verdict:', orderId, res && res.code);
        return NextResponse.json({ error: 'internal' }, { status: 500 });
    }
    if (res.ok === false) {
        console.error(LOG, `${eventName} not applied:`, res.code, 'order', orderId);
    } else if (eventName === 'dispute_created') {
        console.error(LOG, 'account Frozen on dispute:', 'order', orderId, 'user', res.user_id);
    }
    await markProcessed(cfg, SOURCE, externalId);
    return NextResponse.json({ ok: true });
}
