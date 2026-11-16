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
test('active saleable products are exactly the post-0549 catalog in each store', () => {
    for (const store of ['ios', 'android']) {
        const expected = [156, 392, 1177].map(n => `ai.veyrnox.credits.${n}`);
        const product = id => store === 'android' ? `${id}:${id.split('.').at(-1)}` : id;
        expected.push(...['weekly', 'monthly', 'annual'].map(c => product(`ai.veyrnox.publish.${c}`)));
        expected.push(...['lite', 'starter', 'plus'].flatMap(f => ['monthly', 'annual'].map(c => product(`ai.veyrnox.generation.${f}.${c}`))));
        assert.deepEqual(catalog.filter(p => p.store === store).map(p => p.productId).sort(), expected.sort());
    }
});
test('migration prices, 0407 price points and latest credit amendments survive catalog extraction', () => {
    const ios = catalog.filter(p => p.store === 'ios');
    assert.deepEqual(ios.filter(p => p.offering === 'credits').map(p => [p.credits, p.priceUsdCents]).sort((a,b) => a[0]-b[0]), [[156,999],[392,2499],[1177,7499]]);
    assert.deepEqual(ios.filter(p => p.offering === 'publish').map(p => p.priceUsdCents).sort((a,b)=>a-b), [499,1500,12600]);
    assert.deepEqual(ios.filter(p => p.offering === 'generation').map(p => [p.plan,p.priceUsdCents,p.credits]).sort(), [
        ['lite-monthly',1000,157],['lite-yearly',9699,157],['plus-monthly',5900,924],['plus-yearly',56900,924],
        ['starter-monthly',1900,297],['starter-yearly',18299,297],
    ].sort());
    assert.match(catalogMarkdown(), /\$24\.99/);
});
test('every saleable identifier is understood by the adapter', () => {
    for (const row of catalog) assert.notEqual(parseStoreEvent(event(row.productId, row.store, row.kind !== 'consumable')).kind, 'ignore', row.productId);
});
test('neither store offers Ultra, while settlement still recognizes its identifiers', () => {
    assert.ok(!catalog.some(p => p.plan?.startsWith('ultra-')));
    for (const store of ['ios', 'android']) {
        assert.equal(catalog.filter(p => p.store === store && p.offering === 'generation').length, 6);
        const id = 'ai.veyrnox.generation.ultra.monthly' + (store === 'android' ? ':monthly' : '');
        assert.equal(parseStoreEvent(event(id, store, true)).kind, 'subscription');
    }
});
test('the old pack sizes are no longer offered but still settle', () => {
    for (const n of [209, 523, 1571]) {
        const id = `ai.veyrnox.credits.${n}`;
        assert.ok(!catalog.some(p => p.productId === id), id);
        assert.equal(parseStoreEvent(event(id, 'ios')).kind, 'purchase', id);
    }
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
