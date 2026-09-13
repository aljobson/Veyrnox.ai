import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

// Next resolves the extensionless `next/server` through its bundler; plain
// Node ESM needs the file name.
register('data:text/javascript,' + encodeURIComponent(
    `export async function resolve(s, c, next) { return next(s === 'next/server' ? 'next/server.js' : s, c); }`,
));

const SECRET = 'whsec_test_refunds';
process.env.SUPABASE_URL = 'https://db.test';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-test';
process.env.STRIPE_WEBHOOK_SECRET = SECRET;

const { POST } = await import('../app/api/webhook/stripe/route.js');

const enc = new TextEncoder();
let seq = 0;

async function signedRequest(type, object) {
    const body = JSON.stringify({ id: `evt_test${++seq}`, type, created: Math.floor(Date.now() / 1000), data: { object } });
    const t = Math.floor(Date.now() / 1000);
    const key = await crypto.subtle.importKey('raw', enc.encode(SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const mac = await crypto.subtle.sign('HMAC', key, enc.encode(`${t}.${body}`));
    const v1 = Array.from(new Uint8Array(mac), (b) => b.toString(16).padStart(2, '0')).join('');
    return new Request('https://veyrnox.test/api/webhook/stripe', {
        method: 'POST',
        headers: { 'stripe-signature': `t=${t},v1=${v1}` },
        body,
    });
}

function stubDb() {
    const rpcCalls = [];
    globalThis.fetch = async (url, init) => {
        const u = String(url);
        if (u.includes('/rest/v1/rpc/')) {
            rpcCalls.push({ name: u.split('/rpc/')[1], args: JSON.parse(init.body) });
            return Response.json({ ok: true, idempotent: false, taken: 30, shortfall: 0 });
        }
        if (init && init.method === 'POST') return Response.json([{ id: 'row' }], { status: 201 }); // dedup insert
        return new Response(null, { status: 204 }); // processed_at patch
    };
    return rpcCalls;
}

test('a partial refund claws back with the cumulative refunded amount', async () => {
    const rpcCalls = stubDb();
    const res = await POST(await signedRequest('charge.refunded', {
        id: 'ch_1', payment_intent: 'pi_1', amount: 1000, amount_refunded: 300, refunded: false,
    }));
    assert.equal(res.status, 200);
    assert.deepEqual(rpcCalls, [{
        name: 'purchase_reverse',
        args: { p_payment_intent: 'pi_1', p_reason: 'reversal:refund', p_amount_refunded: 300, p_amount: 1000 },
    }]);
});

test('a lost dispute reverses the whole charge', async () => {
    const rpcCalls = stubDb();
    const res = await POST(await signedRequest('charge.dispute.closed', {
        id: 'dp_1', payment_intent: 'pi_1', amount: 1000, status: 'lost',
    }));
    assert.equal(res.status, 200);
    assert.deepEqual(rpcCalls[0].args, { p_payment_intent: 'pi_1', p_reason: 'reversal:dispute', p_amount_refunded: 1, p_amount: 1 });
});

test('a won dispute takes nothing back', async () => {
    const rpcCalls = stubDb();
    const res = await POST(await signedRequest('charge.dispute.closed', { id: 'dp_2', payment_intent: 'pi_1', status: 'won' }));
    assert.equal(res.status, 200);
    assert.equal(rpcCalls.length, 0);
});

test('malformed refund amounts never reach the database', async () => {
    for (const [amount, amount_refunded] of [[0, 0], [1000, 1001], [1000, -1], ['1000', 300], [1000, 1.5]]) {
        const rpcCalls = stubDb();
        const res = await POST(await signedRequest('charge.refunded', { id: 'ch_2', payment_intent: 'pi_2', amount, amount_refunded }));
        assert.equal(res.status, 200);
        assert.equal(rpcCalls.length, 0, `amount=${amount} refunded=${amount_refunded}`);
    }
});
