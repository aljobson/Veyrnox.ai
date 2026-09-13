/**
 * POST /api/webhook/lemonsqueezy — paid Credit Pack orders (#93, ADR-0018).
 *
 *   1. Verify X-Signature (hex HMAC-SHA256 of the raw body). Invalid -> 401
 *      plus console.error. Nothing in the body is read before this.
 *   2. Only order_created is handled here. order_refunded is recorded in
 *      webhook_events unprocessed for the clawback path (#97) to replay;
 *      every other event -> 200 ignored.
 *   3. Dedupe in webhook_events(source 'billing:lemonsqueezy',
 *      'order_created:<order id>'). Already processed -> 200.
 *   4. Re-fetch the order from the LemonSqueezy API: its status, pre-tax
 *      amount, currency, variant and test mode are the source of truth.
 *      Only the Top-up id comes from the signed body (meta.custom_data),
 *      because the API's order object has no custom data.
 *   5. credit_top_up locks the pending Top-up and grants to ITS user, once.
 *      A second paid order for a credited Top-up, or a mismatched one, is
 *      flagged for an Operator refund and never granted.
 *   6. Transient LemonSqueezy or database failure -> 5xx so LemonSqueezy
 *      retries; the event row stays unprocessed.
 *
 * LemonSqueezy sends no timestamp, so there is no replay window (ADR-0018
 * deviation): the signature, the re-fetch and the dedupe make replays harmless.
 * Response bodies stay generic; details go to server logs only.
 */

import { NextResponse } from 'next/server';
import { verifyWebhookSignature, fetchOrder, normaliseOrder } from '../../../../packages/adapters/lemonsqueezy.js';
import { rpc, envConfig } from '../../../../packages/db/supabase-client.js';
import { dedup, markProcessed } from '../../../../lib/providerCompletion.js';

const SOURCE = 'billing:lemonsqueezy';
const LOG = '[lemonsqueezy-webhook]';
const ORDER_ID_RE = /^[0-9]{1,20}$/;
// Paid orders we took money for but must not grant: an Operator refunds them.
const FLAGGED = new Set(['ALREADY_CREDITED', 'VARIANT_MISMATCH', 'AMOUNT_MISMATCH', 'CURRENCY_MISMATCH']);
// Final refusals a redelivery cannot change.
const REFUSED = new Set(['TOP_UP_NOT_FOUND', 'ORDER_ALREADY_USED', 'INVALID_ORDER_ID']);

export async function POST(req) {
    const cfg = envConfig();
    const secret = process.env.LEMONSQUEEZY_WEBHOOK_SECRET;
    const apiKey = process.env.LEMONSQUEEZY_API_KEY;
    const testMode = process.env.LEMONSQUEEZY_TEST_MODE;
    // Fail closed: without an explicit mode we can't tell test orders from live.
    if (!cfg.supabaseUrl || !cfg.serviceRoleKey || !secret || !apiKey || (testMode !== 'true' && testMode !== 'false')) {
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
    if (eventName !== 'order_created' && eventName !== 'order_refunded') {
        return NextResponse.json({ ok: true, ignored: true });
    }
    const orderId = String(event.data && event.data.id);
    if (!event.data || event.data.type !== 'orders' || !ORDER_ID_RE.test(orderId)) {
        console.error(LOG, 'signed event without a valid order id:', eventName);
        return NextResponse.json({ error: 'invalid_order' }, { status: 400 });
    }

    try {
        if (eventName === 'order_refunded') {
            // ponytail: clawback is #97. Keep the event unprocessed so it is
            // replayed then instead of lost after LemonSqueezy's 3 retries.
            const refunded = event.data.attributes && event.data.attributes.refunded_amount;
            const externalId = `order_refunded:${orderId}:${Number.isSafeInteger(refunded) ? refunded : 'unknown'}`;
            await dedup(cfg, SOURCE, externalId, { event_name: eventName, order_id: orderId });
            console.error(LOG, 'order_refunded recorded, clawback not built yet (#97):', orderId);
            return NextResponse.json({ ok: true, deferred: true });
        }

        const externalId = `order_created:${orderId}`;
        const seen = await dedup(cfg, SOURCE, externalId, { event_name: eventName, order_id: orderId });
        if (seen === 'duplicate') return NextResponse.json({ ok: true, duplicate: true });

        const fetched = await fetchOrder(orderId, { fetch: fetch.bind(globalThis), apiKey });
        if (!fetched.ok) {
            console.error(LOG, 'order re-fetch failed:', orderId, fetched.error);
            return NextResponse.json({ error: 'order_fetch_failed' }, { status: fetched.transient ? 503 : 502 });
        }

        const norm = normaliseOrder(fetched.order, event.meta.custom_data, { expectTestMode: testMode === 'true' });
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
        if (o.status !== 'paid') {
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
        }
        await markProcessed(cfg, SOURCE, externalId);
        return NextResponse.json({ ok: true });
    } catch (err) {
        console.error(LOG, 'processing failed:', err && (err.status ?? err.message));
        return NextResponse.json({ error: 'internal' }, { status: 500 });
    }
}
