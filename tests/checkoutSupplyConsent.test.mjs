import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

// Next resolves the extensionless `next/server` through its bundler; plain
// Node ESM needs the file name.
register('data:text/javascript,' + encodeURIComponent(
    `export async function resolve(s, c, next) { return next(s === 'next/server' ? 'next/server.js' : s, c); }`,
));

process.env.SUPABASE_URL = 'https://db.test';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-test';
process.env.STRIPE_SECRET_KEY = 'rk_test_x';
process.env.PUBLIC_HOST = 'https://veyrnox.test';

const { POST } = await import('../app/api/v1/checkout/route.js');
const { SUPPLY_CONSENT_VERSION } = await import('../lib/supplyConsent.js');

const PURCHASE_ID = '00000000-0000-4000-8000-000000000001';

function stubUpstream() {
    const calls = [];
    globalThis.fetch = async (url, init) => {
        calls.push({ url: String(url), body: init && init.body });
        if (String(url).includes('/rest/v1/rpc/purchase_create')) {
            return Response.json({ ok: true, purchase_id: PURCHASE_ID, state: 'PENDING', credits: 100, stripe_price_id: 'price_1' });
        }
        return Response.json({ id: 'cs_test_1', url: 'https://checkout.stripe.com/c/pay/cs_test_1' });
    };
    return calls;
}

const checkout = (body) => POST(new Request('https://veyrnox.test/api/v1/checkout', {
    method: 'POST',
    headers: { 'x-veyrnox-auth-id': 'auth-user-1', 'content-type': 'application/json' },
    body: JSON.stringify(body),
}));

const base = { pack_id: 'pack_100', idempotency_key: 'key-00000001' };

test('no purchase or Stripe call without Supply Consent', async () => {
    for (const consent of [undefined, null, '', true, 'supply-consent-1999-01-01']) {
        const calls = stubUpstream();
        const res = await checkout({ ...base, supply_consent_version: consent });
        assert.equal(res.status, 400);
        assert.deepEqual(await res.json(), { error: 'supply_consent_required' });
        assert.equal(calls.length, 0);
    }
});

test('current consent version is recorded on the purchase and checkout opens', async () => {
    const calls = stubUpstream();
    const res = await checkout({ ...base, supply_consent_version: SUPPLY_CONSENT_VERSION });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { url: 'https://checkout.stripe.com/c/pay/cs_test_1' });
    const rpcArgs = JSON.parse(calls[0].body);
    assert.equal(rpcArgs.p_supply_consent_version, SUPPLY_CONSENT_VERSION);
    assert.match(calls[1].url, /api\.stripe\.com\/v1\/checkout\/sessions$/);
});
