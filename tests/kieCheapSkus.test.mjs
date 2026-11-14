import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

register('data:text/javascript,' + encodeURIComponent(
    `export async function resolve(s, c, next) { return next(s === 'next/server' ? 'next/server.js' : s, c); }`,
));
Object.assign(process.env, {
    SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'test-service',
    KIE_API_KEY: 'test-kie', KIE_WEBHOOK_HMAC_KEY: 'test-hmac', PUBLIC_HOST: 'https://veyrnox.test',
    R2_ACCOUNT_ID: 'test', R2_ACCESS_KEY_ID: 'test-access', R2_SECRET_ACCESS_KEY: 'test-secret', R2_BUCKET: 'test',
});
const generations = await import('../app/api/v1/generations/route.js');
const webhook = await import('../app/api/webhook/kie/route.js');
const AUTH = '11111111-1111-4111-8111-111111111111';
const JOB = '22222222-2222-4222-8222-222222222222';
const SOURCE = `uploads/${AUTH}/33333333-3333-4333-8333-333333333333.png`;
const TASK = 'kling-test-task';
const rows = [
    ['kling-3.0-i2v-720p-kie', 'market:kling-3.0/video-std', 'image-to-video', 22],
    ['seedance-2.0-mini-kie', 'market:bytedance/seedance-2-mini', 'text-to-video', 13],
    ['wan-2.6-flash-i2v-kie', 'market:wan/2-6-flash-image-to-video', 'image-to-video', 7],
    ['seedream-5-flash-kie', 'market:seedream/5-flash-text-to-image', 'text-to-image', 1],
    ['kling-3.0-i2v-kie', 'market:kling-3.0/video', 'image-to-video', 28],
].map(([id, provider_endpoint, modality, credits_5s]) => ({ id, provider_endpoint, modality, credits_5s, provider: 'kie', active: true, gated_flag: false }));
const { capabilityFor, publicCapabilities, checkSource } = await import('../lib/modelCapabilities.js');
const { buildRequest, parseEndpoint } = await import('../packages/adapters/kie.js');
const { resolveUploadedSource, resolveAssetSource } = await import('../lib/resolveSource.js');
const CFG = { accountId: 'test', accessKeyId: 'test-access', secretAccessKey: 'test-secret', bucket: 'test' };
const ASSET = '44444444-4444-4444-8444-444444444444';
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jZQAAAABJRU5ErkJggg==', 'base64');

// Real route handlers/adapters, isolated fake network; no external credentials or spend.
function network(model, { active = true, submitFails = false, outcome = 'success', width = 256, height = 256, bytes = 10000000, unreadable = false, rangeStatus = 206 } = {}) {
    const source = Buffer.from(png); source.writeUInt32BE(width, 16); source.writeUInt32BE(height, 20);
    const inspected = unreadable ? source.subarray(0, 16) : source;
    const calls = []; let processed = false; let inserted = false;
    const job = { id: JOB, user_id: AUTH, state: 'DEBITED', credits: 0, provider_endpoint: model.provider_endpoint };
    const real = globalThis.fetch;
    globalThis.fetch = async (url, init = {}) => {
        const u = new URL(String(url));
        const body = typeof init.body === 'string' ? JSON.parse(init.body) : undefined;
        calls.push({ url: u.href, method: init.method, body });
        if (u.pathname.includes('/rpc/')) {
            const name = u.pathname.split('/rpc/')[1];
            if (name === 'get_user_asset') return Response.json({ ok: true, state: 'STORED', r2_key: 'assets/owned.png', mime_type: 'image/png' });
            if (name === 'ledger_debit') { job.credits = body.p_credits; return Response.json({ ok: true, job_id: JOB, idempotent: false, balance_after: 100 }); }
            if (name === 'job_submitted') job.state = 'SUBMITTED';
            if (name === 'job_succeeded') job.state = 'SUCCEEDED';
            if (name === 'job_stored') job.state = 'STORED';
            if (name === 'ledger_refund') job.state = 'REFUNDED';
            return Response.json({ ok: true });
        }
        if (u.pathname === '/rest/v1/model_catalog') return Response.json([{ ...model, active }]);
        if (u.pathname === '/rest/v1/users') return Response.json([{ id: AUTH }]);
        if (u.pathname === '/rest/v1/jobs') return Response.json([job]);
        if (u.pathname === '/rest/v1/webhook_events') {
            if (init.method === 'POST') { const rows = inserted ? [] : [{ id: 'event' }]; inserted = true; return Response.json(rows, { status: 201 }); }
            if (init.method === 'PATCH') { processed = true; return new Response(null, { status: 204 }); }
            return Response.json([{ processed_at: processed ? 'done' : null }]);
        }
        if (u.hostname === 'api.kie.ai') {
            if (u.pathname.endsWith('/createTask')) return Response.json(submitFails ? { code: 422, msg: 'rejected' } : { code: 200, data: { taskId: TASK } });
            if (u.pathname.endsWith('/recordInfo')) return Response.json({ code: 200, data: { state: outcome, failCode: '500', resultJson: JSON.stringify({ resultUrls: ['https://tempfile.aiquickdraw.com/test.mp4'] }) } });
        }
        if (u.hostname.endsWith('.r2.cloudflarestorage.com')) {
            if (init.method === 'PUT') return new Response(null, { status: 200 });
            return new Response(inspected, { status: rangeStatus, headers: { 'content-type': 'image/png', ...(rangeStatus === 206 ? { 'content-range': `bytes 0-${inspected.length - 1}/${bytes}` } : {}) } });
        }
        if (u.hostname === 'tempfile.aiquickdraw.com') return new Response(model.modality === 'text-to-image' ? png : 'video-fixture', { status: 200, headers: { 'content-type': model.modality === 'text-to-image' ? 'image/png' : 'video/mp4' } });
        throw new Error(`Unexpected test request: ${u.hostname}${u.pathname}`);
    };
    return { calls, job, restore: () => { globalThis.fetch = real; } };
}
function post(model, extra = {}) {
    return generations.POST(new Request('https://veyrnox.test/api/v1/generations', {
        method: 'POST', headers: { 'x-veyrnox-auth-id': AUTH, 'content-type': 'application/json' },
        body: JSON.stringify({ model_id: model.id, idempotency_key: 'kling-gateway-test', ...(model.modality === 'image-to-video' ? { source_key: SOURCE, consent: true } : {}), inputs: { prompt: 'Move slowly', duration_seconds: 5 }, ...extra }),
    }));
}
async function callback() {
    const timestamp = String(Math.floor(Date.now() / 1000));
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode('test-hmac'), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const signature = Buffer.from(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${TASK}.${timestamp}`))).toString('base64');
    return webhook.POST(new Request('https://veyrnox.test/api/webhook/kie', {
        method: 'POST', headers: { 'x-webhook-signature': signature, 'x-webhook-timestamp': timestamp },
        // Forged callback outcome must be ignored in favor of authenticated recordInfo.
        body: JSON.stringify({ data: { taskId: TASK, state: 'success', resultJson: JSON.stringify({ resultUrls: ['https://attacker.example/forged.mp4'] }) } }),
    }));
}
const rpcCalls = (net, name) => net.calls.filter(c => c.url.includes(`/rpc/${name}`));

const expectedInputs = [
    { prompt: 'Move slowly', image_urls: ['https://source.test/image.png'], duration: '5', mode: 'std', sound: false, multi_shots: false, multi_prompt: [] },
    { prompt: 'Move slowly', resolution: '720p', duration: 5, generate_audio: false, aspect_ratio: '16:9', nsfw_checker: true },
    { prompt: 'Move slowly', image_urls: ['https://source.test/image.png'], duration: '5', resolution: '720p', audio: false, multi_shots: false, nsfw_checker: true },
    { prompt: 'Move slowly', size: '1K', output_format: 'png', aspect_ratio: '1:1', nsfw_checker: true },
];
const adapterInputs = row => ({ prompt: 'Move slowly', duration_seconds: 5, ...(row.modality === 'image-to-video' ? { image_url: 'https://source.test/image.png' } : {}) });

test('new endpoints parse and pin exactly their catalog tier; registry agrees', () => {
    for (const [index, row] of rows.slice(0, 4).entries()) {
        const target = parseEndpoint(row.provider_endpoint);
        assert.deepEqual(target, { kind: 'market', model: row.provider_endpoint.slice(7) });
        assert.deepEqual(buildRequest(target, adapterInputs(row)), { ok: true, body: {
            model: index === 0 ? 'kling-3.0/video' : target.model, input: expectedInputs[index],
        } });
        const record = capabilityFor(row.provider_endpoint), advertised = publicCapabilities(record);
        assert.equal(record.strictInputs, true);
        assert.equal(record.provider, 'kie');
        assert.deepEqual(advertised.lengths, [5]);
        assert.equal(advertised.inputs.prompt.max, index === 2 ? 1500 : 2000);
        for (const [key, value] of Object.entries(record.fixed)) assert.deepEqual(expectedInputs[index][key], value);
        if (record.lengths) assert.deepEqual(record.lengths.map[5], expectedInputs[index].duration);
        if (row.modality === 'image-to-video') assert.equal(advertised.media.image.required, true);
        else assert.deepEqual(advertised.media, {});
        for (const ratio of advertised.inputs.aspect_ratio?.values || []) {
            assert.ok(!['2:3', '3:2', 'adaptive'].includes(ratio));
            assert.equal(buildRequest(target, { ...adapterInputs(row), aspect_ratio: ratio }).body.input.aspect_ratio, ratio);
        }
    }
    const wan = publicCapabilities(capabilityFor(rows[2].provider_endpoint)).media.image;
    assert.deepEqual([wan.minWidth, wan.minHeight, wan.maxBytes], [256, 256, 10000000]);
});

test('adapter refuses every undeclared control, costly mode, duration and missing image', () => {
    const unsupported = { negative_prompt: 'blur', seed: 1, sound: true, audio: true, generate_audio: true,
        resolution: '1080p', output_resolution: '1080p', audio_enabled: true, mode: 'pro', size: '2K',
        first_frame_url: 'https://source.test/a.png', last_frame_url: 'https://source.test/b.png',
        reference_image_urls: [], reference_video_urls: [], reference_audio_urls: [], web_search: true,
        image_urls: ['https://source.test/a.png'], multi_shots: true, multi_prompt: [], kling_elements: [], output_format: 'jpeg', nsfw_checker: false };
    for (const row of rows.slice(0, 4)) {
        const target = parseEndpoint(row.provider_endpoint), inputs = adapterInputs(row);
        for (const [key, value] of Object.entries(unsupported)) {
            assert.equal(buildRequest(target, { ...inputs, [key]: value }).ok, false, `${row.id}: ${key}`);
        }
        for (const seconds of [4, 10, 15, -1, '5']) assert.equal(buildRequest(target, { ...inputs, duration_seconds: seconds }).ok, false);
        for (const ratio of ['2:3', '3:2', 'adaptive']) assert.equal(buildRequest(target, { ...inputs, aspect_ratio: ratio }).ok, false);
        if (row.modality === 'image-to-video') {
            for (const image_url of [undefined, '', [], 42]) assert.equal(buildRequest(target, { ...inputs, image_url }).ok, false);
        } else assert.equal(buildRequest(target, { ...inputs, image_url: 'https://source.test/a.png' }).ok, false);
        const rule = capabilityFor(row.provider_endpoint).inputs.prompt;
        for (const length of [rule.max, (rule.min || 1)]) assert.equal(buildRequest(target, { ...inputs, prompt: 'x'.repeat(length) }).ok, true);
        for (const length of [rule.max + 1, (rule.min || 1) - 1]) assert.equal(buildRequest(target, { ...inputs, prompt: 'x'.repeat(length) }).ok, false);
    }
});

for (const [index, row] of rows.entries()) {
    test(`${row.id}: preflight, priced debit, submission and authenticated callback lookup`, async () => {
        const net = network(row);
        try {
            const response = await post(row);
            assert.equal(response.status, 200, JSON.stringify(await response.json()));
            assert.equal(rpcCalls(net, 'ledger_debit')[0].body.p_credits, row.credits_5s);
            const body = net.calls.find(c => c.url.endsWith('/createTask')).body;
            assert.equal(body.model, [0, 4].includes(index) ? 'kling-3.0/video' : row.provider_endpoint.slice(7));
            if ([0, 4].includes(index)) assert.equal(body.input.mode, index === 0 ? 'std' : 'pro');
            if (index < 4) {
                const expected = { ...expectedInputs[index] };
                if (expected.image_urls) expected.image_urls = body.input.image_urls;
                assert.deepEqual(body.input, expected);
            }
            assert.equal((await callback()).status, 200);
            assert.equal(net.job.state, 'STORED');
            assert.ok(net.calls.some(c => c.url.endsWith(`/recordInfo?taskId=${TASK}`)));
            assert.ok(net.calls.some(c => c.method === 'PUT'));
            assert.ok(!net.calls.some(c => c.url.includes('attacker.example')));
            await callback();
            assert.equal(rpcCalls(net, 'job_stored').length, 1);
            assert.equal(rpcCalls(net, 'ledger_refund').length, 0);
        } finally { net.restore(); }
    });
    test(`${row.id}: rejected submission and failed callback refund the full debit once`, async () => {
        for (const options of [{ submitFails: true }, { outcome: 'fail' }]) {
            const net = network(row, options);
            try {
                assert.equal((await post(row)).status, options.submitFails ? 502 : 200);
                if (!options.submitFails) { await callback(); await callback(); }
                assert.equal(net.job.state, 'REFUNDED');
                assert.equal(rpcCalls(net, 'ledger_refund').length, 1);
                assert.equal(rpcCalls(net, 'ledger_refund')[0].body.p_credits, row.credits_5s);
            } finally { net.restore(); }
        }
    });
}

for (const row of rows.slice(0, 4)) {
    test(`${row.id}: every advertised aspect and maximum prompt works through the real route`, async () => {
        const record = capabilityFor(row.provider_endpoint);
        for (const aspect of record.inputs.aspect_ratio?.values || [undefined]) {
            const net = network(row);
            try {
                const inputs = { prompt: 'x'.repeat(record.inputs.prompt.max), ...(aspect ? { aspect_ratio: aspect } : {}) };
                const response = await post(row, { inputs });
                assert.equal(response.status, 200, JSON.stringify(await response.json()));
                if (aspect) assert.equal(net.calls.find(c => c.url.endsWith('/createTask')).body.input.aspect_ratio, aspect);
            } finally { net.restore(); }
        }
    });
    test(`${row.id}: inactive, overlong prompts and unsupported globally valid controls cannot debit`, async () => {
        const cap = capabilityFor(row.provider_endpoint).inputs.prompt.max;
        const controls = [{ negative_prompt: 'blur' }, { seed: 1 }, { output_resolution: '720p' }, { audio_enabled: false },
            { duration_seconds: 10 }, { resolution: '1080p' }, { generate_audio: true }, { web_search: true },
            { first_frame_url: 'https://source.test/a.png' }, { last_frame_url: 'https://source.test/b.png' },
            { reference_image_urls: [] }, { reference_video_urls: [] }, { reference_audio_urls: [] },
            { aspect_ratio: '2:3' }, { aspect_ratio: '3:2' }, { aspect_ratio: 'adaptive' },
            { image_url: 'https://unowned.test/a.png' }, { prompt: 'x'.repeat(cap + 1) }, { prompt: 'x'.repeat(2001) }];
        if (row === rows[2]) controls.push({ aspect_ratio: '16:9' });
        for (const [options, extra] of [[{ active: false }, {}], ...controls.map(input => [{}, { inputs: { prompt: 'Move slowly', ...input } }])]) {
            const net = network(row, options);
            try {
                const response = await post(row, extra);
                assert.ok(response.status >= 400, JSON.stringify(extra));
                assert.equal(typeof (await response.json()).error, 'string');
                assert.equal(rpcCalls(net, 'ledger_debit').length, 0);
                assert.ok(!net.calls.some(c => c.url.includes('api.kie.ai')));
            } finally { net.restore(); }
        }
    });
    test(`${row.id}: source requirements reject missing images and sources on text-only rows`, async () => {
        const net = network(row);
        try {
            const extra = row.modality === 'image-to-video' ? { source_key: undefined } : { source_key: SOURCE, consent: true };
            assert.equal((await post(row, extra)).status, 400);
            assert.equal(rpcCalls(net, 'ledger_debit').length, 0);
        } finally { net.restore(); }
    });
}

for (const library of [false, true]) {
    test(`Wan ${library ? 'Library' : 'upload'} sources: inclusive dimensions/bytes and pre-debit rejection`, async () => {
        for (const [options, error] of [
            [{ width: 256, height: 256, bytes: 10000000 }, null],
            [{ width: 257, height: 512, bytes: 9999999 }, null],
            [{ width: 255 }, 'source_too_small'], [{ height: 255 }, 'source_too_small'],
            [{ width: 0 }, 'source_size_unknown'], [{ unreadable: true }, 'source_size_unknown'],
            [{ bytes: 10000001 }, 'source_too_large'],
        ]) {
            const net = network(rows[2], options);
            try {
                const extra = library ? { source_key: undefined, source_assets: [ASSET] } : {};
                const response = await post(rows[2], extra);
                assert.equal(response.status, error ? 400 : 200, JSON.stringify(options));
                if (error) assert.equal((await response.json()).error, error);
                assert.equal(rpcCalls(net, 'ledger_debit').length, error ? 0 : 1);
                assert.equal(net.calls.filter(c => c.url.endsWith('/createTask')).length, error ? 0 : 1);
            } finally { net.restore(); }
        }
    });
    test(`inspected size metadata retained for ${library ? 'Library' : 'upload'} with 206 and full 200`, async () => {
        for (const status of [206, 200]) {
            const net = network(rows[2], { rangeStatus: status });
            try {
                const source = library ? await resolveAssetSource(AUTH, ASSET, CFG, { supabaseUrl: 'https://db.test', serviceRoleKey: 'test-service' }) : await resolveUploadedSource(AUTH, SOURCE, CFG);
                assert.equal(source.ok, true);
                assert.equal(source.sizeBytes, status === 206 ? 10000000 : png.length);
                assert.deepEqual(source.dimensions, { width: 256, height: 256 });
            } finally { net.restore(); }
        }
    });
}

test('Wan fails closed on unknown bytes/dimensions; existing Pro source checks are unchanged', () => {
    const wan = capabilityFor(rows[2].provider_endpoint), pro = capabilityFor(rows[4].provider_endpoint);
    for (const metadata of [{}, { dimensions: { width: 256, height: 256 } }, { sizeBytes: 10 }, { sizeBytes: NaN }, { dimensions: { width: NaN, height: 256 }, sizeBytes: 10 }]) {
        assert.equal(checkSource(wan, { image_url: metadata }).ok, false);
        assert.equal(checkSource(pro, { image_url: metadata }).ok, true);
    }
});
