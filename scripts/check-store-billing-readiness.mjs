#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { storeBillingCatalog } from './store-billing-catalog.mjs';

export const EVENT_TYPES = ['non_renewing_purchase', 'cancellation', 'initial_purchase', 'renewal',
    'product_change', 'uncancellation', 'billing_issue', 'expiration'];
const WEBHOOK = 'https://veyrnox.ai/api/webhook/revenuecat';
const API = 'https://api.revenuecat.com';
const storeFor = app => ({ app_store: 'ios', play_store: 'android' })[app?.type];
const safe = value => String(value ?? '').replace(/[^a-zA-Z0-9._:$/ -]/g, '?').slice(0, 200);

// Only GETs. Pagination cannot redirect the API key to another host/project.
export async function revenueCatSnapshot({ key, project, stage = 'selling', fetchImpl = fetch }) {
    if (!key || !/^[A-Za-z0-9_-]+$/.test(project ?? '')) throw new Error('RevenueCat key or project missing');
    const base = `/v2/projects/${project}/`;
    async function list(path) {
        let next = base + path + '?limit=100';
        const items = [], seen = new Set();
        while (next) {
            const url = new URL(next, API);
            if (url.origin !== API || !url.pathname.startsWith(base) || url.username || url.password || seen.has(url.href)) {
                throw new Error('Invalid RevenueCat pagination');
            }
            seen.add(url.href);
            const response = await fetchImpl(url.href, { headers: { Authorization: `Bearer ${key}` },
                redirect: 'error', signal: AbortSignal.timeout(15000) });
            if (!response.ok) throw new Error(`RevenueCat read failed (HTTP ${response.status})`);
            const page = await response.json();
            if (!Array.isArray(page.items)) throw new Error('Invalid RevenueCat list');
            items.push(...page.items);
            next = page.next_page;
        }
        return items;
    }
    const apps = await list('apps');
    const products = await list('products');
    const offerings = await list('offerings');
    for (const offering of offerings) {
        offering.packages = await list(`offerings/${encodeURIComponent(offering.id)}/packages`);
        for (const pkg of offering.packages) pkg.products = await list(`packages/${encodeURIComponent(pkg.id)}/products`);
    }
    const entitlements = await list('entitlements');
    for (const entitlement of entitlements) entitlement.products = await list(`entitlements/${encodeURIComponent(entitlement.id)}/products`);
    const webhooks = stage === 'catalog' ? [] : await list('integrations/webhooks');
    // Strip credential-bearing webhook fields before returning anything to the reporter.
    return { apps, products, offerings, entitlements,
        webhooks: webhooks.map(({ id, url, environment, event_types, app_id }) => ({ id, url, environment, event_types, app_id })) };
}

export function checkReadiness(snapshot, { store = 'ios', stage = 'selling', workerVersions, probeStatus } = {}) {
    if (!['ios', 'android', 'all'].includes(store) || !['catalog', 'recording', 'selling'].includes(stage)) throw new Error('Invalid store or stage');
    const checks = [];
    const check = (ok, message) => checks.push({ status: ok ? 'ready' : 'fail', message });
    const note = (status, message) => checks.push({ status, message });
    const selected = s => store === 'all' || store === s;
    const catalog = storeBillingCatalog();
    const expected = catalog.filter(p => selected(p.store));
    const appStore = new Map(snapshot.apps.map(a => [a.id, storeFor(a)]));
    const inScope = product => selected(appStore.get(product?.app_id)) && Boolean(appStore.get(product?.app_id));
    for (const s of ['ios', 'android']) if (!selected(s)) note('excluded', `${s}: all catalog and app checks excluded`);
    for (const app of snapshot.apps) note(selected(storeFor(app)) && storeFor(app) ? 'info' : 'excluded', `app ${safe(app.id)} (${safe(app.type)})`);
    for (const s of ['ios', 'android'].filter(selected)) check(snapshot.apps.some(a => storeFor(a) === s), `${s} app exists`);
    for (const product of snapshot.products) {
        note(inScope(product) ? 'info' : 'excluded',
            `product ${safe(product.id)} ${safe(product.store_identifier)} (${safe(appStore.get(product.app_id) ?? 'other store')})`);
    }
    const products = snapshot.products.filter(inScope);
    const byId = new Map(snapshot.products.map(p => [p.id, p]));
    const unwrap = entry => entry.product ?? byId.get(entry.product_id ?? entry.id) ?? entry;
    for (const row of expected) {
        const matches = products.filter(p => p.store_identifier === row.productId && appStore.get(p.app_id) === row.store);
        const label = `${row.store} ${row.productId}`;
        check(matches.length === 1, `${label}: exactly one product`);
        for (const p of matches) {
            check(p.state === 'active' && (row.kind === 'consumable'
                ? p.type === 'consumable' || (p.type === 'one_time' && p.one_time?.is_consumable === true)
                : p.type === 'subscription'), `${label}: active ${row.kind}`);
            const offering = snapshot.offerings.find(o => o.lookup_key === row.offering);
            const pkg = offering?.packages.find(pkg => pkg.lookup_key === row.package);
            check(Boolean(pkg?.products.some(entry => unwrap(entry).id === p.id && (entry.eligibility_criteria == null || entry.eligibility_criteria === 'all'))),
                `${label}: ${row.offering}/${row.package} contains product for all customers`);
            const actualEntitlements = snapshot.entitlements.filter(e => e.products.some(entry => unwrap(entry).id === p.id)).map(e => e.lookup_key).sort();
            const wanted = row.kind === 'consumable' ? [] : [row.offering];
            check(JSON.stringify(actualEntitlements) === JSON.stringify(wanted), `${label}: exact entitlements ${wanted.join(',') || 'none'}`);
        }
    }
    for (const name of ['publish', 'generation']) {
        const entitlement = snapshot.entitlements.find(e => e.lookup_key === name);
        check(Boolean(entitlement) && entitlement.state !== 'archived', `${name} entitlement exists and is active`);
        for (const entry of entitlement?.products ?? []) {
            const p = unwrap(entry);
            if (!inScope(p)) continue;
            check(expected.some(row => row.offering === name && row.store === appStore.get(p.app_id) && row.productId === p.store_identifier),
                `${name} entitlement has no wrong product: ${safe(p.store_identifier)}`);
        }
    }
    for (const offering of snapshot.offerings) {
        note('info', `offering ${safe(offering.lookup_key)}`);
        for (const pkg of offering.packages) {
            const attached = pkg.products.map(unwrap);
            const scoped = attached.filter(inScope);
            if (attached.length && !scoped.length) {
                note('excluded', `package ${safe(offering.lookup_key)}/${safe(pkg.lookup_key)}: other store`);
                continue;
            }
            check(scoped.length > 0 && scoped.every(p => expected.some(row => row.productId === p.store_identifier
                && row.store === appStore.get(p.app_id) && row.offering === offering.lookup_key && row.package === pkg.lookup_key)),
            `no stale package: ${safe(offering.lookup_key)}/${safe(pkg.lookup_key)}`);
        }
    }
    if (stage !== 'catalog') {
        for (const app of snapshot.apps.filter(a => selected(storeFor(a)) && storeFor(a))) {
            check(snapshot.webhooks.some(w => w.url === WEBHOOK && w.environment === 'production'
                && (!w.app_id || w.app_id === app.id) && EVENT_TYPES.every(t => w.event_types?.includes(t))),
            `production webhook covers ${safe(app.id)} and all eight event types`);
        }
        for (const w of snapshot.webhooks) note('info', `webhook ${safe(w.id)} environment=${safe(w.environment)} production URL=${w.url === WEBHOOK}`);
        if (workerVersions) {
            check(workerVersions.length > 0, 'live Worker versions found');
            for (const version of workerVersions) {
                const bindings = version?.resources?.bindings;
                check(Array.isArray(bindings), 'Worker bindings readable');
                if (!Array.isArray(bindings)) continue;
                const hasSecret = name => bindings.some(b => b.name === name && ['secret_text', 'secret_key'].includes(b.type));
                for (const name of ['STORE_BILLING_ENABLED', 'REVENUECAT_WEBHOOK_SECRET']) check(hasSecret(name), `Worker secret name ${name}`);
                check(!bindings.some(b => b.name === 'STORE_BILLING_ALLOW_SANDBOX'), 'Worker has no sandbox override (var or secret)');
                if (stage === 'selling') check(hasSecret('STORE_SALES_ENABLED'), 'Worker secret name STORE_SALES_ENABLED');
                else check(!bindings.some(b => b.name === 'STORE_SALES_ENABLED'), 'sales closed: STORE_SALES_ENABLED absent');
            }
            note('info', 'Secret names do not prove values or a working signing secret.');
        } else note('skipped', 'Worker not checked; use --worker');
        if (probeStatus !== undefined) check(probeStatus === 401,
            `unsigned probe HTTP ${probeStatus}: ${probeStatus === 401 ? 'recording on, signing secret bound' : probeStatus === 404 ? 'recording off' : probeStatus === 503 ? 'signing secret or gateway configuration missing' : 'unexpected response'}`);
        else note('skipped', 'Runtime not checked; use --probe <origin>');
    }
    return { ok: checks.every(c => c.status !== 'fail'), checks };
}

export async function probe(origin, fetchImpl = fetch) {
    const url = new URL(origin);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('Probe requires an origin');
    const response = await fetchImpl(new URL('/api/webhook/revenuecat', url).href, {
        method: 'POST', body: '', redirect: 'manual', signal: AbortSignal.timeout(15000),
    });
    return response.status;
}

export function readWorkerVersions(run = args => execFileSync('npx', ['wrangler', ...args], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 60000, maxBuffer: 8 * 1024 * 1024,
})) {
    const deployments = JSON.parse(run(['deployments', 'list', '--json']));
    if (!Array.isArray(deployments) || !deployments.length) throw new Error('No live deployment');
    const latest = [...deployments].sort((a, b) => Date.parse(b.created_on) - Date.parse(a.created_on))[0];
    const live = latest.versions?.filter(v => v.percentage > 0);
    if (!live?.length) throw new Error('No live version');
    return live.map(v => {
        if (!/^[a-zA-Z0-9-]+$/.test(v.version_id)) throw new Error('Invalid live version');
        return JSON.parse(run(['versions', 'view', v.version_id, '--json']));
    });
}

export async function main(args = process.argv.slice(2), env = process.env) {
    const options = { store: 'ios', stage: 'selling', project: env.REVENUECAT_PROJECT_ID ?? 'proj36a3504f' };
    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (arg === '--worker') options.worker = true;
        else if (['--store', '--stage', '--project', '--probe'].includes(arg) && args[i + 1] && !args[i + 1].startsWith('--')) options[arg.slice(2)] = args[++i];
        else throw new Error('Invalid arguments');
    }
    if (!['ios', 'android', 'all'].includes(options.store) || !['catalog', 'recording', 'selling'].includes(options.stage)) throw new Error('Invalid store or stage');
    if (options.stage === 'catalog' && (options.worker || options.probe)) throw new Error('Catalog stage excludes Worker and probe checks');
    const snapshot = await revenueCatSnapshot({ key: env.REVENUECAT_API_KEY, project: options.project, stage: options.stage });
    const workerVersions = options.worker ? readWorkerVersions() : undefined;
    const probeStatus = options.probe ? await probe(options.probe) : undefined;
    const report = checkReadiness(snapshot, { ...options, workerVersions, probeStatus });
    console.log(`Configuration only: ${options.store}, ${options.stage}. This is not proof of working payments.`);
    for (const c of report.checks) console.log(`${c.status.toUpperCase()}: ${c.message}`);
    console.log('Only a signed delivery proves the signing secret; use the production runbook for end-to-end payment proof.');
    return report.ok ? 0 : 1;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    main().then(code => { process.exitCode = code; }).catch(() => {
        // Never echo remote bodies, credentials, or child-process stdout/stderr.
        console.error('Readiness could not be checked. Verify arguments, read permissions and connectivity; no credentials or response bodies printed.');
        process.exitCode = 1;
    });
}
