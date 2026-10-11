import test from 'node:test';
import assert from 'node:assert/strict';
import { decide, drainContentScans, IMAGE_CATEGORIES } from '../lib/contentScan.js';
const cfg = { supabaseUrl: 'https://db.test', serviceRoleKey: 'service-test' };
const r2 = { accountId: 'acct', accessKeyId: 'key', secretAccessKey: 'secret', bucket: 'test' };
const env = { CONTENT_SCAN_ENABLED: 'true', OPENAI_API_KEY: 'openai-test' };
const result = (scores = {}, flags = {}) => ({ category_scores: { ...Object.fromEntries(IMAGE_CATEGORIES.map(k => [k, 0])), ...scores }, categories: { ...Object.fromEntries(IMAGE_CATEGORIES.map(k => [k, false])), ...flags } });
const realFetch = globalThis.fetch, realError = console.error;
test.before(() => { console.error = () => {}; });
test.afterEach(() => { globalThis.fetch = realFetch; });
test.after(() => { console.error = realError; });
test('threshold edges, self-harm flags and text-only categories', () => {
    for (const key of ['sexual', 'violence/graphic']) {
        assert.equal(decide(result({ [key]: .799999 })), 'clean');
        assert.equal(decide(result({ [key]: .8 })), 'hold');
    }
    for (const key of IMAGE_CATEGORIES.filter(k => k.startsWith('self-harm'))) assert.equal(decide(result({}, { [key]: true })), 'hold');
    assert.equal(decide(result({ violence: 1, 'sexual/minors': 0 })), 'clean');
    assert.equal(decide(result({ 'sexual/minors': 1 }, { 'sexual/minors': true })), 'clean');
});
function setup(rows) {
    const calls = []; let claimed = false;
    globalThis.fetch = async (url, init) => {
        const name = new URL(url).pathname.split('/').pop(), args = JSON.parse(init.body);
        calls.push({ name, args });
        if (name === 'claim_content_scans') { const batch = claimed ? [] : rows; claimed = true; return Response.json(batch); }
        return Response.json({ ok: true });
    };
    return calls;
}
const row = (id = 'scan', left = 120000) => ({ id, claim_token: `${id}-token`, r2_key: `images/${id}.png`, lease_until: new Date(Date.now() + left).toISOString() });
test('drain arms, leases, presigns, sends image and bearer, and records its token', async () => {
    const calls = setup([row()]);
    const out = await drainContentScans(cfg, r2, env, { fetcher: async (url, init, timeout) => {
        assert.equal(url, 'https://api.openai.com/v1/moderations'); assert.equal(timeout, 10000);
        assert.equal(init.headers.Authorization, 'Bearer openai-test');
        const body = JSON.parse(init.body); assert.equal(body.model, 'omni-moderation-latest');
        assert.equal(body.input.length, 1); assert.equal(body.input[0].type, 'image_url');
        assert.equal(new URL(body.input[0].image_url.url).searchParams.get('X-Amz-Expires'), '900');
        return Response.json({ results: [result({ sexual: .8 })] });
    } });
    assert.equal(out.decided, 1); assert.equal(calls[0].name, 'arm_content_scan_monitor');
    assert.deepEqual(calls[1].args, { p_limit: 5, p_lease_seconds: 120 });
    const recorded = calls.find(c => c.name === 'record_content_scan').args;
    assert.equal(recorded.p_claim_token, 'scan-token'); assert.equal(recorded.p_verdict, 'hold');
});
test('input 4xx unavailable, server/transport errors retry via expiry, near-expired leases skipped', async () => {
    for (const status of [400, 413, 415, 429, 500, 503, 'throw']) {
        const calls = setup([row()]);
        await drainContentScans(cfg, r2, env, { fetcher: async () => { if (status === 'throw') throw Error('offline'); return new Response('', { status }); } });
        const records = calls.filter(c => c.name === 'record_content_scan');
        assert.equal(records.length, [400, 413, 415].includes(status) ? 1 : 0);
        if (records.length) assert.deepEqual([records[0].args.p_verdict, records[0].args.p_scores], ['unavailable', { error: status }]);
    }
    const calls = setup([row('late', 14000)]);
    await drainContentScans(cfg, r2, env, { fetcher: () => assert.fail('expired lease') });
    assert.equal(calls.filter(c => c.name === 'record_content_scan').length, 0);
});
test('soft budget finishes the claimed chunk but makes no further claim', async () => {
    const calls = setup([row('one'), row('two')]); let clock = Date.now(); let fetched = 0;
    await drainContentScans(cfg, r2, env, { budgetMs: 1, now: () => clock, fetcher: async () => {
        fetched++; clock += 2; return Response.json({ results: [result()] });
    } });
    assert.equal(fetched, 2); assert.equal(calls.filter(c => c.name === 'claim_content_scans').length, 1);
});
test('disabled flag performs no RPC or provider request', async () => {
    globalThis.fetch = () => assert.fail('network');
    for (const disabled of [{}, { ...env, CONTENT_SCAN_ENABLED: 'false' }]) {
        assert.equal((await drainContentScans(cfg, r2, disabled)).skipped, 'not_configured');
    }
});

test('enabled but missing key arms monitoring without claiming or contacting provider', async () => {
    const calls = setup([]);
    assert.equal((await drainContentScans(cfg, r2, { CONTENT_SCAN_ENABLED: 'true' })).skipped, 'not_configured');
    assert.deepEqual(calls.map(c => c.name), ['arm_content_scan_monitor']);
});

test('an empty claim retries once, drains the next batch and stops after two consecutive empty claims', async () => {
    const batches = [[], [row()], [], []]; const calls = []; let providers = 0;
    globalThis.fetch = async (url, init) => {
        const name = new URL(url).pathname.split('/').pop(); calls.push(name);
        if (name === 'claim_content_scans') {
            assert.ok(batches.length, 'must stop after the second empty claim');
            return Response.json(batches.shift());
        }
        if (name === 'record_content_scan') assert.equal(JSON.parse(init.body).p_claim_token, 'scan-token');
        return Response.json({ ok: true });
    };
    const out = await drainContentScans(cfg, r2, env, { fetcher: async () => {
        providers++; return Response.json({ results: [result()] });
    } });
    assert.equal(out.decided, 1); assert.equal(providers, 1); assert.equal(batches.length, 0);
    assert.equal(calls.filter(name => name === 'claim_content_scans').length, 4);
});

test('scanning without hold checks logs the flag mismatch once per enabled drain', async () => {
    const savedError = console.error, logs = [];
    console.error = (...args) => logs.push(args.join(' '));
    try {
        for (const scanFlag of ['true', 'false']) for (const holdFlag of [undefined, 'false', 'TRUE', 'true']) {
            for (let run = 0; run < 2; run++) {
                logs.length = 0;
                const calls = setup([]);
                const out = await drainContentScans(cfg, r2, { ...env, CONTENT_SCAN_ENABLED: scanFlag, SOCIAL_HOLD_CHECKS_ENABLED: holdFlag });
                const mismatch = logs.filter(line => line.includes('SOCIAL_HOLD_CHECKS_ENABLED'));
                assert.equal(mismatch.length, scanFlag === 'true' && holdFlag !== 'true' ? 1 : 0);
                if (mismatch.length) {
                    assert.match(mismatch[0], /CONTENT_SCAN_ENABLED=true/);
                    assert.match(mismatch[0], /held images are excluded from new dispatch/);
                    assert.match(mismatch[0], /claimed targets are not re-checked until hold checks are on/);
                }
                // Logging must not change arming, claiming, or disabled-path behavior.
                assert.deepEqual(calls.map(c => c.name), scanFlag === 'true'
                    ? ['arm_content_scan_monitor', 'claim_content_scans', 'claim_content_scans'] : []);
                assert.equal(out.ok, true);
            }
        }
    } finally { console.error = savedError; }
});
