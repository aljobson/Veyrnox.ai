/**
 * Recover Stripe Top-ups whose webhook was lost (ADR-0033).
 * Only a re-fetched, paid Session with our signed Top-up binding reaches
 * credit_top_up. That RPC locks the row, checks the pre-tax catalog price
 * and currency, and grants once even when the webhook races recovery.
 */
import { verifyTopUpMetadata } from '../packages/adapters/stripe.js';

const LOG = '[top-up-backfill]';
const SESSION_ID_RE = /^cs_[A-Za-z0-9_]{1,251}$/;
// 0097's money-path RPC and table CHECK accept at most 64 characters.
const PAYMENT_INTENT_RE = /^pi_[A-Za-z0-9_]{1,61}$/;
const FLAGGED = new Set(['ALREADY_CREDITED', 'VARIANT_MISMATCH', 'AMOUNT_MISMATCH', 'CURRENCY_MISMATCH']);
const REFUSED = new Set(['TOP_UP_NOT_FOUND', 'ORDER_ALREADY_USED', 'INVALID_ORDER_ID']);

/** Verify the provider fact; the atomic RPC checks the stored price/currency. */
export async function backfillVerdict(row, session, { expectLiveMode, signingSecret }) {
    if (!session || session.object !== 'checkout.session' || session.id !== row.order_id) {
        return { skip: 'session id or shape mismatch', retry: true };
    }
    if (session.livemode !== expectLiveMode) return { skip: 'mode mismatch', retry: true };
    if (session.client_reference_id !== row.top_up_id || session.metadata?.top_up_id !== row.top_up_id) {
        return { skip: 'top-up binding mismatch' };
    }
    // A rotated/misconfigured secret may be repairable. Leave the return open
    // so the 24h reconciliation alarm can expose it instead of hiding it.
    if (!(await verifyTopUpMetadata(session.metadata, signingSecret))) {
        return { skip: 'top-up signature mismatch', retry: true };
    }
    if (session.payment_status !== 'paid') return { skip: 'session not paid', retry: true };
    if (typeof session.payment_intent !== 'string' || !PAYMENT_INTENT_RE.test(session.payment_intent)) {
        return { skip: 'invalid payment intent', retry: true };
    }
    // Managed Payments adds tax: amount_total is not the catalog pack price.
    if (!Number.isSafeInteger(session.amount_subtotal) || session.amount_subtotal <= 0
        || !Number.isSafeInteger(session.amount_total) || session.amount_total < session.amount_subtotal
        || typeof session.currency !== 'string' || !/^[a-zA-Z]{3}$/.test(session.currency)) {
        return { skip: 'invalid session amount or currency', retry: true };
    }
    return { credit: {
        p_top_up_id: row.top_up_id,
        p_order_id: session.payment_intent,
        p_paid_usd_cents: session.amount_subtotal,
        p_currency: session.currency.toUpperCase(),
        p_variant_id: null,
    } };
}

/**
 * Process a bounded batch. Transient failures stay open for the DB backoff;
 * terminal verdicts close using the returned Session id, never the pi_ id.
 * deps: fetchSession, credit, close, signingSecret, expectLiveMode,
 * budgetMs, spacingMs; optional now, sleep and log for tests.
 */
export async function runBackfill(rows, deps) {
    const now = deps.now ?? Date.now;
    const sleep = deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    const log = deps.log ?? console.error;
    const out = { checked: 0, credited: 0, idempotent: 0, flagged: 0, refused: 0, skipped: 0, retry: 0, stopped: null };
    const started = now();
    const close = async (row) => {
        try {
            const res = await deps.close(row);
            if (!res || res.ok !== true) throw new Error('no close verdict');
        } catch {
            // Reprocessing is safe: credit_top_up is idempotent on the pi_ id.
            log(LOG, 'close_top_up_return failed:', 'top_up', row.top_up_id);
            out.retry++;
        }
    };

    for (const [i, row] of rows.entries()) {
        if (i > 0) await sleep(deps.spacingMs);
        if (now() - started >= deps.budgetMs) { out.stopped = 'time_budget'; break; }
        out.checked++;
        if (typeof row.order_id !== 'string' || !SESSION_ID_RE.test(row.order_id) || row.order_identifier != null) {
            log(LOG, 'unsupported return shape:', 'top_up', row.top_up_id);
            out.skipped++;
            continue;
        }

        let fetched;
        try { fetched = await deps.fetchSession(row.order_id); } catch { fetched = { ok: false }; }
        if (!fetched?.ok) {
            if (fetched?.error === 'stripe 404') {
                out.skipped++;
                await close(row);
            } else {
                // Authentication, transport, 5xx and malformed responses may
                // be fixable; never close them and suppress the alarm.
                out.retry++;
                log(LOG, 'session fetch failed:', 'top_up', row.top_up_id);
                if (fetched?.error === 'stripe 429') { out.stopped = 'rate_limited'; break; }
            }
            continue;
        }

        let v;
        try { v = await backfillVerdict(row, fetched.session, deps); } catch {
            out.retry++;
            log(LOG, 'session verification failed:', 'top_up', row.top_up_id);
            continue;
        }
        if (v.skip) {
            if (v.retry) out.retry++; else out.skipped++;
            log(LOG, 'session not credited:', v.skip, 'top_up', row.top_up_id);
            if (!v.retry) await close(row);
            continue;
        }

        let res;
        try { res = await deps.credit(v.credit); } catch {
            log(LOG, 'credit_top_up failed:', 'top_up', row.top_up_id);
            out.retry++;
            continue;
        }
        if (res?.ok === true) {
            if (res.idempotent === true) out.idempotent++; else out.credited++;
            // cs_ and pi_ differ even after a successful credit, so queue
            // membership alone does not stop future attempts (0108).
            await close(row);
        } else if (res?.ok === false && FLAGGED.has(res.code) && res.flagged === true) {
            log(LOG, 'paid order flagged for Operator refund:', res.code, 'top_up', row.top_up_id);
            out.flagged++;
            await close(row);
        } else if (res?.ok === false && REFUSED.has(res.code)) {
            log(LOG, 'order refused:', res.code, 'top_up', row.top_up_id);
            out.refused++;
            await close(row);
        } else {
            log(LOG, 'credit_top_up gave no usable verdict:', 'top_up', row.top_up_id);
            out.retry++;
        }
    }
    return out;
}
