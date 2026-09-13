import test from 'node:test';
import assert from 'node:assert/strict';
import { backfillVerdict, runBackfill } from '../lib/topUpBackfill.js';

const TOP_UP_ID = '0b6f3c1e-8d2a-4f5b-9c7e-1a2b3c4d5e6f';
const IDENTIFIER = '104e18a2-d755-4d4b-80c4-a6c1dcbe1c10';
const opts = { expectTestMode: true, expectStoreId: '473468' };

const row = (over = {}) => ({ top_up_id: TOP_UP_ID, order_id: '1234', order_identifier: IDENTIFIER, ...over });

function order(over = {}, itemOver = {}) {
    return {
        type: 'orders',
        id: '1234',
        attributes: {
            store_id: 473468,
            identifier: IDENTIFIER,
            currency: 'USD',
            subtotal: 2500,
            discount_total: 0,
            tax: 500,
            total: 3000,
            status: 'paid',
            refunded_amount: 0,
            test_mode: true,
            first_order_item: { variant_id: 2120823, test_mode: true, ...itemOver },
            ...over,
        },
    };
}

test('a paid order matching the returned identifier is credited to our Top-up row', () => {
    const v = backfillVerdict(row(), order(), opts);
    assert.deepEqual(v, {
        credit: {
            p_top_up_id: TOP_UP_ID,
            p_order_id: '1234',
            p_paid_usd_cents: 2500,
            p_currency: 'USD',
            p_variant_id: '2120823',
            p_refunded_cents: 0,
            p_total_cents: 3000,
        },
    });
});

test('the identifier comparison ignores case but nothing else', () => {
    assert.ok(backfillVerdict(row(), order({ identifier: IDENTIFIER.toUpperCase() }), opts).credit);
    const v = backfillVerdict(row(), order({ identifier: '204e18a2-d755-4d4b-80c4-a6c1dcbe1c10' }), opts);
    assert.equal(v.credit, undefined);
    assert.equal(v.skip, 'identifier mismatch');
    assert.equal(v.anomaly, true);
});

test('an order without an identifier is never credited', () => {
    for (const identifier of [undefined, null, '', 42]) {
        const v = backfillVerdict(row(), order({ identifier }), opts);
        assert.equal(v.skip, 'identifier mismatch');
    }
});

test('a returned order id that differs from the fetched order is refused', () => {
    const v = backfillVerdict(row({ order_id: '9999' }), order(), opts);
    assert.equal(v.skip, 'order id mismatch');
    assert.equal(v.anomaly, true);
});

test('store and test-mode checks match the webhook', () => {
    assert.equal(backfillVerdict(row(), order({ store_id: 1 }), opts).skip, 'store mismatch');
    assert.equal(backfillVerdict(row(), order({ test_mode: false }, { test_mode: false }), opts).skip, 'test_mode mismatch');
    // Either flag set makes it a test order: never credited in live mode.
    const live = { ...opts, expectTestMode: false };
    assert.equal(backfillVerdict(row(), order({ test_mode: false }, { test_mode: true }), live).skip, 'test_mode mismatch');
    assert.ok(backfillVerdict(row(), order({ test_mode: false }, { test_mode: false }), live).credit);
});

test('variant, amount and currency travel from the order to credit_top_up, which checks them', () => {
    const v = backfillVerdict(row(), order({ subtotal: 3000, discount_total: 500, currency: 'EUR' }, { variant_id: 7 }), opts);
    assert.equal(v.credit.p_paid_usd_cents, 2500, 'pre-tax, net of discount, as the webhook computes it');
    assert.equal(v.credit.p_currency, 'EUR');
    assert.equal(v.credit.p_variant_id, '7');
});

test('a still-pending order is retried next run; a failed or fraudulent one is an anomaly', () => {
    assert.deepEqual(backfillVerdict(row(), order({ status: 'pending' }), opts), { skip: 'order pending', anomaly: false, retry: true });
    for (const status of ['failed', 'fraudulent']) {
        const v = backfillVerdict(row(), order({ status }), opts);
        assert.equal(v.skip, 'order not paid');
        assert.equal(v.anomaly, true);
    }
});

// #142: the webhook credits a refunded or partly refunded order, then claws
// back the refunded share. The backfill must do the same, or a lost
// order_created leaves the buyer without the credits they kept.
test('refunded and partly refunded orders are credited with the refunded amount for the clawback', () => {
    for (const [status, refunded] of [['partial_refund', 1500], ['refunded', 3000]]) {
        const v = backfillVerdict(row(), order({ status, refunded_amount: refunded }), opts);
        assert.ok(v.credit, status);
        assert.equal(v.credit.p_refunded_cents, refunded);
        assert.equal(v.credit.p_total_cents, 3000, 'refunds are measured against the tax-inclusive total');
    }
});

test('the backfill credits exactly the statuses the webhook credits', async () => {
    const { CREDITABLE_ORDER_STATUSES } = await import('../packages/adapters/lemonsqueezy.js');
    assert.deepEqual([...CREDITABLE_ORDER_STATUSES].sort(), ['paid', 'partial_refund', 'refunded']);
    for (const status of ['paid', 'partial_refund', 'refunded']) {
        assert.ok(backfillVerdict(row(), order({ status }), opts).credit, status);
    }
});

test('a malformed order is refused', () => {
    assert.equal(backfillVerdict(row(), { id: '1234', attributes: {} }, opts).skip, 'malformed order');
    assert.equal(backfillVerdict(row(), null, opts).skip, 'malformed order');
});

// --- runBackfill -----------------------------------------------------------

function harness({ orders = {}, credit = async () => ({ ok: true, idempotent: false }), budgetMs = 60000 } = {}) {
    const fetched = [];
    const credited = [];
    const sleeps = [];
    const errors = [];
    const closed = [];
    let clock = 0;
    const deps = {
        ...opts,
        budgetMs,
        spacingMs: 250,
        now: () => clock,
        sleep: async (ms) => { sleeps.push(ms); clock += ms; },
        fetchOrder: async (id) => {
            fetched.push(id);
            clock += 100;
            const o = orders[id];
            return typeof o === 'function' ? o() : o;
        },
        credit: async (args) => { credited.push(args); return credit(args); },
        close: async (r) => { closed.push(r.order_id); return { ok: true }; },
        // runBackfill passes the whole row: close_top_up_return matches id and identifier.
        log: (...a) => errors.push(a.join(' ')),
    };
    return { deps, fetched, credited, sleeps, errors, closed, advance: (ms) => { clock += ms; } };
}

const ok = (o) => ({ ok: true, order: o });

test('credits each due row once, spacing LemonSqueezy calls', async () => {
    const rows = [row(), row({ top_up_id: '1b6f3c1e-8d2a-4f5b-9c7e-1a2b3c4d5e6f', order_id: '5678' })];
    const h = harness({ orders: { 1234: ok(order()), 5678: ok({ ...order(), id: '5678' }) } });
    const res = await runBackfill(rows, h.deps);
    assert.deepEqual(h.fetched, ['1234', '5678']);
    assert.equal(h.credited.length, 2);
    assert.deepEqual(h.sleeps, [250], 'a pause between calls, none before the first');
    assert.equal(res.checked, 2);
    assert.equal(res.credited, 2);
    assert.equal(res.stopped, null);
});

test('the webhook winning the race is counted as idempotent, not credited', async () => {
    const h = harness({ orders: { 1234: ok(order()) }, credit: async () => ({ ok: true, idempotent: true }) });
    const res = await runBackfill([row()], h.deps);
    assert.equal(res.credited, 0);
    assert.equal(res.idempotent, 1);
    assert.equal(h.errors.length, 0);
});

test('flagged and refused verdicts are logged as anomalies', async () => {
    const codes = [{ ok: false, code: 'ALREADY_CREDITED', flagged: true }, { ok: false, code: 'ORDER_ALREADY_USED' }];
    const h = harness({ orders: { 1234: ok(order()) }, credit: async () => codes.shift() });
    const res = await runBackfill([row(), row()], h.deps);
    assert.equal(res.flagged, 1);
    assert.equal(res.refused, 1);
    assert.equal(h.errors.length, 2);
    assert.match(h.errors[0], /ALREADY_CREDITED/);
});

test('an unexpected credit_top_up verdict or a database error is retried next run and logged', async () => {
    const verdicts = [async () => ({ ok: false, code: 'SOMETHING_NEW' }), async () => { throw Object.assign(new Error('rpc'), { status: 503 }); }];
    const h = harness({ orders: { 1234: ok(order()) }, credit: () => verdicts.shift()() });
    const res = await runBackfill([row(), row()], h.deps);
    assert.equal(res.retry, 2);
    assert.equal(h.errors.length, 2);
});

test('a transient fetch failure is retried next run without an anomaly log', async () => {
    const h = harness({ orders: { 1234: { ok: false, error: 'lemonsqueezy 503', transient: true } } });
    const res = await runBackfill([row()], h.deps);
    assert.equal(res.retry, 1);
    assert.equal(h.credited.length, 0);
    assert.equal(h.errors.length, 0);
});

test('a 404 for the returned order id is an anomaly, nothing credited', async () => {
    const h = harness({ orders: { 1234: { ok: false, error: 'lemonsqueezy 404', transient: false } } });
    const res = await runBackfill([row()], h.deps);
    assert.equal(res.skipped, 1);
    assert.equal(h.credited.length, 0);
    assert.equal(h.errors.length, 1);
});

test('LemonSqueezy rate limiting stops the run', async () => {
    const h = harness({ orders: { 1234: { ok: false, error: 'lemonsqueezy 429', transient: true }, 5678: ok(order()) } });
    const res = await runBackfill([row(), row({ order_id: '5678' })], h.deps);
    assert.deepEqual(h.fetched, ['1234']);
    assert.equal(res.stopped, 'rate_limited');
    assert.equal(res.retry, 1);
});

test('the time budget stops the run before the next call', async () => {
    const rows = Array.from({ length: 10 }, () => row());
    const h = harness({ orders: { 1234: ok(order()) }, budgetMs: 1000 });
    const res = await runBackfill(rows, h.deps);
    assert.equal(res.stopped, 'time_budget');
    assert.ok(h.fetched.length < rows.length);
    assert.equal(res.checked, h.fetched.length);
});

test('a clawback shortfall or an inferred Freeze from the refund is logged', async () => {
    const h = harness({
        orders: { 1234: ok(order({ status: 'partial_refund', refunded_amount: 1500 })) },
        credit: async () => ({ ok: true, idempotent: false, refund: { ok: true, taken: 100, shortfall: 50, frozen: true } }),
    });
    const res = await runBackfill([row()], h.deps);
    assert.equal(res.credited, 1);
    assert.equal(h.credited[0].p_refunded_cents, 1500);
    assert.ok(h.errors.some((e) => /shortfall/.test(e)));
    assert.ok(h.errors.some((e) => /Frozen/.test(e)));
});

test('a skipped verdict never reaches credit_top_up', async () => {
    const h = harness({ orders: { 1234: ok(order({ identifier: '204e18a2-d755-4d4b-80c4-a6c1dcbe1c10' })) } });
    const res = await runBackfill([row()], h.deps);
    assert.equal(h.credited.length, 0);
    assert.equal(res.skipped, 1);
    assert.equal(h.errors.length, 1);
});

// #143: a row whose check reached a final answer is closed, so the backfill
// stops re-fetching it; anything that might still change is left open.
test('final outcomes close the row: flagged, refused, not creditable, not found', async () => {
    const verdicts = [{ ok: false, code: 'ALREADY_CREDITED', flagged: true }, { ok: false, code: 'ORDER_ALREADY_USED' }];
    const h = harness({
        orders: {
            1: ok({ ...order(), id: '1' }),
            2: ok({ ...order(), id: '2' }),
            3: ok({ ...order({ identifier: '204e18a2-d755-4d4b-80c4-a6c1dcbe1c10' }), id: '3' }),
            4: ok({ ...order({ status: 'failed' }), id: '4' }),
            5: { ok: false, error: 'lemonsqueezy 404', transient: false },
        },
        credit: async () => verdicts.shift(),
    });
    await runBackfill(['1', '2', '3', '4', '5'].map((id) => row({ order_id: id })), h.deps);
    assert.deepEqual(h.closed, ['1', '2', '3', '4', '5']);
});

test('the close is given the order id and identifier that were checked', async () => {
    const h = harness({ orders: { 1234: ok(order({ status: 'failed' })) } });
    const seen = [];
    h.deps.close = async (r) => { seen.push(r); return { ok: true }; };
    await runBackfill([row()], h.deps);
    assert.deepEqual(seen, [row()]);
});

test('outcomes that may still change leave the row open, including a 401 or 403 (our key or config)', async () => {
    const verdicts = [
        async () => ({ ok: true, idempotent: false }),
        async () => { throw new Error('db down'); },
        async () => ({ ok: false, code: 'SOMETHING_NEW' }),
    ];
    const h = harness({
        orders: {
            1: ok({ ...order(), id: '1' }),
            2: ok({ ...order(), id: '2' }),
            3: ok({ ...order(), id: '3' }),
            4: ok({ ...order({ status: 'pending' }), id: '4' }),
            5: { ok: false, error: 'lemonsqueezy 503', transient: true },
            7: { ok: false, error: 'lemonsqueezy 401', transient: false },
            8: { ok: false, error: 'lemonsqueezy 403', transient: false },
            6: { ok: false, error: 'lemonsqueezy 429', transient: true },
        },
        credit: () => verdicts.shift()(),
    });
    await runBackfill(['1', '2', '3', '4', '5', '7', '8', '6'].map((id) => row({ order_id: id })), h.deps);
    assert.deepEqual(h.closed, [], 'credited rows leave the batch on their own; the rest are retried');
});

test('a failed close is logged and the run carries on', async () => {
    const h = harness({ orders: { 1234: ok(order({ status: 'failed' })) } });
    h.deps.close = async () => { throw new Error('rpc down'); };
    const res = await runBackfill([row(), row()], h.deps);
    assert.equal(res.checked, 2);
    assert.ok(h.errors.some((e) => /close_top_up_return failed/.test(e)));
});
