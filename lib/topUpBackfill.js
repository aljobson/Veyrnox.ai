/**
 * Top-up backfill (#94, ADR-0018 decision 5): credit paid orders whose
 * webhook never landed.
 *
 * LemonSqueezy's order API carries no custom data and can't be filtered by
 * it, so an order can't be found from a Top-up id. Instead the checkout
 * return URL asks LemonSqueezy for [order_id] and [order_identifier], the
 * return page records both on the buyer's own pending Top-up
 * (record_top_up_return, 0060), and this module checks them against the
 * order re-fetched from the API. The identifier is an unguessable UUID only
 * the buyer sees, so a sequential order id alone can't claim someone else's
 * order.
 *
 * Nothing but the re-fetched order and our top_ups row is trusted. Store,
 * test mode and pre-tax amount go through the webhook's normaliseOrder;
 * variant, amount and currency are checked by credit_top_up, which locks the
 * Top-up row, so racing the webhook grants once.
 *
 * Like the webhook, a refunded or partly refunded order is still credited and
 * its refunded share clawed back (#142). credit_top_up_with_refund (0063)
 * does both in one transaction: once credited, a Top-up leaves the backfill
 * queue, so a clawback that failed separately would never be retried.
 */

import { normaliseOrder, CREDITABLE_ORDER_STATUSES } from '../packages/adapters/lemonsqueezy.js';

const LOG = '[top-up-backfill]';
const FLAGGED = new Set(['ALREADY_CREDITED', 'VARIANT_MISMATCH', 'AMOUNT_MISMATCH', 'CURRENCY_MISMATCH']);
const REFUSED = new Set(['TOP_UP_NOT_FOUND', 'ORDER_ALREADY_USED', 'INVALID_ORDER_ID']);

/**
 * @param {{top_up_id: string, order_id: string, order_identifier: string}} row  from next_top_up_backfill_batch
 * @param {any} order  JSON:API order resource re-fetched from LemonSqueezy
 * @param {{expectTestMode: boolean, expectStoreId: string}} opts
 * @returns {{credit: object} | {skip: string, anomaly: boolean, retry?: boolean}}
 */
export function backfillVerdict(row, order, opts) {
    if (!order || !order.attributes) return { skip: 'malformed order', anomaly: true };
    if (String(order.id) !== String(row.order_id)) return { skip: 'order id mismatch', anomaly: true };

    const norm = normaliseOrder(order, { top_up_id: row.top_up_id }, opts);
    if (!norm.ok) return { skip: norm.error, anomaly: true };

    const identifier = order.attributes.identifier;
    if (typeof identifier !== 'string' || identifier.toLowerCase() !== String(row.order_identifier).toLowerCase()) {
        return { skip: 'identifier mismatch', anomaly: true };
    }

    const o = norm.order;
    if (o.status === 'pending') return { skip: 'order pending', anomaly: false, retry: true };
    if (!CREDITABLE_ORDER_STATUSES.has(o.status)) return { skip: 'order not paid', anomaly: true };

    return {
        credit: {
            p_top_up_id: row.top_up_id,
            p_order_id: o.orderId,
            p_paid_usd_cents: o.paidCents,
            p_currency: o.currency,
            p_variant_id: o.variantId,
            // Refunds are measured against the tax-inclusive total, as in the webhook.
            p_refunded_cents: o.refundedCents,
            p_total_cents: o.totalCents,
        },
    };
}

/**
 * Check one batch, one LemonSqueezy call at a time, within a time budget.
 * Anything transient is left pending for the next run.
 *
 * A row whose check reached a final answer (flagged, refused, not creditable,
 * order not found) is closed through deps.close, so it is not re-fetched on
 * every run. That is how a returned second order on a credited Top-up is
 * flagged exactly once (#143).
 *
 * @param {Array<{top_up_id: string, order_id: string, order_identifier: string}>} rows
 * @param {{fetchOrder: (orderId: string) => Promise<any>, credit: (args: object) => Promise<any>,
 *   close: (row: {top_up_id: string, order_id: string}) => Promise<any>,
 *   expectTestMode: boolean, expectStoreId: string, budgetMs: number, spacingMs: number,
 *   now?: () => number, sleep?: (ms: number) => Promise<void>, log?: (...a: any[]) => void}} deps
 */
export async function runBackfill(rows, deps) {
    const now = deps.now ?? Date.now;
    const sleep = deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    const log = deps.log ?? console.error;
    const opts = { expectTestMode: deps.expectTestMode, expectStoreId: deps.expectStoreId };
    const out = { checked: 0, credited: 0, idempotent: 0, flagged: 0, refused: 0, skipped: 0, retry: 0, stopped: null };
    const started = now();
    const close = async (row) => {
        try {
            await deps.close(row);
        } catch (err) {
            // The row is just checked again after its backoff.
            log(LOG, 'close_top_up_return failed:', err && (err.status ?? err.message), 'top_up', row.top_up_id);
        }
    };

    for (const [i, row] of rows.entries()) {
        if (now() - started >= deps.budgetMs) { out.stopped = 'time_budget'; break; }
        if (i > 0) await sleep(deps.spacingMs);
        out.checked++;

        const fetched = await deps.fetchOrder(row.order_id);
        if (!fetched.ok) {
            if (fetched.error === 'lemonsqueezy 429') { out.retry++; out.stopped = 'rate_limited'; break; }
            if (fetched.transient) { out.retry++; continue; }
            // A 404 or 401: a bogus returned order id, or the other mode's key.
            log(LOG, 'returned order not fetchable:', fetched.error, 'order', row.order_id, 'top_up', row.top_up_id);
            out.skipped++;
            await close(row);
            continue;
        }

        const v = backfillVerdict(row, fetched.order, opts);
        if (v.skip) {
            if (v.retry) out.retry++; else out.skipped++;
            if (v.anomaly) log(LOG, 'order not credited:', v.skip, 'order', row.order_id, 'top_up', row.top_up_id);
            if (!v.retry) await close(row);
            continue;
        }

        let res;
        try {
            res = await deps.credit(v.credit);
        } catch (err) {
            log(LOG, 'credit_top_up_with_refund failed:', err && (err.status ?? err.message), 'top_up', row.top_up_id);
            out.retry++;
            continue;
        }
        if (res && res.ok === true) {
            if (res.idempotent === true) out.idempotent++; else out.credited++;
            const r = res.refund;
            if (r && r.shortfall > 0) log(LOG, 'refund clawback short:', 'order', row.order_id, 'taken', r.taken, 'shortfall', r.shortfall);
            if (r && r.frozen) log(LOG, 'account Frozen on refund after generating:', 'order', row.order_id, 'user', r.user_id);
        } else if (res && FLAGGED.has(res.code)) {
            log(LOG, 'paid order flagged for Operator refund:', res.code, 'order', row.order_id, 'top_up', row.top_up_id);
            out.flagged++;
            await close(row);
        } else if (res && REFUSED.has(res.code)) {
            log(LOG, 'order refused:', res.code, 'order', row.order_id, 'top_up', row.top_up_id);
            out.refused++;
            await close(row);
        } else {
            log(LOG, 'credit_top_up_with_refund gave no usable verdict:', res && res.code, 'top_up', row.top_up_id);
            out.retry++;
        }
    }
    return out;
}
