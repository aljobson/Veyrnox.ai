import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { checkReadiness, revenueCatSnapshot, readWorkerVersions, probe } from '../scripts/check-store-billing-readiness.mjs';
const fixture = () => JSON.parse(readFileSync(new URL('./fixtures/revenuecat/configured.json', import.meta.url)));
const worker = (sales = true) => ({ resources: { bindings: ['STORE_BILLING_ENABLED', 'REVENUECAT_WEBHOOK_SECRET', ...(sales ? ['STORE_SALES_ENABLED'] : [])].map(name => ({ name, type: 'secret_text' })) } });
const check = (data = fixture(), options = {}) => checkReadiness(data, { workerVersions: [worker()], probeStatus: 401, ...options });
test('all configured; Android is excluded, never ready, by default', () => {
    const result = check(); assert.equal(result.ok, true);
    assert.ok(result.checks.some(c => c.status === 'excluded' && c.message.startsWith('android:')));
    assert.ok(!result.checks.some(c => c.status === 'ready' && /android|app_android/.test(c.message)));
    assert.equal(check(fixture(), { store: 'all' }).ok, true);
    assert.equal(check(fixture(), { store: 'android' }).ok, true);
});
test('missing iOS product fails even though Android is excluded', () => {
    const data = fixture(); data.products = data.products.filter(p => !(p.app_id === 'app_ios' && p.store_identifier.endsWith('.100')));
    assert.equal(check(data).ok, false);
});
test('missing or incorrect entitlement and pack attachments fail', () => {
    for (const mutate of [d => d.entitlements.pop(), d => d.entitlements[0].products.pop(),
        d => d.entitlements[0].products.push(d.products.find(p => p.app_id === 'app_ios' && p.type === 'consumable')),
        d => d.entitlements[0].products.push(d.entitlements[1].products.find(p => p.app_id === 'app_ios'))]) {
        const data = fixture(); mutate(data); assert.equal(check(data).ok, false);
    }
});
test('products outside offerings, stale packages, wrong types and archived products fail', () => {
    for (const mutate of [d => d.offerings[0].packages.pop(), d => d.offerings[0].packages[0].lookup_key = '270',
        d => d.products.find(p => p.app_id === 'app_ios').type = 'subscription',
        d => d.products.find(p => p.app_id === 'app_ios').state = 'archived']) {
        const data = fixture(); mutate(data); assert.equal(check(data).ok, false);
    }
});
test('webhook requires production URL, scope and all handled event types', () => {
    for (const mutate of [d => d.webhooks[0].event_types.pop(), d => d.webhooks[0].environment = 'sandbox',
        d => d.webhooks[0].url += '/wrong', d => d.webhooks[0].app_id = 'app_android']) {
        const data = fixture(); mutate(data); assert.equal(check(data).ok, false);
        assert.equal(check(data, { stage: 'catalog' }).ok, true);
    }
});
test('sandbox override is forbidden even if false, as var or secret', () => {
    for (const type of ['plain_text', 'secret_text']) {
        const version = worker(); version.resources.bindings.push({ name: 'STORE_BILLING_ALLOW_SANDBOX', type, text: 'false' });
        assert.equal(check(fixture(), { workerVersions: [version] }).ok, false);
    }
});
test('stage recording requires sales closed, selling requires sales secret, vars do not substitute', () => {
    assert.equal(check(fixture(), { stage: 'recording', workerVersions: [worker(false)] }).ok, true);
    assert.equal(check(fixture(), { stage: 'selling', workerVersions: [worker(false)] }).ok, false);
    assert.equal(check(fixture(), { stage: 'recording' }).ok, false);
    const version = worker(); version.resources.bindings[0].type = 'plain_text';
    assert.equal(check(fixture(), { workerVersions: [version] }).ok, false);
});
test('unsigned empty runtime probe: 404/503 fail, 401 passes, no credentials or redirects', async () => {
    for (const status of [404,503,401,200,302]) {
        const seen = await probe('https://veyrnox.ai', async (url, init) => {
            assert.equal(url, 'https://veyrnox.ai/api/webhook/revenuecat');
            assert.equal(init.method, 'POST'); assert.equal(init.body, ''); assert.equal(init.headers, undefined);
            assert.equal(init.redirect, 'manual'); return { status };
        });
        assert.equal(check(fixture(), { probeStatus: seen }).ok, status === 401);
    }
});
test('reads all deployed versions rather than newest uploaded version and checks each', () => {
    const calls = [];
    const versions = readWorkerVersions(args => { calls.push(args); return JSON.stringify(args[0] === 'deployments'
        ? [{ created_on: '2026-10-28', versions: [{ version_id: 'old', percentage: 100 }] },
            { created_on: '2026-10-29', versions: [{ version_id: 'live-a', percentage: 90 }, { version_id: 'live-b', percentage: 10 }] }]
        : worker(args[2] === 'live-a')); });
    assert.equal(check(fixture(), { workerVersions: versions }).ok, false);
    assert.deepEqual(calls.slice(1), [['versions','view','live-a','--json'],['versions','view','live-b','--json']]);
});
test('API reader follows pagination, reads attachment endpoints and strips sensitive webhook fields', async () => {
    const data = fixture(), paths = [];
    const fetchImpl = async (url, init) => {
        assert.equal(init.redirect, 'error'); const u = new URL(url), path = u.pathname.replace('/v2/projects/fixture/', ''); paths.push(path);
        let items = data[path];
        if (path === 'products') items = u.searchParams.has('starting_after') ? data.products.slice(1) : data.products.slice(0,1);
        for (const o of data.offerings) {
            if (path === `offerings/${o.id}/packages`) items = o.packages;
            for (const pkg of o.packages) if (path === `packages/${pkg.id}/products`) items = pkg.products;
        }
        for (const e of data.entitlements) if (path === `entitlements/${e.id}/products`) items = e.products;
        if (path === 'integrations/webhooks') items = data.webhooks.map(w => ({...w, signing_secret: 'REDACTED', authorization_header: 'REDACTED'}));
        assert.ok(items, path);
        return { ok: true, json: async () => ({ items, next_page: path === 'products' && !u.searchParams.has('starting_after') ? '/v2/projects/fixture/products?starting_after=first' : null }) };
    };
    const result = await revenueCatSnapshot({ key: 'fixture-only', project: 'fixture', fetchImpl });
    assert.equal(check(result).ok, true); assert.equal(result.products.length, 28);
    assert.ok(!JSON.stringify(result).includes('REDACTED'));
    paths.length = 0; await revenueCatSnapshot({ key: 'fixture-only', project: 'fixture', stage: 'catalog', fetchImpl });
    assert.ok(!paths.includes('integrations/webhooks'));
});
test('API errors and unsafe pagination fail closed', async () => {
    for (const next_page of ['https://other.invalid/steal', '/v2/projects/another/products', '/v2/projects/fixture/apps?limit=100']) {
        await assert.rejects(revenueCatSnapshot({ key: 'fixture-only', project: 'fixture', fetchImpl: async () => ({ ok: true, json: async () => ({ items: [], next_page }) }) }));
    }
    await assert.rejects(revenueCatSnapshot({ key: 'fixture-only', project: 'fixture', fetchImpl: async () => ({ ok: false, status: 403 }) }));
});
