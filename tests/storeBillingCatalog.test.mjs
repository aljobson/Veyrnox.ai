import test from 'node:test';
import assert from 'node:assert/strict';
import { storeBillingCatalog, catalogMarkdown } from '../scripts/store-billing-catalog.mjs';
import { parseStoreEvent } from '../packages/adapters/revenuecat.js';
const catalog = storeBillingCatalog();
const event = (productId, store, subscription = false) => ({ event: {
    id: 'catalog-test-event', type: subscription ? 'INITIAL_PURCHASE' : 'NON_RENEWING_PURCHASE',
    product_id: productId, transaction_id: 'catalog-transaction', original_transaction_id: 'catalog-original',
    app_user_id: '11111111-1111-4111-8111-111111111111', store: store === 'ios' ? 'APP_STORE' : 'PLAY_STORE',
    environment: 'PRODUCTION', purchased_at_ms: 1793232000000, event_timestamp_ms: 1793232000000,
    expiration_at_ms: 1795910400000,
} });
test('active saleable products are exactly the post-0394 catalog in each store', () => {
    for (const store of ['ios', 'android']) {
        const expected = [209, 523, 1571].map(n => `ai.veyrnox.credits.${n}`);
        const product = id => store === 'android' ? `${id}:${id.split('.').at(-1)}` : id;
        expected.push(...['weekly', 'monthly', 'annual'].map(c => product(`ai.veyrnox.publish.${c}`)));
        expected.push(...['lite', 'starter', 'plus', 'ultra'].flatMap(f => ['monthly', 'annual'].map(c => product(`ai.veyrnox.generation.${f}.${c}`)))
            // 0407: Ultra yearly is above the App Store maximum, so iOS does not sell it.
            .filter(id => store === 'android' || id !== 'ai.veyrnox.generation.ultra.annual'));
        assert.deepEqual(catalog.filter(p => p.store === store).map(p => p.productId).sort(), expected.sort());
    }
});
test('migration prices, 0407 price points and latest credit amendments survive catalog extraction', () => {
    const ios = catalog.filter(p => p.store === 'ios');
    assert.deepEqual(ios.filter(p => p.offering === 'credits').map(p => [p.credits, p.priceUsdCents]).sort((a,b) => a[0]-b[0]), [[209,1099],[523,2699],[1571,8999]]);
    assert.deepEqual(ios.filter(p => p.offering === 'publish').map(p => p.priceUsdCents).sort((a,b)=>a-b), [499,1500,12600]);
    assert.deepEqual(ios.filter(p => p.offering === 'generation').map(p => [p.plan,p.priceUsdCents,p.credits]).sort(), [
        ['lite-monthly',1000,209],['lite-yearly',10899,209],['plus-monthly',5900,1171],['plus-yearly',60900,1171],
        ['starter-monthly',1900,398],['starter-yearly',20900,398],['ultra-monthly',12900,2411],
    ].sort());
    assert.match(catalogMarkdown(), /\$26\.99/);
});
test('every saleable identifier is understood by the adapter', () => {
    for (const row of catalog) assert.notEqual(parseStoreEvent(event(row.productId, row.store, row.kind !== 'consumable')).kind, 'ignore', row.productId);
});
test('retired products remain accepted for purchases and refunds but are not offered', () => {
    for (const store of ['ios', 'android']) {
        const id = 'ai.veyrnox.credits.270';
        assert.ok(!catalog.some(p => p.productId === id));
        const body = event(id, store);
        assert.equal(parseStoreEvent(body).kind, 'purchase');
        body.event.type = 'CANCELLATION'; body.event.cancel_reason = 'CUSTOMER_SUPPORT';
        assert.equal(parseStoreEvent(body).kind, 'refund');
    }
});
