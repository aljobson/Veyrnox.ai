/**
 * POST /api/webhook/revenuecat — Credit Packs bought in the iOS and Android apps (ADR-0108).
 *
 *   1. Off until STORE_BILLING_ENABLED is "true": 404, nothing read.
 *   2. Verify X-RevenueCat-Webhook-Signature (HMAC-SHA256 over "<t>.<raw body>",
 *      5 minute tolerance) before the body is parsed. Invalid -> 401.
 *   3. Only NON_RENEWING_PURCHASE and CANCELLATION (a refund) are acted on; every
 *      other type -> 200 ignored. Sandbox purchases are ignored unless
 *      STORE_BILLING_ALLOW_SANDBOX is "true" (staging), so production can never
 *      credit a free test purchase.
 *   4. Dedupe in webhook_events(source 'billing:revenuecat') on the event id.
 *   5. A purchase goes to credit_store_purchase, which resolves the secret
 *      RevenueCat customer id to its account (store_customers) and grants once on
 *      the store transaction. The payload never names an account. A refund goes to
 *      apply_store_refund, found by the transaction we credited.
 *   6. Transient failure -> 5xx so RevenueCat retries (about 80 minutes).
 *
 * Response bodies stay generic; details go to server logs only.
 */

import { NextResponse } from 'next/server';
import { verifyWebhookSignature, parseStoreEvent } from '../../../../packages/adapters/revenuecat.js';
import { rpc, envConfig } from '../../../../packages/db/supabase-client.js';
import { dedup, markProcessed } from '../../../../lib/providerCompletion.js';
import { withDeliveryLog } from '../../../../lib/webhookDelivery.js';
import { limitRequestBody } from '../../../../lib/requestBodyLimit.js';
import { storeBillingEnabled, storeSandboxAllowed } from '../../../../lib/storeBilling.js';

const SOURCE = 'billing:revenuecat';
const LOG = '[revenuecat-webhook]';
// Verdicts that will never change on retry: record them and answer 200.
const FINAL_PURCHASE = new Set(['CUSTOMER_NOT_FOUND', 'PACK_NOT_FOUND', 'ORDER_ALREADY_USED', 'BAD_CHANNEL', 'INVALID_TRANSACTION_ID', 'INVALID_PRODUCT']);

async function handler(req) {
    if (!storeBillingEnabled()) return NextResponse.json({ error: 'not_found' }, { status: 404 });
    const cfg = envConfig();
    const secret = process.env.REVENUECAT_WEBHOOK_SECRET;
    if (!cfg.supabaseUrl || !cfg.serviceRoleKey || !secret) {
        return NextResponse.json({ error: 'not_configured' }, { status: 503 });
    }

    const limited = await limitRequestBody(req);
    if (limited.response) return limited.response;
    const raw = new Uint8Array(await limited.request.arrayBuffer());
    let verified;
    try {
        verified = await verifyWebhookSignature(raw, req.headers.get('x-revenuecat-webhook-signature'), secret);
    } catch (err) {
        console.error(LOG, 'verify threw:', err && err.name);
        return NextResponse.json({ error: 'internal' }, { status: 500 });
    }
    if (!verified) {
        console.error(LOG, 'invalid signature');
        return NextResponse.json({ error: 'invalid_signature' }, { status: 401 });
    }

    let body;
    try {
        body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw));
    } catch {
        return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
    }
    const parsed = parseStoreEvent(body);
    if (parsed.kind === 'ignore') return NextResponse.json({ ok: true, ignored: true });
    if (parsed.sandbox && !storeSandboxAllowed()) {
        console.error(LOG, 'sandbox event ignored:', parsed.eventId);
        return NextResponse.json({ ok: true, ignored: true });
    }

    try {
        const seen = await dedup(cfg, SOURCE, parsed.eventId, { type: parsed.kind });
        if (seen === 'duplicate') return NextResponse.json({ ok: true, duplicate: true });
        return parsed.kind === 'purchase' ? await creditPurchase(cfg, parsed) : await applyRefund(cfg, parsed);
    } catch (err) {
        console.error(LOG, 'processing failed:', err && (err.status ?? err.message));
        return NextResponse.json({ error: 'internal' }, { status: 500 });
    }
}

async function creditPurchase(cfg, p) {
    // app_user_id is the one we told the app to use; original_app_user_id covers a customer RevenueCat merged.
    let last = null;
    for (const customerId of p.customerIds) {
        const res = await rpc('credit_store_purchase', {
            p_rc_customer_id: customerId, p_channel: p.channel, p_store_product_id: p.productId, p_transaction_id: p.transactionId,
        }, cfg);
        if (res && res.ok === true) {
            await markProcessed(cfg, SOURCE, p.eventId);
            return NextResponse.json({ ok: true, ...(res.idempotent ? { duplicate: true } : {}) });
        }
        last = res;
        if (!res || res.code !== 'CUSTOMER_NOT_FOUND') break;
    }
    const code = last && last.code;
    if (code && FINAL_PURCHASE.has(code)) {
        // Money was taken and nothing was credited: an operator needs to see this.
        console.error(LOG, 'purchase not credited:', code, p.eventId, p.channel, p.productId);
        await markProcessed(cfg, SOURCE, p.eventId);
        return NextResponse.json({ ok: true, warn: code.toLowerCase() });
    }
    console.error(LOG, 'credit_store_purchase gave no usable verdict:', p.eventId, code);
    return NextResponse.json({ error: 'internal' }, { status: 500 });
}

async function applyRefund(cfg, p) {
    const res = await rpc('apply_store_refund', { p_channel: p.channel, p_transaction_id: p.transactionId }, cfg);
    if (res && res.ok === true) {
        await markProcessed(cfg, SOURCE, p.eventId);
        return NextResponse.json({ ok: true, ...(res.flagged ? { warn: 'flagged' } : {}) });
    }
    if (res && res.code === 'ORDER_NOT_FOUND') {
        // A cancellation of something we never credited (not a Credit Pack).
        await markProcessed(cfg, SOURCE, p.eventId);
        return NextResponse.json({ ok: true, ignored: true });
    }
    console.error(LOG, 'apply_store_refund gave no usable verdict:', p.eventId, res && res.code);
    return NextResponse.json({ error: 'internal' }, { status: 500 });
}

export const POST = withDeliveryLog('revenuecat', handler);
