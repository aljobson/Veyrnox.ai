import test from 'node:test';
import assert from 'node:assert/strict';

const { priceProblems } = await import('../scripts/set-credit-pack-price.mjs');

const good = {
    object: 'price',
    active: true,
    type: 'one_time',
    currency: 'usd',
    unit_amount: 1000,
    tax_behavior: 'exclusive',
    product: { object: 'product', tax_code: 'txcd_10105001' },
};

test('a one-time, USD, tax-exclusive AI-service price is accepted', () => {
    assert.deepEqual(priceProblems(good), []);
});

test('each unsellable property is reported', () => {
    const cases = [
        [{ active: false }, /archived/],
        [{ type: 'recurring' }, /one_time/],
        [{ currency: 'gbp' }, /usd/],
        [{ unit_amount: null }, /positive integer/],
        [{ unit_amount: 0 }, /positive integer/],
        [{ tax_behavior: 'inclusive' }, /exclusive/],
        [{ tax_behavior: 'unspecified' }, /exclusive/],
        [{ product: { tax_code: 'txcd_10000000' } }, /txcd_10105001/],
        [{ product: 'prod_unexpanded' }, /txcd_10105001/],
    ];
    for (const [override, message] of cases) {
        const problems = priceProblems({ ...good, ...override });
        assert.equal(problems.length, 1, JSON.stringify(override));
        assert.match(problems[0], message);
    }
});

test('something that is not a Price is refused outright', () => {
    assert.deepEqual(priceProblems({ object: 'product' }), ['not a Stripe Price']);
    assert.deepEqual(priceProblems(null), ['not a Stripe Price']);
});
