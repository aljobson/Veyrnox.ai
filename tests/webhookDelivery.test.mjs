// lib/webhookDelivery.js (ADR-0083): one row per inbound delivery, written
// after the handler answered, never able to change the answer, off unless
// WEBHOOK_DELIVERY_LOG_ENABLED is "true". Every webhook route is wrapped.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { classify, withDeliveryLog, recordDelivery } from '../lib/webhookDelivery.js';

const realError = console.error;
test.before(() => { console.error = () => {}; });
test.after(() => { console.error = realError; });

test('classify maps a status and body to the outcome classes the table accepts', () => {
    assert.equal(classify(200, { ok: true }), 'accepted');
    assert.equal(classify(200, { ok: true, duplicate: true }), 'duplicate');
    assert.equal(classify(200, { ok: true, pending: true }), 'pending');
    assert.equal(classify(200, { ok: true, ignored: true }), 'ignored');
    assert.equal(classify(200, { ok: true, warn: 'no_order_id' }), 'warned');
    assert.equal(classify(401, { error: 'invalid_signature' }), 'rejected_signature');
    assert.equal(classify(400, { error: 'invalid_json' }), 'rejected');
    assert.equal(classify(409, { error: 'job_not_found' }), 'rejected');
    assert.equal(classify(413, null), 'rejected');
    assert.equal(classify(502, { error: 'provider_unavailable' }), 'unavailable');
    assert.equal(classify(503, { error: 'not_configured' }), 'unavailable');
    assert.equal(classify(500, { error: 'internal' }), 'failed');
});

test('with the flag off the handler answers alone and nothing is recorded', async () => {
    delete process.env.WEBHOOK_DELIVERY_LOG_ENABLED;
    let recorded = 0;
    const wrapped = withDeliveryLog('kie', async () => Response.json({ ok: true }), { record: async () => { recorded += 1; } });
    const res = await wrapped(new Request('https://veyrnox.test/api/webhook/kie', { method: 'POST' }));
    assert.deepEqual([res.status, await res.json()], [200, { ok: true }]);
    assert.equal(recorded, 0);
});

test('with the flag on the row is written after the answer, with the typed error, and the answer is unchanged', async () => {
    process.env.WEBHOOK_DELIVERY_LOG_ENABLED = 'true';
    try {
        const rows = [];
        const record = async (row) => { rows.push(row); };
        const wrap = (status, body) => withDeliveryLog('stripe', async () => Response.json(body, { status }), { record });
        const refused = await wrap(401, { error: 'invalid_signature' })(new Request('https://veyrnox.test/x', { method: 'POST' }));
        assert.deepEqual([refused.status, await refused.json()], [401, { error: 'invalid_signature' }], 'the body is still readable by the provider');
        await wrap(200, { ok: true, warn: 'no_order_id' })(new Request('https://veyrnox.test/x', { method: 'POST' }));
        await wrap(500, { error: 'internal' })(new Request('https://veyrnox.test/x', { method: 'POST' }));
        const text = await withDeliveryLog('stripe', async () => new Response('not json', { status: 200 }), { record })(new Request('https://veyrnox.test/x', { method: 'POST' }));
        assert.equal(await text.text(), 'not json');
        assert.deepEqual(rows, [
            { source: 'stripe', outcome: 'rejected_signature', status: 401, error: 'invalid_signature' },
            { source: 'stripe', outcome: 'warned', status: 200, error: 'warn:no_order_id' },
            { source: 'stripe', outcome: 'failed', status: 500, error: 'internal' },
            { source: 'stripe', outcome: 'accepted', status: 200, error: null },
        ]);
        // A recorder that throws does not reach the provider.
        const still = await withDeliveryLog('fal', async () => Response.json({ ok: true }), { record: async () => { throw new Error('db down'); } })(new Request('https://veyrnox.test/x', { method: 'POST' }));
        assert.equal(still.status, 200);
    } finally {
        delete process.env.WEBHOOK_DELIVERY_LOG_ENABLED;
    }
});

test('recordDelivery calls record_webhook_delivery with the service role and swallows failure', async () => {
    const cfg = { supabaseUrl: 'https://db.test', serviceRoleKey: 'service-test' };
    const seen = [];
    await recordDelivery({ source: 'fal', outcome: 'rejected', status: 400, error: 'invalid_json' }, cfg, async (url, init) => {
        seen.push({ url: String(url), init });
        return new Response('{"ok":true}', { status: 200 });
    });
    assert.equal(seen[0].url, 'https://db.test/rest/v1/rpc/record_webhook_delivery');
    assert.equal(seen[0].init.headers.Authorization, 'Bearer service-test');
    assert.deepEqual(JSON.parse(seen[0].init.body), { p_source: 'fal', p_outcome: 'rejected', p_http_status: 400, p_error: 'invalid_json' });
    // An error string the column would refuse is dropped, not sent.
    await recordDelivery({ source: 'fal', outcome: 'rejected', status: 400, error: 'Has <html>' }, cfg, async (url, init) => { seen.push({ url: String(url), init }); return new Response('{}'); });
    assert.equal(JSON.parse(seen[1].init.body).p_error, null);
    await recordDelivery({ source: 'fal', outcome: 'accepted', status: 200, error: null }, cfg, async () => { throw new Error('network'); });
    await recordDelivery({ source: 'fal', outcome: 'accepted', status: 200, error: null }, { supabaseUrl: '', serviceRoleKey: '' }, async () => assert.fail('unconfigured must not fetch'));
});

test('every inbound webhook route exports a wrapped POST', () => {
    for (const source of ['fal', 'kie', 'openrouter', 'montage', 'stripe', 'cinema-stream']) {
        const src = readFileSync(new URL(`../app/api/webhook/${source}/route.js`, import.meta.url), 'utf8');
        assert.match(src, new RegExp(`export const POST\\s*=\\s*withDeliveryLog\\('${source}',`), source);
        assert.doesNotMatch(src, /export async function POST/, source);
    }
});
