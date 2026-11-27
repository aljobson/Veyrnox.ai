// Long-prompt photo templates on kie Seedance 2 (ADR-0309 amendment 3): dark gate, price, exact prompt, refusal refund, routing.
import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { readFileSync } from 'node:fs';

register('data:text/javascript,' + encodeURIComponent(
    `export async function resolve(s, c, next) { return next(s === 'next/server' ? 'next/server.js' : s, c); }`,
));
Object.assign(process.env, {
    SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'test-service',
    KIE_API_KEY: 'test-kie', KIE_WEBHOOK_HMAC_KEY: 'test-hmac', PUBLIC_HOST: 'https://veyrnox.test',
    R2_ACCOUNT_ID: 'test', R2_ACCESS_KEY_ID: 'test-access', R2_SECRET_ACCESS_KEY: 'test-secret', R2_BUCKET: 'test',
});
delete process.env.APP_RUNTIME_FLAGS;
const generations = await import('../app/api/v1/generations/route.js');
const webhook = await import('../app/api/webhook/kie/route.js');
const { toPublicModels } = await import('../lib/publicCatalog.js');
const { SEEDANCE_LONG_MODEL_ID, SEEDANCE_LONG_PROMPT_MAX, seedanceLongModelOpen } = await import('../lib/seedanceLongTemplates.js');
const { longPromptTarget } = await import('../lib/templateLongPromptTarget.js');
const { KLING_V3_PROMPT_MAX } = await import('../lib/generationPromptLimits.js');
const { PEOPLE_BINDING_MODEL } = await import('../lib/templateBinding.js');
const { templateContract } = await import('../lib/templateContract.js');
const { PRESETS, GALLERY_PRESETS, galleryVideoPresets } = await import('../app/veyrnox/_lib/templates.js');
const { LONG_PROMPT_GALLERY_TEMPLATE_IDS, VIDEO_TEMPLATE_CAP } = await import('../app/veyrnox/_lib/videoTemplateGallery.js');
const { checkCatalogUpdates } = await import('../scripts/check-catalog-update-guards.mjs');

const ON = { APP_RUNTIME_FLAGS: JSON.stringify({ seedanceLongTemplates: true }) };
const AUTH = '11111111-1111-4111-8111-111111111111';
const JOB = '22222222-2222-4222-8222-222222222222';
const SOURCE = `uploads/${AUTH}/33333333-3333-4333-8333-333333333333.png`;
const TASK = 'seedance-long-task';
const ROW = { id: SEEDANCE_LONG_MODEL_ID, provider: 'kie', provider_endpoint: 'market:bytedance/seedance-2', modality: 'image-to-video',
    credits_5s: 58, active: true, gated_flag: false };
const COPYRIGHT = 'The request failed because the output video may be related to copyright restrictions.';
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jZQAAAABJRU5ErkJggg==', 'base64');
png.writeUInt32BE(1000, 16); png.writeUInt32BE(1000, 20);
const ghost = templateContract('ghost-makeover');

function network({ outcome = 'success' } = {}) {
    const calls = []; let processed = false; let inserted = false;
    const job = { id: JOB, user_id: AUTH, state: 'DEBITED', credits: 0, provider_endpoint: ROW.provider_endpoint };
    const real = globalThis.fetch;
    globalThis.fetch = async (url, init = {}) => {
        const u = new URL(String(url));
        const body = typeof init.body === 'string' ? JSON.parse(init.body) : undefined;
        calls.push({ url: u.href, method: init.method, body });
        if (u.pathname.includes('/rpc/')) {
            const name = u.pathname.split('/rpc/')[1];
            if (name === 'ledger_debit') { job.credits = body.p_credits; return Response.json({ ok: true, job_id: JOB, idempotent: false, balance_after: 500 }); }
            if (name === 'job_submitted') job.state = 'SUBMITTED';
            if (name === 'job_stored') job.state = 'STORED';
            if (name === 'ledger_refund') job.state = 'REFUNDED';
            return Response.json({ ok: true });
        }
        if (u.pathname === '/rest/v1/model_catalog') return Response.json([ROW]);
        if (u.pathname === '/rest/v1/users') return Response.json([{ id: AUTH }]);
        if (u.pathname === '/rest/v1/jobs') return Response.json([job]);
        if (u.pathname === '/rest/v1/model_routes') return Response.json([]);
        if (u.pathname === '/rest/v1/webhook_events') {
            if (init.method === 'POST') { const rows = inserted ? [] : [{ id: 'event' }]; inserted = true; return Response.json(rows, { status: 201 }); }
            if (init.method === 'PATCH') { processed = true; return new Response(null, { status: 204 }); }
            return Response.json([{ processed_at: processed ? 'done' : null }]);
        }
        if (u.hostname === 'api.kie.ai') {
            if (u.pathname.endsWith('/createTask')) return Response.json({ code: 200, data: { taskId: TASK } });
            if (u.pathname.endsWith('/recordInfo')) return Response.json({ code: 200, data: { state: outcome, failCode: '500', failMsg: COPYRIGHT,
                resultJson: JSON.stringify({ resultUrls: ['https://tempfile.aiquickdraw.com/test.mp4'] }) } });
        }
        if (u.hostname.endsWith('.r2.cloudflarestorage.com')) {
            if (init.method === 'PUT') return new Response(null, { status: 200 });
            return new Response(png, { status: 206, headers: { 'content-type': 'image/png', 'content-range': `bytes 0-${png.length - 1}/200000` } });
        }
        if (u.hostname === 'tempfile.aiquickdraw.com') return new Response('video-fixture', { status: 200, headers: { 'content-type': 'video/mp4' } });
        throw new Error(`Unexpected test request: ${u.hostname}${u.pathname}`);
    };
    return { calls, job, restore: () => { globalThis.fetch = real; } };
}
const post = () => generations.POST(new Request('https://veyrnox.test/api/v1/generations', {
    method: 'POST', headers: { 'x-veyrnox-auth-id': AUTH, 'content-type': 'application/json' },
    body: JSON.stringify({ model_id: SEEDANCE_LONG_MODEL_ID, idempotency_key: 'seedance-long-template-test', source_key: SOURCE, consent: true,
        inputs: { prompt: ghost.prompt, duration_seconds: 10, aspect_ratio: '9:16' } }),
}));
async function callback() {
    const timestamp = String(Math.floor(Date.now() / 1000));
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode('test-hmac'), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const signature = Buffer.from(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${TASK}.${timestamp}`))).toString('base64');
    return webhook.POST(new Request('https://veyrnox.test/api/webhook/kie', {
        method: 'POST', headers: { 'x-webhook-signature': signature, 'x-webhook-timestamp': timestamp },
        body: JSON.stringify({ data: { taskId: TASK, state: 'success' } }),
    }));
}
const rpc = (net, name) => net.calls.filter(c => c.url.includes(`/rpc/${name}`));
async function withFlag(on, fn) {
    if (on) process.env.APP_RUNTIME_FLAGS = ON.APP_RUNTIME_FLAGS; else delete process.env.APP_RUNTIME_FLAGS;
    try { return await fn(); } finally { delete process.env.APP_RUNTIME_FLAGS; }
}

test('while the runtime key is off the offer is refused before any charge and is not listed', async () => {
    await withFlag(false, async () => {
        assert.equal(seedanceLongModelOpen(SEEDANCE_LONG_MODEL_ID), false);
        assert.equal(seedanceLongModelOpen('kling-3.0-i2v'), true);
        const net = network();
        try {
            const res = await post();
            assert.equal(res.status, 404);
            assert.equal((await res.json()).error, 'model_not_found');
            assert.equal(rpc(net, 'ledger_debit').length, 0);
            assert.equal(net.calls.some(c => c.url.includes('api.kie.ai')), false);
        } finally { net.restore(); }
        assert.equal(toPublicModels([ROW]).length, 0);
    });
    for (const flags of ['', '{"seedanceLongTemplates":"true"}', 'not json']) {
        assert.equal(seedanceLongModelOpen(SEEDANCE_LONG_MODEL_ID, { APP_RUNTIME_FLAGS: flags }), false);
    }
});

test('with the key on: 116 credits for 10 s, the reference-first prompt and one picture reach kie, success stores once', async () => {
    await withFlag(true, async () => {
        assert.deepEqual(toPublicModels([ROW]).map(m => [m.id, m.credits]), [[SEEDANCE_LONG_MODEL_ID, 58]]);
        const net = network();
        try {
            const res = await post();
            assert.equal(res.status, 200, JSON.stringify(await res.clone().json()));
            assert.equal(rpc(net, 'ledger_debit')[0].body.p_credits, 116);
            const body = net.calls.find(c => c.url.endsWith('/createTask')).body;
            assert.equal(body.model, 'bytedance/seedance-2');
            assert.equal(body.input.prompt, ghost.prompt);
            assert.equal(body.input.prompt.length, ghost.prompt.length);
            assert.equal(body.input.reference_image_urls.length, 1);
            assert.equal('first_frame_url' in body.input, false);
            assert.deepEqual([body.input.duration, body.input.aspect_ratio, body.input.resolution, body.input.generate_audio], [10, '9:16', '720p', true]);
            assert.equal((await callback()).status, 200);
            assert.equal(net.job.state, 'STORED');
            assert.equal(rpc(net, 'ledger_refund').length, 0);
        } finally { net.restore(); }
    });
});

test('a kie refusal (copyright filter) fails the job and refunds the whole debit exactly once', async () => {
    await withFlag(true, async () => {
        const net = network({ outcome: 'fail' });
        try {
            assert.equal((await post()).status, 200);
            await callback(); await callback();
            assert.equal(net.job.state, 'REFUNDED');
            assert.equal(rpc(net, 'ledger_refund').length, 1);
            assert.equal(rpc(net, 'ledger_refund')[0].body.p_credits, 116);
        } finally { net.restore(); }
    });
});

test('routing: only a one-photo recipe over the Kling cap and within 20,000 characters leaves Kling', () => {
    assert.equal(KLING_V3_PROMPT_MAX, 2500);
    assert.equal(SEEDANCE_LONG_PROMPT_MAX, 20000);
    assert.equal(longPromptTarget(PEOPLE_BINDING_MODEL, 2500, 1), PEOPLE_BINDING_MODEL);
    assert.equal(longPromptTarget(PEOPLE_BINDING_MODEL, 2501, 1), SEEDANCE_LONG_MODEL_ID);
    assert.equal(longPromptTarget(PEOPLE_BINDING_MODEL, 20000, 1), SEEDANCE_LONG_MODEL_ID);
    assert.equal(longPromptTarget(PEOPLE_BINDING_MODEL, 20001, 1), PEOPLE_BINDING_MODEL);
    assert.equal(longPromptTarget(PEOPLE_BINDING_MODEL, 5000, 2), PEOPLE_BINDING_MODEL);
    assert.equal(longPromptTarget('seedance-2.0-fast', 5000, 0), 'seedance-2.0-fast');
    const long = PRESETS.map(p => templateContract(p.id)).filter(c => c?.modelId === SEEDANCE_LONG_MODEL_ID);
    assert.equal(long.length, 49);
    for (const c of long) {
        assert.equal(c.class, 'bound', c.id);
        assert.equal(c.slotCount, 1, c.id);
        assert.ok(c.prompt.length > KLING_V3_PROMPT_MAX && c.prompt.length <= SEEDANCE_LONG_PROMPT_MAX, c.id);
        assert.deepEqual(c.allowedModels, [SEEDANCE_LONG_MODEL_ID]);
    }
    assert.equal(ghost.promptHash, ghost.boundHash, 'the probed reference-first prompt');
    for (const id of ['impact', 'cake-in-the-fridge']) {
        const c = templateContract(id);
        assert.equal(c.class, 'unsupported');
        assert.ok(c.reasons.includes('prompt-limit'));
        assert.ok(c.sourcePrompt.length > SEEDANCE_LONG_PROMPT_MAX);
    }
});

test('gallery: unchanged while off; 15 long-prompt templates join while on, all bound to the offer', () => {
    assert.equal(galleryVideoPresets({}).length, GALLERY_PRESETS.length);
    const on = galleryVideoPresets(ON);
    assert.equal(on.length, GALLERY_PRESETS.length + 15);
    assert.ok(on.length <= VIDEO_TEMPLATE_CAP);
    assert.equal(LONG_PROMPT_GALLERY_TEMPLATE_IDS.length, 15);
    for (const id of ['impact', 'cake-in-the-fridge', 'jellyfish-airlines']) assert.equal(LONG_PROMPT_GALLERY_TEMPLATE_IDS.includes(id), false);
    for (const id of LONG_PROMPT_GALLERY_TEMPLATE_IDS) {
        assert.equal(templateContract(id).modelId, SEEDANCE_LONG_MODEL_ID, id);
        assert.equal(GALLERY_PRESETS.some(p => p.id === id), false, id);
    }
    assert.ok(on.some(p => p.category === 'MOVIES'));
});

test('migration 0573: one dark-safe offer at the catalog floor, one mirroring route, no catalog UPDATE', () => {
    const name = '0573_seedance_photo_kie_long_templates.sql';
    const sql = readFileSync(new URL(`../packages/db/schema/supabase/${name}`, import.meta.url), 'utf8');
    assert.deepEqual(checkCatalogUpdates(sql, name), []);
    assert.doesNotMatch(sql.replace(/--.*$/gm, ''), /\bUPDATE\b/i);
    assert.equal(Math.ceil(1.025 / 0.01796), 58);
    assert.match(sql, /'seedance-2\.0-photo-kie', 'Seedance 2\.0 · Photo · kie', 'kie', 'market:bytedance\/seedance-2', 'image-to-video',\s+58, 1\.0250, 'per_second', 5, false, true\)/);
    assert.match(sql, /ON CONFLICT \(id\) DO NOTHING/);
    assert.match(sql, /ON CONFLICT \(model_id, priority\) DO NOTHING/);
    assert.equal((sql.match(/RAISE EXCEPTION/g) || []).length, 3);
});

test('themes: every long-prompt gallery template has a theme; the new theme chips only show while the key is on', async () => {
    const { videoTemplateTheme, VIDEO_THEME_IDS } = await import('../app/veyrnox/_lib/videoTemplateThemes.js');
    for (const id of LONG_PROMPT_GALLERY_TEMPLATE_IDS) assert.ok(VIDEO_THEME_IDS.includes(videoTemplateTheme(id)), `${id} has no theme`);
    const counts = {};
    for (const id of LONG_PROMPT_GALLERY_TEMPLATE_IDS) counts[videoTemplateTheme(id)] = (counts[videoTemplateTheme(id)] || 0) + 1;
    assert.deepEqual(counts, { HORROR: 2, COMEDY: 2, FILM: 5, MAGIC: 3, ACTION: 2, DANCE: 1 });
    const offThemes = new Set(GALLERY_PRESETS.map(p => videoTemplateTheme(p.id)));
    for (const theme of ['HORROR', 'MAGIC']) assert.equal(offThemes.has(theme), false, `${theme} would show empty while off`);
});

test('production APP_RUNTIME_FLAGS turns the long templates on beside the existing keys, with no separate var (ADR-0309 amendment 4)', async () => {
    const { parseJsonc } = await import('../scripts/check-migration-ledger.mjs');
    const config = parseJsonc(readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8'));
    const flags = JSON.parse(config.vars.APP_RUNTIME_FLAGS);
    assert.deepEqual(flags, { checkin: true, push: true, templateSwap: true, seedanceLongTemplates: true, templateSwapCrun1080: true });
    assert.equal(seedanceLongModelOpen(SEEDANCE_LONG_MODEL_ID, { APP_RUNTIME_FLAGS: config.vars.APP_RUNTIME_FLAGS }), true);
    assert.equal(galleryVideoPresets({ APP_RUNTIME_FLAGS: config.vars.APP_RUNTIME_FLAGS }).length, GALLERY_PRESETS.length + 15);
    assert.equal(Object.keys(config.vars).some(k => /SEEDANCE_LONG/i.test(k)), false);
});
