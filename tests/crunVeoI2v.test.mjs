import { DEFAULT_MOTION_PROMPT } from '../lib/additionalModelCapabilities.js';
import { fallbackCapabilitiesFor } from '../lib/fallbackModelCapabilities.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { buildRequest, endpointKind, submitTask } from '../packages/adapters/crun.js';
register('data:text/javascript,' + encodeURIComponent(`export async function resolve(s,c,next) { return next(s === 'next/server' ? 'next/server.js' : s,c); }`));
Object.assign(process.env, {
    SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'test-service', PUBLIC_HOST: 'https://veyrnox.test',
    CRUN_ENABLED: 'true', CRUN_API_KEY: 'test-crun', SUPPLIER_ROUTES_ENABLED: 'true', KIE_API_KEY: 'test-kie',
    R2_ACCOUNT_ID: 'test', R2_ACCESS_KEY_ID: 'test-access', R2_SECRET_ACCESS_KEY: 'test-secret', R2_BUCKET: 'test',
});
const { POST } = await import('../app/api/v1/generations/route.js');
const catalog = await import('../lib/publicCatalog.js');
const { readPublicCatalog } = catalog;
const eligibility = await import('../lib/veoI2vCatalog.js');
const { GET: catalogGET } = await import('../app/api/catalog/route.js');
test.beforeEach(() => catalog._resetVeoI2vCatalog?.());
const { capabilityFor, declaredInputs } = await import('../lib/modelCapabilities.js');
const AUTH = '11111111-1111-4111-8111-111111111111';
const JOB = '22222222-2222-4222-8222-222222222222';
const SOURCE = `uploads/${AUTH}/33333333-3333-4333-8333-333333333333.png`;
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jZQAAAABJRU5ErkJggg==', 'base64');
const variants = [['lite-', 'veo-3.1-lite-kie', 'veoI2vLite'], ['fast-', 'veo-3.1-fast-kie', 'veoI2vFast'], ['', 'veo-3.1-kie', 'veoI2v31']];
const marker = model => `[veo-i2v:${model}:signed-source:v1]`;
function fixture({ variant = 0, flags, breaker = null, parity, provider = 'crun', admission = true, routeState = 'active', readFailure = false, mime = 'image/png', replayFailure = null, rejection = null } = {}) {
    const [part, id, flag] = variants[variant];
    process.env.APP_RUNTIME_FLAGS = JSON.stringify(flags ?? { [flag]: true });
    const apiModel = `google/veo3-1-${part}i2v`;
    const row = { id, name: 'Veo', provider, provider_endpoint: provider === 'crun' ? `crun:google/veo3-1-${part}t2v` : 'veo:veo3_fast', modality: 'text-to-video', credits_5s: 9, active: true, gated_flag: false };
    const route = { model_id: id, offer: row, id: 'route-1', supplier: provider, endpoint: row.provider_endpoint, state: routeState, priority: 0, provenance: 'licensed_reseller', parity_record: parity ?? marker(apiModel), breaker_opened_at: breaker };
    const calls = [], real = globalThis.fetch;
    let savedJob = null;
    const read = async table => {
        if (table === 'model_catalog') return [row];
        if (table === 'jobs') { if (replayFailure === 'jobs') throw new Error('offline'); return savedJob ? [savedJob] : []; }
        if (table === 'model_routes') return [route];
        if (table === 'provider_spend_provider_policy') { if (readFailure) throw new Error('offline'); return [{ admission_open: admission }]; }
        throw new Error(`Unexpected table ${table}`);
    };
    globalThis.fetch = async (url, init = {}) => {
        const u = new URL(String(url)), body = typeof init.body === 'string' ? JSON.parse(init.body) : undefined;
        calls.push({ url: u, body });
        if (u.pathname.endsWith('/rpc/ledger_debit')) { savedJob = { id: JOB, model_id: id, inputs: structuredClone(body.p_inputs) }; return Response.json({ ok: true, job_id: JOB, balance_after: 100 }); }
        if (u.pathname.includes('/rpc/')) return Response.json({ ok: true });
        if (u.pathname === '/rest/v1/users') { if (replayFailure === 'users') throw new Error('offline'); return Response.json([{ id: AUTH }]); }
        if (u.pathname.startsWith('/rest/v1/')) return Response.json(await read(u.pathname.split('/').pop()));
        if (u.hostname === 'api.crun.ai') return rejection ? Response.json({ code: rejection, message: 'VENDOR_SECRET https://private.test/?X-Amz-Signature=secret' }) : Response.json({ code: 200, data: { task_id: 'veo-test-task' } });
        if (u.hostname.endsWith('.r2.cloudflarestorage.com')) return new Response(mime === 'image/png' ? png : Buffer.from('00000018667479706d703432000000006d70343269736f6d', 'hex'), { status: 206, headers: { 'content-type': mime, 'content-range': `bytes 0-${png.length - 1}/${png.length}` } });
        throw new Error(`Unexpected URL ${u.hostname}${u.pathname}`);
    };
    return { row, route, apiModel, calls, read, savedJob: () => savedJob, restore: () => { globalThis.fetch = real; },
        post: (inputs = {}, extra = {}) => POST(new Request('https://veyrnox.test/api/v1/generations', { method: 'POST', headers: { 'x-veyrnox-auth-id': AUTH }, body: JSON.stringify({ model_id: id, idempotency_key: 'veo-i2v-test', consent: true, source_key: SOURCE, inputs: { prompt: 'A boat sails', duration_seconds: 5, ...inputs }, ...extra }) })) };
}
const debits = f => f.calls.filter(c => c.url.pathname.endsWith('/rpc/ledger_debit'));
const creates = f => f.calls.filter(c => c.url.hostname === 'api.crun.ai');
for (const [part] of variants) test(`adapter ${part || '31'} preserves text bytes and maps one image`, () => {
    const model = `google/veo3-1-${part}t2v`, i2v = model.replace('-t2v', '-i2v');
    assert.equal(JSON.stringify(buildRequest({ model }, { prompt: 'x', seed: 42 }).body), JSON.stringify({ model, input: { prompt: 'x', duration: 8, resolution: '720p', aspect_ratio: '16:9' } }));
    const request = buildRequest({ model }, { prompt: 'x', image_url: 'https://a.test/start.png', duration_seconds: 5 });
    assert.deepEqual(request.body, { model: i2v, input: { prompt: 'x', duration: 8, resolution: '720p', aspect_ratio: '16:9', img_urls: ['https://a.test/start.png'] } });
    assert.equal(endpointKind(`crun:${i2v}`), 'video');
    for (const inputs of [{ image_url: ['https://a/x', 'https://a/y'] }, { image_url: 'http://a/x' }, { reference_urls: ['https://a/x'] }, { image_url: 'https://a/x', resolution: '1080p' }, { image_url: 'https://a/x', duration_seconds: 4 }, { image_url: 'https://a/x', aspect_ratio: 'auto' }, { image_url: 'https://a/x', video_url: 'https://a/v' }]) assert.equal(buildRequest({ model }, { prompt: 'x', ...inputs }).ok, false);
});
for (let variant = 0; variant < 3; variant++) test(`gateway variant ${variant}: owned signed source reaches i2v at unchanged price`, async () => {
    const f = fixture({ variant });
    try {
        const response = await f.post({ seed: 42 });
        assert.equal(response.status, 200, JSON.stringify(await response.json()));
        assert.equal(debits(f).length, 1);
        assert.equal(debits(f)[0].body.p_credits, 9);
        assert.equal(creates(f).length, 1);
        const body = creates(f)[0].body;
        assert.equal(body.model, f.apiModel);
        assert.equal(body.input.duration, 8); assert.equal(body.input.resolution, '720p');
        assert.match(body.input.img_urls[0], /^https:.*X-Amz-Signature=/);
        assert.equal(body.input.seed, undefined);
        assert.equal(debits(f)[0].body.p_inputs.image_url, undefined);
    } finally { f.restore(); }
});
for (const [name, options, inputs, extra, expected] of [
    ['flag off', { flags: {} }, {}, {}, 'source_slot_invalid'],
    ['no parity', { parity: 't2v proof only' }, {}, {}, 'image_generation_unavailable'],
    ['recent breaker', { breaker: new Date().toISOString() }, {}, {}, 'image_generation_unavailable'],
    ['old breaker', { breaker: '2020-01-01T00:00:00Z' }, {}, {}, 'image_generation_unavailable'],
    ['provider paused', { admission: false }, {}, {}, 'image_generation_unavailable'],
    ['provider missing', { admission: null }, {}, {}, 'image_generation_unavailable'],
    ['provider read fails', { readFailure: true }, {}, {}, 'image_generation_unavailable'],
    ['not Crun', { provider: 'kie' }, {}, {}, 'image_generation_unavailable'],
    ['inactive route', { routeState: 'standby' }, {}, {}, 'image_generation_unavailable'],
    ['Lite does not enable Fast', { variant: 1, flags: { veoI2vLite: true } }, {}, {}, 'source_slot_invalid'],
    ['Lite does not enable 31', { variant: 2, flags: { veoI2vLite: true } }, {}, {}, 'source_slot_invalid'],
    ['two images', {}, {}, { source_key: undefined, source_keys: [SOURCE, SOURCE] }, 'source_count_exceeded'],
    ['reference URLs', {}, { reference_urls: ['https://a/x'] }, {}, 'inputs_key_not_allowed:reference_urls'],
    ['insecure URL', {}, { image_url: 'http://a/x' }, {}, 'inputs_invalid:image_url'],
    ['raw URL', {}, { image_url: 'https://a/x' }, { source_key: undefined }, 'source_slot_invalid'],
    ['wrong type', { mime: 'video/mp4' }, {}, {}, 'upload_type_mismatch'],
    ['1080p', {}, { resolution: '1080p' }, {}, 'resolution_not_supported'],
    ['10-second image request', {}, { duration_seconds: 10 }, {}, 'duration_not_supported'],
    ['video slot', {}, {}, { source_key: undefined, references: [{ slot: 'video', origin: 'upload', key: SOURCE }] }, 'source_slot_invalid'],
    ['end frame', {}, {}, { source_key: undefined, references: [{ slot: 'endImage', origin: 'upload', key: SOURCE }] }, 'source_slot_invalid'],
    ['4 seconds', {}, { duration_seconds: 4 }, {}, 'inputs_invalid:duration_seconds'],
    ['auto aspect', {}, { aspect_ratio: 'auto' }, {}, 'aspect_ratio_unsupported'],
]) test(`refuses ${name} without debit or supplier call`, async () => {
    const f = fixture(options);
    try {
        const response = await f.post(inputs, extra), body = await response.json();
        assert.equal(body.error, expected);
        if (expected === 'image_generation_unavailable') { assert.equal(response.status, 503); assert.equal(response.headers.get('retry-after'), '60'); }
        assert.equal(debits(f).length, 0); assert.equal(creates(f).length, 0);
    } finally { f.restore(); }
});
test('text-only seed filtering survives flags off and closed image admission', async () => {
    const f = fixture({ flags: {}, admission: false });
    try {
        assert.equal((await f.post({ seed: 42 }, { source_key: undefined })).status, 200);
        assert.equal(creates(f)[0].body.input.seed, undefined);
        assert.equal(creates(f)[0].body.model, 'google/veo3-1-lite-t2v');
        assert.equal(f.calls.some(c => c.url.pathname.endsWith('provider_spend_provider_policy')), false);
        assert.equal(f.calls.some(c => c.url.pathname.endsWith('/jobs')), false, 'ordinary text requests do not use source replay');
        const record = capabilityFor(f.row.provider_endpoint);
        assert.equal(record.strictInputs, undefined);
        assert.equal(declaredInputs(record, { prompt: 'x', seed: 42 }).seed, undefined);
    } finally { f.restore(); }
});
for (const [name, options, exposed] of [['on', {}, true], ['off', { flags: {} }, false], ['unproved', { parity: 't2v proof' }, false], ['old breaker', { breaker: '2020-01-01T00:00:00Z' }, false], ['paused', { admission: false }, false], ['other route', { provider: 'kie' }, false]]) test(`shared web/phone catalog slot: ${name}`, async () => {
    const f = fixture(options);
    try {
        const rows = await readPublicCatalog({ cfg: { supabaseUrl: 'https://db.test', serviceRoleKey: 'test' }, selectRows: f.read, waitUntil: null });
        assert.equal(!!rows[0].capabilities.media.image, exposed);
        if (exposed) assert.equal(rows[0].capabilities.media.image.maxFiles, 1);
        assert.doesNotMatch(JSON.stringify(rows[0].capabilities), /crun|img_urls|signed-source/);
    } finally { f.restore(); }
});
test('refusal redaction follows the selected i2v model even on a t2v route', async t => {
    t.mock.method(globalThis, 'fetch', async () => Response.json({ code: 422, message: 'https://private.test/image?SECRET' }));
    const result = await submitTask({ job_id: JOB, provider_endpoint: 'crun:google/veo3-1-lite-t2v', inputs: { prompt: 'x', image_url: 'https://a/x' } }, { apiKey: 'test' });
    assert.doesNotMatch(JSON.stringify(result), /SECRET|private/);
});

test('cached catalog never preserves an image slot after flag, breaker or policy closure', async t => {
    const saved = new Map();
    const previousCaches = globalThis.caches;
    t.after(() => { if (previousCaches === undefined) delete globalThis.caches; else globalThis.caches = previousCaches; });
    globalThis.caches = { default: {
        match: async key => saved.get(key)?.clone(),
        put: async (key, response) => { saved.set(key, response.clone()); },
    } };
    const options = { cfg: { supabaseUrl: 'https://db.test', serviceRoleKey: 'test' }, waitUntil: null };
    for (const [state, visible] of [[{}, true], [{ flags: {} }, false], [{ admission: false }, false], [{ breaker: '2020-01-01T00:00:00Z' }, false]]) {
        catalog._resetVeoI2vCatalog?.(); // An expired admission snapshot must not reuse the longer-lived price cache.
        const f = fixture(state);
        try {
            const models = await readPublicCatalog({ ...options, selectRows: f.read });
            assert.equal(!!models[0].capabilities.media.image, visible);
        } finally { f.restore(); }
    }
    for (const response of saved.values()) assert.equal((await response.clone().json())[0].capabilities.media.image, undefined);
});

test('offline browser defaults never expose an unverified Veo image slot', () => {
    process.env.APP_RUNTIME_FLAGS = JSON.stringify({ veoI2vLite: true, veoI2vFast: true, veoI2v31: true });
    for (const [, id] of variants) assert.equal(fallbackCapabilitiesFor(id).media.image, undefined);
});

for (const closure of ['flag', 'breaker', 'admission']) test(`charged image replay survives ${closure} closure`, async () => {
    const f = fixture();
    try {
        assert.equal((await f.post({ seed: 42 })).status, 200);
        assert.match(f.savedJob().inputs.veo_i2v?.request_hash ?? '', /^[a-f0-9]{64}$/);
        if (closure === 'flag') process.env.APP_RUNTIME_FLAGS = '{}';
        if (closure === 'breaker') f.route.breaker_opened_at = new Date().toISOString();
        const fetchBeforeClosure = globalThis.fetch;
        if (closure === 'admission') globalThis.fetch = (url, init) => String(url).includes('provider_spend_provider_policy')
            ? Promise.resolve(Response.json([{ admission_open: false }])) : fetchBeforeClosure(url, init);
        f.calls.length = 0;
        const response = await f.post({ seed: 42 });
        assert.equal(response.status, 200);
        assert.deepEqual(await response.json(), { job_id: JOB, idempotent: true });
        assert.equal(debits(f).length, 0); assert.equal(creates(f).length, 0);
        assert.ok(f.calls.some(c => c.url.pathname.endsWith('/jobs') && c.url.searchParams.get('user_id') === `eq.${AUTH}`));
        assert.equal(f.calls.some(c => c.url.pathname.endsWith('/model_catalog') || c.url.hostname.endsWith('.r2.cloudflarestorage.com')), false);
    } finally { f.restore(); }
});
for (const mismatch of ['prompt', 'source', 'model', 'hash']) test(`image replay refuses a different ${mismatch}`, async () => {
    const f = fixture();
    try {
        assert.equal((await f.post()).status, 200);
        if (mismatch === 'model') f.savedJob().model_id = 'veo-3.1-fast-kie';
        if (mismatch === 'hash') delete f.savedJob().inputs.veo_i2v;
        process.env.APP_RUNTIME_FLAGS = '{}'; f.calls.length = 0;
        const response = await f.post(mismatch === 'prompt' ? { prompt: 'different' } : {}, mismatch === 'source' ? { source_key: SOURCE.replace('.png', '.jpg') } : {});
        assert.equal(response.status, 409); assert.equal((await response.json()).error, 'idempotency_conflict');
        assert.equal(debits(f).length, 0); assert.equal(creates(f).length, 0);
    } finally { f.restore(); }
});
for (const replayFailure of ['users', 'jobs']) test(`image replay ${replayFailure} lookup failure is unknown, never a no-charge refusal`, async () => {
    const f = fixture({ flags: {}, replayFailure });
    try {
        const response = await f.post();
        assert.equal(response.status, 503); assert.deepEqual(await response.json(), { error: 'admission_unknown' });
        assert.equal(debits(f).length, 0); assert.equal(creates(f).length, 0);
    } finally { f.restore(); }
});
for (const [code, expected] of [[451, 'provider_moderation'], [422, 'provider_input_rejected']]) {
    for (const [part] of variants) test(`Veo ${part || '31'} i2v refusal ${code} retains safe errorCode`, async t => {
        t.mock.method(globalThis, 'fetch', async () => Response.json({ code, message: 'VENDOR_SECRET https://private.test/?X-Amz-Signature=secret' }));
        for (const suffix of ['t2v', 'i2v']) {
            const result = await submitTask({ job_id: JOB, provider_endpoint: `crun:google/veo3-1-${part}${suffix}`, inputs: { prompt: 'x', image_url: 'https://a/x' } }, { apiKey: 'test' });
            assert.equal(result.outcome, 'rejected'); assert.equal(result.errorCode, expected);
            assert.match(result.error, /^crun 200\//);
            assert.doesNotMatch(JSON.stringify(result), /VENDOR_SECRET|private|X-Amz-Signature/);
        }
    });
    test(`Veo image gateway returns HTTP 422 for refusal ${code}`, async () => {
        const f = fixture({ rejection: code });
        try {
            const response = await f.post();
            assert.equal(response.status, 422); assert.equal((await response.json()).error, expected);
            assert.equal(debits(f).length, 1); assert.equal(creates(f).length, 1);
        } finally { f.restore(); }
    });
}
test('catalog GET with enabled image flags stays publicly cacheable for 20 seconds', async () => {
    const f = fixture();
    try {
        const response = await catalogGET(new Request('https://veyrnox.test/api/catalog'));
        assert.equal(response.status, 200);
        assert.equal(response.headers.get('cache-control'), 'public, max-age=20, s-maxage=20');
    } finally { f.restore(); }
});
test('all Veo variants use two batched eligibility reads, reuse and expire the flag-keyed cache, and fail closed', async t => {
    const fixtures = variants.map((_, variant) => fixture({ variant }));
    // The custom read below is the only I/O; undo fixture network wrappers in reverse order.
    fixtures.toReversed().forEach(f => f.restore());
    const flags = { veoI2vLite: true, veoI2vFast: true, veoI2v31: true };
    process.env.APP_RUNTIME_FLAGS = JSON.stringify(flags);
    let now = Date.now(), failedTable = null;
    t.mock.method(Date, 'now', () => now);
    const reads = [];
    const read = async (table, query) => {
        reads.push({ table, query });
        if (table === failedTable) throw new Error('offline');
        if (table === 'model_catalog') return fixtures.map(f => f.row);
        if (table === 'model_routes') return fixtures.map(f => f.route);
        if (table === 'provider_spend_provider_policy') return [{ admission_open: true }];
        throw new Error(table);
    };
    const options = { cfg: { supabaseUrl: 'https://batch.test', serviceRoleKey: 'test' }, selectRows: read, waitUntil: null };
    const eligibilityReads = () => reads.filter(r => r.table !== 'model_catalog');
    const results = await Promise.all([readPublicCatalog(options), readPublicCatalog(options)]);
    assert.ok(results.every(rows => rows.every(row => row.capabilities.media.image)));
    assert.equal(eligibilityReads().length, 4, 'each concurrent miss owns its route and policy reads');
    const routeQuery = eligibilityReads().find(r => r.table === 'model_routes').query;
    assert.ok(variants.every(([, id]) => routeQuery.filter.includes(id)));
    assert.match(routeQuery.columns, /model_catalog/);
    await readPublicCatalog(options); assert.equal(eligibilityReads().length, 4, 'settled snapshots are reused');
    process.env.APP_RUNTIME_FLAGS = JSON.stringify({ ...flags, veoI2vFast: false });
    assert.equal((await readPublicCatalog(options))[1].capabilities.media.image, undefined);
    assert.equal(eligibilityReads().length, 6, 'flag changes select a different snapshot');
    for (const table of ['model_routes', 'provider_spend_provider_policy']) {
        failedTable = table; now += 21000;
        assert.ok((await readPublicCatalog(options)).every(row => !row.capabilities.media.image));
    }
    failedTable = null; now += 21000;
    assert.ok((await readPublicCatalog(options))[0].capabilities.media.image);
});

test('generation admission ignores a still-fresh discovery snapshot when a breaker opens', async () => {
    const f = fixture();
    try {
        const options = { cfg: { supabaseUrl: 'https://db.test', serviceRoleKey: 'test' }, selectRows: f.read, waitUntil: null };
        assert.ok((await readPublicCatalog(options))[0].capabilities.media.image);
        f.route.breaker_opened_at = new Date().toISOString();
        assert.ok((await readPublicCatalog(options))[0].capabilities.media.image, 'discovery may retain its bounded snapshot');
        const response = await f.post();
        assert.equal(response.status, 503); assert.equal((await response.json()).error, 'image_generation_unavailable');
        assert.equal(debits(f).length, 0); assert.equal(creates(f).length, 0);
    } finally { f.restore(); }
});

test('a stalled first catalog request cannot own the I/O awaited by a later request', async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const f = fixture();
    try {
        let routeReads = 0, started;
        const firstStarted = new Promise(resolve => { started = resolve; });
        const read = async table => {
            if (table === 'model_catalog') return [f.row];
            if (table === 'provider_spend_provider_policy') return [{ admission_open: true }];
            if (table === 'model_routes') {
                routeReads++;
                if (routeReads === 1) { started(); return new Promise(() => {}); }
                throw new Error('second request fails closed');
            }
            throw new Error(table);
        };
        const options = { cfg: { supabaseUrl: 'https://stalled.test', serviceRoleKey: 'test' }, selectRows: read, waitUntil: null };
        const first = readPublicCatalog(options);
        await firstStarted;
        const second = await Promise.race([readPublicCatalog(options), new Promise(resolve => setImmediate(() => resolve('blocked')))]);
        assert.notEqual(second, 'blocked', 'second request must finish without the first request or its timeout');
        assert.equal(second[0].capabilities.media.image, undefined);
        assert.equal(routeReads, 2);
        t.mock.timers.tick(eligibility.VEO_I2V_CATALOG_READ_TIMEOUT_MS ?? 1500);
        assert.equal((await first)[0].capabilities.media.image, undefined);
    } finally { f.restore(); }
});
test('catalog eligibility has a local deadline and late success cannot publish a positive snapshot', async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const f = fixture();
    try {
        let release, routeReads = 0, settled = false;
        const read = async table => {
            if (table === 'provider_spend_provider_policy') return [{ admission_open: true }];
            routeReads++; return new Promise(resolve => { release = resolve; });
        };
        const cfg = { supabaseUrl: 'https://deadline.test', serviceRoleKey: 'test' };
        const pending = eligibility.readVeoI2vCatalog(cfg, { read });
        pending.then(() => { settled = true; });
        const deadline = eligibility.VEO_I2V_CATALOG_READ_TIMEOUT_MS ?? 1500;
        t.mock.timers.tick(deadline - 1); await Promise.resolve();
        assert.equal(settled, false);
        t.mock.timers.tick(1);
        const answer = await Promise.race([pending, new Promise(resolve => setImmediate(() => resolve('unbounded')))]);
        assert.deepEqual(answer, {});
        release([f.route]); await new Promise(resolve => setImmediate(resolve));
        assert.deepEqual(await eligibility.readVeoI2vCatalog(cfg, { read }), {});
        assert.equal(routeReads, 1, 'late success must not replace the settled empty snapshot');
    } finally { f.restore(); }
});
for (let variant = 0; variant < 3; variant++) {
    test(`Veo variant ${variant} defaults only an empty image prompt and preserves its replay`, async () => {
        for (const prompt of ['', '   ', undefined]) {
            const f = fixture({ variant });
            try {
                const response = await f.post({ prompt });
                assert.equal(response.status, 200, JSON.stringify(await response.json()));
                assert.equal(creates(f)[0].body.input.prompt, DEFAULT_MOTION_PROMPT);
                assert.equal(debits(f)[0].body.p_inputs.prompt, DEFAULT_MOTION_PROMPT);
                assert.equal(capabilityFor(f.row.provider_endpoint).defaultPrompt, undefined);
                process.env.APP_RUNTIME_FLAGS = '{}'; f.calls.length = 0;
                const replay = await f.post({ prompt });
                assert.deepEqual(await replay.json(), { job_id: JOB, idempotent: true });
                assert.equal(debits(f).length, 0); assert.equal(creates(f).length, 0);
            } finally { f.restore(); }
        }
    });
    test(`Veo variant ${variant} still refuses empty text-only prompts without charging`, async () => {
        for (const flags of [{}, { veoI2vLite: true, veoI2vFast: true, veoI2v31: true }]) {
            for (const prompt of ['', '   ', undefined]) {
                const f = fixture({ variant, flags });
                try {
                    const response = await f.post({ prompt }, { source_key: undefined });
                    assert.equal(response.status, 400); assert.equal((await response.json()).error, 'prompt_required');
                    assert.equal(debits(f).length, 0); assert.equal(creates(f).length, 0);
                    assert.equal(capabilityFor(f.row.provider_endpoint).defaultPrompt, undefined);
                } finally { f.restore(); }
            }
        }
    });
}
