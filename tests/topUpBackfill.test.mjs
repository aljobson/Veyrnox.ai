import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { backfillVerdict, runBackfill } from '../lib/topUpBackfill.js';

const TOP_UP = '0b6f3c1e-8d2a-4f5b-9c7e-1a2b3c4d5e6f';
const SESSION = 'cs_test_' + 'a'.repeat(64);
const SECRET = 'whsec_test_only';
const row = { top_up_id: TOP_UP, order_id: SESSION, order_identifier: null };
const opts = { expectLiveMode: false, signingSecret: SECRET };
function session(over = {}) {
    return { id: SESSION, object: 'checkout.session', client_reference_id: TOP_UP,
        metadata: { top_up_id: TOP_UP, top_up_sig: createHmac('sha256', SECRET).update(`top_up:${TOP_UP}`).digest('hex') },
        livemode: false, payment_status: 'paid', payment_intent: 'pi_test_1', amount_subtotal: 2500,
        amount_total: 3000, currency: 'usd', ...over };
}
function harness(over = {}) {
    const credits = [], closed = [], fetched = [];
    const deps = { ...opts, budgetMs: 20000, spacingMs: 0, log: () => {},
        fetchSession: async (id) => { fetched.push(id); return { ok: true, session: session() }; },
        credit: async (args) => { credits.push(args); return { ok: true }; },
        close: async (r) => { closed.push(r); return { ok: true }; }, ...over };
    return { deps, credits, closed, fetched };
}

test('a signed paid session credits its PaymentIntent with pre-tax amount and USD', async () => {
    assert.deepEqual(await backfillVerdict(row, session(), opts), { credit: {
        p_top_up_id: TOP_UP, p_order_id: 'pi_test_1', p_paid_usd_cents: 2500, p_currency: 'USD', p_variant_id: null,
    } });
});

test('missing, forged, cross-Top-up, cross-mode and malformed provider facts never reach credit', async () => {
    for (const patch of [
        { id: 'cs_different' }, { object: 'wrong' }, { client_reference_id: 'other' }, { client_reference_id: undefined },
        { metadata: { top_up_id: 'other', top_up_sig: 'a'.repeat(64) } }, { metadata: {} },
        { metadata: { ...session().metadata, top_up_sig: 'a'.repeat(64) } },
        { livemode: true }, { livemode: undefined }, { payment_status: 'unpaid' }, { payment_status: 'no_payment_required' },
        { payment_intent: null }, { payment_intent: { id: 'pi_1' } }, { payment_intent: SESSION },
        { payment_intent: 'pi_' + 'a'.repeat(62) }, { amount_subtotal: null }, { amount_subtotal: 0 },
        { amount_subtotal: 1.5 }, { amount_total: 2400 }, { amount_total: null }, { currency: null }, { currency: 'US' },
    ]) {
        const h = harness({ fetchSession: async () => ({ ok: true, session: session(patch) }) });
        await runBackfill([row], h.deps);
        assert.equal(h.credits.length, 0, JSON.stringify(patch));
    }
});

test('valid but mismatched money goes to the atomic RPC for durable flagging, not a grant in JS', async () => {
    const v = await backfillVerdict(row, session({ amount_subtotal: 2000, currency: 'eur' }), opts);
    assert.equal(v.credit.p_paid_usd_cents, 2000);
    assert.equal(v.credit.p_currency, 'EUR');
});

test('success and idempotent webhook races both close by Session id with NULL identifier', async () => {
    for (const idempotent of [false, true]) {
        const h = harness({ credit: async () => ({ ok: true, idempotent }) });
        const out = await runBackfill([row], h.deps);
        assert.equal(out[idempotent ? 'idempotent' : 'credited'], 1);
        assert.deepEqual(h.closed, [row]);
        assert.deepEqual(h.fetched, [SESSION]);
    }
});

test('all durable flags and final refusals close the return', async () => {
    for (const code of ['ALREADY_CREDITED', 'VARIANT_MISMATCH', 'AMOUNT_MISMATCH', 'CURRENCY_MISMATCH', 'TOP_UP_NOT_FOUND', 'ORDER_ALREADY_USED', 'INVALID_ORDER_ID']) {
        const flagged = ['ALREADY_CREDITED', 'VARIANT_MISMATCH', 'AMOUNT_MISMATCH', 'CURRENCY_MISMATCH'].includes(code);
        const h = harness({ credit: async () => ({ ok: false, code, flagged }) });
        const out = await runBackfill([row], h.deps);
        assert.equal(out[flagged ? 'flagged' : 'refused'], 1, code);
        assert.equal(h.closed.length, 1, code);
    }
});

test('unknown or non-durable database verdicts stay open', async () => {
    for (const result of [null, {}, { ok: false, code: 'UNKNOWN' }, { ok: false, code: 'AMOUNT_MISMATCH' }]) {
        const h = harness({ credit: async () => result });
        const out = await runBackfill([row], h.deps);
        assert.equal(out.retry, 1);
        assert.equal(h.closed.length, 0);
    }
    const h = harness({ credit: async () => { throw new Error('db unavailable'); } });
    assert.equal((await runBackfill([row], h.deps)).retry, 1);
    assert.equal(h.closed.length, 0);
});

test('fetch failures retry; rate limiting stops the batch; only a 404 closes', async () => {
    for (const error of ['stripe 401', 'stripe 403', 'stripe 500', 'stripe 200', 'transport: timeout']) {
        const h = harness({ fetchSession: async () => ({ ok: false, error }) });
        assert.equal((await runBackfill([row], h.deps)).retry, 1, error);
        assert.equal(h.closed.length, 0);
    }
    const limited = harness({ fetchSession: async () => ({ ok: false, error: 'stripe 429' }) });
    const out = await runBackfill([row, row], limited.deps);
    assert.equal(out.stopped, 'rate_limited'); assert.equal(out.checked, 1);
    const missing = harness({ fetchSession: async () => ({ ok: false, error: 'stripe 404' }) });
    assert.equal((await runBackfill([row], missing.deps)).skipped, 1);
    assert.equal(missing.closed.length, 1);
    const thrown = harness({ fetchSession: async () => { throw new Error('offline'); } });
    assert.equal((await runBackfill([row], thrown.deps)).retry, 1);
});

test('bad signatures and unpaid sessions stay open for repair and reconciliation', async () => {
    for (const patch of [{ payment_status: 'unpaid' }, { metadata: { ...session().metadata, top_up_sig: 'a'.repeat(64) } }]) {
        const h = harness({ fetchSession: async () => ({ ok: true, session: session(patch) }) });
        assert.equal((await runBackfill([row], h.deps)).retry, 1);
        assert.equal(h.closed.length, 0);
    }
});

test('close failure is retryable after credit; a later attempt can close idempotently', async () => {
    for (const close of [async () => { throw new Error('offline'); }, async () => ({ ok: false, code: 'NOT_CURRENT' })]) {
        const h = harness({ close });
        const out = await runBackfill([row], h.deps);
        assert.equal(out.credited, 1); assert.equal(out.retry, 1);
    }
});

test('legacy and invalid returns never trigger Stripe or credit calls', async () => {
    const h = harness();
    const out = await runBackfill([{ ...row, order_id: '123' }, { ...row, order_identifier: TOP_UP }], h.deps);
    assert.equal(out.skipped, 2);
    assert.equal(h.fetched.length, 0); assert.equal(h.credits.length, 0);
});

test('time budget is checked after spacing, before fetching another session', async () => {
    let clock = 0;
    const h = harness({ now: () => clock, spacingMs: 250, budgetMs: 100,
        sleep: async (ms) => { clock += ms; } });
    const out = await runBackfill([row, row], h.deps);
    assert.equal(out.checked, 1); assert.equal(out.stopped, 'time_budget');
});
