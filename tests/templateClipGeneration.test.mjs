import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { isDeepStrictEqual } from 'node:util';
import { manifest, catalog, kieCatalog, kieSource } from './fixtures/templateClips.mjs';
import { createFalWebhookHandler } from '../lib/falWebhookHandler.js';
import { TEMPLATE_CLIP_PROMPT, templateClipProviderPrompt } from '../lib/templateClipPrompt.mjs';
register('data:text/javascript,' + encodeURIComponent(`
export async function resolve(s,c,next) { return next(s === 'next/server' ? 'next/server.js' : s,c); }
export async function load(url,c,next) {
  const result = await next(url,c);
  if (url.endsWith('/lib/templateClipSources.js')) return { ...result, source: String(result.source).replace('Object.freeze({})', ${JSON.stringify(JSON.stringify(manifest))}) };
  return result;
}`));
Object.assign(process.env, {
  TEMPLATE_CLIP_ENABLED: 'true', SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'test-service', FAL_KEY: 'test-fal', KIE_API_KEY: 'test-kie',
  PUBLIC_HOST: 'https://veyrnox.test', R2_ACCOUNT_ID: 'test', R2_ACCESS_KEY_ID: 'test', R2_SECRET_ACCESS_KEY: 'test', R2_BUCKET: 'test',
  FREE_ALLOWANCE_ENABLED: 'false', FAL_DURABLE_DISPATCH_ENABLED: 'false', FAL_DISPATCH_SCHEMA_ENABLED: 'false',
  SUPPLIER_ROUTES_ENABLED: 'false', MAX_CHARGE_ENABLED: 'false', MULTI_REFERENCE_ENABLED: 'false',
});
const { POST } = await import('../app/api/v1/generations/route.js');
const { GET } = await import('../app/api/catalog/route.js');
const { TEMPLATE_CLIP_SOURCES } = await import('../lib/templateClipSources.js');
const EFFECTIVE_PROMPT = templateClipProviderPrompt(TEMPLATE_CLIP_PROMPT, 'seedance-2.0-reference');
const ID = 'medieval-runway-look';
const AUTH = '11111111-1111-4111-8111-111111111111', JOB = '22222222-2222-4222-8222-222222222222';
const PHOTO = '33333333-3333-4333-8333-333333333333';
const photo = { slot: 'image', origin: 'asset', asset_id: PHOTO };
const jpeg = Buffer.from([255,216,255,192,0,17,8,2,128,2,128,3,1,17,0,2,17,0,3,17,0,255,217]);
function network(t, options = {}) {
  const sourceJpeg = Buffer.from(jpeg);
  if (options.imageDimensions) {
    sourceJpeg.writeUInt16BE(options.imageDimensions.height, 7); sourceJpeg.writeUInt16BE(options.imageDimensions.width, 9);
  }
  const freeAdmissions = [], debits = [], submits = [], calls = [], refunds = [], identities = new Map(); let charges = 0;
  // Mirrors migration 0399's non-chat identity; SQL itself is not run here.
  const identity = body => ({ model: body.p_model_id, inputs: Object.fromEntries(Object.entries(body.p_inputs).filter(([k]) => !['preset_id','source_keys','source_assets'].includes(k))) });
  t.mock.method(globalThis, 'fetch', async (target, init = {}) => {
    const url = new URL(String(target)), name = url.pathname.split('/').at(-1);
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : null;
    calls.push(name);
    if (name === 'runtime_switches') return Response.json([{ key: 'generation', state: 'off' }]);
    if (name === 'model_catalog') {
      if (options.catalogFailure) throw Error('offline');
      const filter = url.searchParams.get('id');
      return Response.json((options.catalog || catalog).filter(r => !filter || `eq.${r.id}` === filter || filter === 'in.(seedance-2.0-reference,seedance-2.0-reference-kie)').map(r => ({ ...r, active: options.active === false ? false : r.active })));
    }
    if (name === 'users') return Response.json([{ id: AUTH }]);
    if (name === 'jobs') {
      assert.equal(url.searchParams.get('user_id'), `eq.${AUTH}`);
      const stored = identities.get(url.searchParams.get('idempotency_key')?.slice(3));
      return Response.json(stored ? [{ id: JOB, model_id: stored.model, inputs: stored.inputs }] : []);
    }
    if (url.pathname.includes('/rpc/')) {
      if (name === 'check_generation_rate_limit' && options.throttled) return Response.json({ ok: false, code: 'RATE_LIMITED' });
      if (name === 'get_user_asset') {
        assert.equal(body.p_auth_id, AUTH);
        return Response.json({ ok: true, state: 'STORED', mime_type: 'image/jpeg', r2_key: `jobs/${PHOTO}/output.jpg` });
      }
      if (name === 'submit_free_job') {
        freeAdmissions.push(body); const value = identity(body), previous = identities.get(body.p_idempotency_key);
        if (previous && !isDeepStrictEqual(previous, value)) return Response.json({ ok: false, code: 'IDEMPOTENCY_CONFLICT' });
        if (!previous) identities.set(body.p_idempotency_key, value);
        return Response.json({ ok: true, taken: true, idempotent: !!previous, job_id: JOB });
      }
      if (name === 'ledger_refund') refunds.push(body);
      if (name === 'ledger_debit') {
        debits.push(body); const value = identity(body), previous = identities.get(body.p_idempotency_key);
        if (previous && !isDeepStrictEqual(previous, value)) return Response.json({ ok: false, code: 'IDEMPOTENCY_CONFLICT' });
        if (!previous) { charges++; identities.set(body.p_idempotency_key, value); }
        return Response.json({ ok: true, idempotent: !!previous, job_id: JOB, balance_after: 500 });
      }
      return Response.json({ ok: true });
    }
    if (url.hostname.endsWith('.r2.cloudflarestorage.com')) {
      assert.ok(!url.pathname.includes('template-clips/'), 'trusted shared clips are never sniffed or downloaded');
      assert.ok(url.pathname.endsWith(`jobs/${PHOTO}/output.jpg`));
      const [, a, b] = /bytes=(\d+)-(\d+)/.exec(init.headers.Range);
      const start = Number(a), end = Math.min(Number(b), sourceJpeg.length - 1);
      return new Response(sourceJpeg.subarray(start, end + 1), { status: 206, headers: { 'content-type': 'image/jpeg', 'content-range': `bytes ${start}-${end}/${sourceJpeg.length}` } });
    }
    if (['queue.fal.run', 'api.crun.ai', 'api.kie.ai'].includes(url.hostname)) {
      submits.push(body);
      if (options.providerFailure) return Response.json({ detail: 'rejected' }, { status: 422 });
      return Response.json(url.hostname === 'api.kie.ai' ? { code: 200, data: { taskId: 'fixture-task' } } : { request_id: 'fixture-task' });
    }
    throw Error(`Unexpected network ${url.hostname}${url.pathname}`);
  });
  return { freeAdmissions, debits, submits, calls, refunds, charges: () => charges };
}
function post(overrides = {}) {
  return POST(new Request('https://veyrnox.test/api/v1/generations', { method: 'POST', headers: { 'x-veyrnox-auth-id': AUTH }, body: JSON.stringify({ model_id: 'seedance-2.0-reference', template_clip: 'medieval-runway-look',
    inputs: {}, consent: true, references: [photo], idempotency_key: 'scene-proof-key', ...overrides }) }));
}
function get(id, auth = true) {
  return GET(new Request('https://veyrnox.test/api/catalog?template_clip=' + encodeURIComponent(id), { headers: auth ? { 'x-veyrnox-auth-id': AUTH } : {} }));
}

test('catalog price, server prompt, signed video list and photo list use the existing admission', async t => {
  const net = network(t);
  const response = await get(ID), view = await response.json();
  assert.deepEqual(view, { id: ID, model: 'seedance-2.0-reference', credits: 85, durationSeconds: 5 });
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal((await post({ inputs: { prompt: TEMPLATE_CLIP_PROMPT } })).status, 200);
  assert.equal(net.debits[0].p_credits, 85);
  assert.deepEqual(net.debits[0].p_inputs.template_source, { template: ID, version: 'v1', sha256: 'a'.repeat(64) });
  assert.equal(net.debits[0].p_inputs.prompt, EFFECTIVE_PROMPT);
  assert.deepEqual(net.debits[0].p_inputs.references, [photo]);
  assert.doesNotMatch(JSON.stringify(net.debits[0].p_inputs), /https:|template-clips\//);
  const payload = net.submits[0];
  assert.equal(payload.prompt, EFFECTIVE_PROMPT);
  assert.equal(payload.image_urls.length, 1); assert.equal(payload.video_urls.length, 1);
  const signed = new URL(payload.video_urls[0]);
  assert.ok(signed.pathname.endsWith(TEMPLATE_CLIP_SOURCES[ID].key));
  assert.equal(signed.searchParams.get('X-Amz-Expires'), '900');
  assert.equal(payload.duration, '5'); assert.equal(payload.resolution, '720p'); assert.equal(payload.generate_audio, true);
});
for (const flag of [undefined, 'false', 'TRUE', '1']) test(`flag ${flag} refuses before replay or media`, async t => {
  const net = network(t); process.env.TEMPLATE_CLIP_ENABLED = flag;
  t.after(() => { process.env.TEMPLATE_CLIP_ENABLED = 'true'; });
  assert.equal((await get(ID)).status, 404);
  assert.deepEqual(await (await post()).json(), { error: 'template_clip_not_found' });
  assert.deepEqual(net.calls, ['check_generation_rate_limit']);
});
for (const [overrides, error] of [
  [{ model_id: 'kling-3.0-i2v' }, 'template_clip_model_mismatch'],
  [{ references: [] }, 'template_clip_photo_count'],
  [{ references: [photo, photo] }, 'template_clip_photo_count'],
  [{ references: [{ ...photo, slot: 'video' }] }, 'template_clip_video_not_allowed'],
  [{ references: [{ origin: 'upload', slot: 'image', key: `uploads/${AUTH}/${PHOTO}.mp4` }] }, 'template_clip_video_not_allowed'],
  [{ video_urls: [] }, 'template_clip_video_not_allowed'],
  [{ inputs: { video_url: 'https://caller.test/clip.mp4' } }, 'template_clip_video_not_allowed'],
  [{ inputs: { video_urls: ['https://caller.test/clip.mp4'] } }, 'template_clip_video_not_allowed'],
  [{ consent: false }, 'consent_required'],
  [{ inputs: { duration_seconds: 10 } }, 'duration_not_supported'],
  [{ template_clip: '../oops' }, 'template_clip_not_found'],
]) test(`admission refuses ${JSON.stringify(overrides)}`, async t => {
  const net = network(t), response = await post(overrides);
  assert.equal((await response.json()).error, error); assert.equal(net.debits.length, 0); assert.equal(net.submits.length, 0);
});
for (const [change, error] of [[{ videoSeconds: 1 }, 'source_too_short'], [{ seconds: 11 }, 'source_too_long'], [{ width: 299 }, 'source_resolution_out_of_range'], [{ height: 2161 }, 'source_resolution_out_of_range']]) test(`source ${error} never spends`, async t => {
  const source = TEMPLATE_CLIP_SOURCES[ID], saved = { ...source }; Object.assign(source, change);
  t.after(() => Object.assign(source, saved)); const net = network(t);
  assert.equal((await (await post()).json()).error, error); assert.equal(net.debits.length, 0);
});
test('replay binds effective prompt and photo, template, version and hash, surviving unpublication', async t => {
  const options = {}, net = network(t, options);
  assert.equal((await post()).status, 200);
  assert.equal((await (await post({ inputs: { prompt: TEMPLATE_CLIP_PROMPT } })).json()).idempotent, true);
  assert.equal((await post({ references: [{ ...photo, asset_id: AUTH }] })).status, 409);
  assert.equal((await post({ template_clip: 'other-template' })).status, 409);
  const source = TEMPLATE_CLIP_SOURCES[ID], saved = { ...source };
  t.after(() => { TEMPLATE_CLIP_SOURCES[ID] = source; Object.assign(source, saved); });
  source.version = 'v2'; assert.equal((await post()).status, 409); source.version = 'v1';
  source.sha256 = 'b'.repeat(64); assert.equal((await post()).status, 409); Object.assign(source, saved);
  options.active = false; delete TEMPLATE_CLIP_SOURCES[ID];
  const start = net.calls.length;
  assert.deepEqual(await (await post()).json(), { job_id: JOB, idempotent: true });
  assert.deepEqual(net.calls.slice(start), ['check_generation_rate_limit', 'users', 'jobs']);
  assert.equal((await post({ idempotency_key: 'fresh-key' })).status, 404);
  assert.equal(net.debits.length, 1); assert.equal(net.charges(), 1); assert.equal(net.submits.length, 1);
});
test('rate limiting precedes replay and catalog reads', async t => {
  const net = network(t, { throttled: true }); assert.equal((await post()).status, 429);
  assert.deepEqual(net.calls, ['check_generation_rate_limit']);
});
test('ordinary Seedance requests retain pre-clip validation and drop raw video URLs', async t => {
  const net = network(t);
  for (const [overrides, error] of [
    [{ references: [{ ...photo, slot: 'video' }] }, 'source_slot_invalid'],
    [{ references: undefined, source_keys: [`uploads/${AUTH}/${PHOTO}.mp4`] }, 'source_slot_invalid'],
    [{ inputs: { prompt: 'ordinary', video_urls: [] } }, 'inputs_key_not_allowed:video_urls'],
    [{ inputs: { prompt: 'ordinary', video: 'client' } }, 'inputs_key_not_allowed:video'],
  ]) {
    const response = await post({ template_clip: undefined, inputs: { prompt: 'ordinary' }, ...overrides });
    assert.equal((await response.json()).error, error);
  }
  assert.equal(net.debits.length, 0);
  for (const flag of [undefined, 'false', 'TRUE', '1', 'true']) {
    process.env.TEMPLATE_CLIP_ENABLED = flag;
    const response = await post({ template_clip: undefined, idempotency_key: `ordinary-${flag}`,
      inputs: { prompt: 'ordinary', video_url: 'https://caller.test/a.mp4' }, video: 'ignored', video_url: 'ignored', video_urls: ['ignored'] });
    assert.equal(response.status, 200);
    assert.equal(Object.hasOwn(net.submits.at(-1), 'video_urls'), false);
    assert.equal(Object.hasOwn(net.debits.at(-1).p_inputs, 'template_source'), false);
  }
  process.env.TEMPLATE_CLIP_ENABLED = 'true';
});

test('omitted-prompt replay fails closed across a changed default constant', async () => {
  const { replayTemplateClip } = await import('../lib/templateClipReplay.js');
  const oldPrompt = 'An earlier server-owned prompt, before the current constant';
  assert.notEqual(oldPrompt, TEMPLATE_CLIP_PROMPT);
  const stored = { prompt: oldPrompt, duration_seconds: 5, references: [photo],
    template_source: { template: ID, version: 'v1', sha256: 'a'.repeat(64) } };
  const replay = await replayTemplateClip(AUTH, { model_id: 'seedance-2.0-reference', template_clip: ID,
    inputs: {}, consent: true, references: [photo], idempotency_key: 'earlier' }, {}, {
    manifest, read: async table => table === 'users' ? [{ id: AUTH }] : [{ id: JOB, model_id: 'seedance-2.0-reference', inputs: stored }],
  });
  assert.deepEqual(replay, { status: 409, body: { error: 'idempotency_conflict' } });
});

test('accepted template job follows job_failed and exactly one provider-failure refund on duplicate delivery', async t => {
  const net = network(t);
  assert.equal((await post()).status, 200);
  const debit = net.debits[0], calls = [];
  let processed = false, inserted = false;
  const job = { id: JOB, user_id: AUTH, credits: debit.p_credits, model_id: debit.p_model_id, inputs: debit.p_inputs, state: 'SUBMITTED' };
  const handler = createFalWebhookHandler({
    config: () => ({ supabaseUrl: 'https://db.test', serviceRoleKey: 'test' }),
    storageConfig: () => ({ accountId: 'a', accessKeyId: 'a', secretAccessKey: 'a', bucket: 'a' }),
    expectedTenant: () => 'tenant', verify: async () => true,
    fetchCall: async (url, init = {}) => {
      if (url.pathname.endsWith('/jobs')) return Response.json([job]);
      if (url.pathname.endsWith('/webhook_events')) {
        if (init.method === 'POST') { const previous = inserted; inserted = true; return Response.json(previous ? [] : [{}], { status: 201 }); }
        if (init.method === 'PATCH') { processed = true; return Response.json({}); }
        return Response.json([{ processed_at: processed ? '2026-11-07T00:00:00Z' : null }]);
      }
      return Response.json({});
    },
    rpcCall: async (name, args) => {
      calls.push({ name, args });
      if (name === 'job_failed') { job.state = 'FAILED'; return { ok: true, job_id: JOB, user_id: AUTH, credits: job.credits }; }
      return { ok: true };
    },
  });
  const req = () => new Request('https://fixture.test/api/webhook/fal', { method: 'POST',
    headers: { 'x-fal-webhook-request-id': 'fixture-task', 'x-fal-webhook-user-id': 'tenant' },
    body: JSON.stringify({ request_id: 'fixture-task', status: 'ERROR', payload: { detail: [{ loc: ['body', 'image_urls', 0], type: 'content_policy_violation' }] } }),
  });
  assert.equal((await handler(req())).status, 200);
  assert.equal((await handler(req())).status, 200);
  assert.equal(calls.filter(call => call.name === 'job_failed').length, 1);
  assert.deepEqual(calls.filter(call => call.name === 'ledger_refund').map(call => call.args), [{ p_job_id: JOB, p_user_id: AUTH, p_credits: 85, p_reason: 'refund:provider_failed' }]);
  assert.equal(net.charges(), 1);
});


test('public and developer catalogs omit the video slot; developer video refs keep the ordinary error', async t => {
  const net = network(t);
  const { developerApi } = await import('../lib/developerApi.js');
  const headers = { 'x-veyrnox-auth-id': AUTH, 'x-veyrnox-auth-client-id': PHOTO };
  const publicResponse = await GET(new Request('https://veyrnox.test/api/catalog'));
  const developerResponse = await developerApi(new Request('https://veyrnox.test/api/v1/developer/models', { headers }), ['models']);
  for (const response of [publicResponse, developerResponse]) {
    assert.equal(response.status, 200);
    const model = (await response.json()).models.find(row => row.id === 'seedance-2.0-reference');
    assert.deepEqual(Object.keys(model.capabilities.media), ['image']);
  }
  const refused = await developerApi(new Request('https://veyrnox.test/api/v1/developer/generations', {
    method: 'POST', headers, body: JSON.stringify({ model_id: 'seedance-2.0-reference', inputs: { prompt: 'ordinary' },
      references: [{ ...photo, slot: 'video' }], consent: true, confirmed_credits: 85, idempotency_key: 'developer-private-video' }),
  }), ['generations']);
  assert.equal(refused.status, 400); assert.deepEqual(await refused.json(), { error: 'source_slot_invalid' });
  assert.equal(net.debits.length, 0);
});

function useKieSource(t) {
  const source = TEMPLATE_CLIP_SOURCES[ID];
  TEMPLATE_CLIP_SOURCES[ID] = { ...kieSource };
  t.after(() => { TEMPLATE_CLIP_SOURCES[ID] = source; });
}
for (const [fal, kie, expected] of [[true, false, catalog[0].id], [false, true, kieCatalog.id],
  [true, true, catalog[0].id], [false, false, null]]) test(`offer selection fal=${fal} kie=${kie}`, async t => {
  useKieSource(t);
  const net = network(t, { catalog: [{ ...catalog[0], active: fal }, { ...kieCatalog, active: kie }] });
  const available = await get(ID);
  assert.equal(available.status, expected ? 200 : 404);
  if (!expected) { assert.equal((await post()).status, 404); return; }
  assert.equal((await available.json()).model, expected);
  const other = expected === catalog[0].id ? kieCatalog.id : catalog[0].id;
  const mismatch = await post({ model_id: other });
  assert.equal(mismatch.status, 400); assert.equal((await mismatch.json()).error, 'template_clip_model_mismatch');
  assert.equal(net.debits.length, 0);
  const admitted = await post({ model_id: expected });
  assert.equal(admitted.status, 200);
  assert.equal(net.debits[0].p_model_id, expected);
  assert.equal(net.debits[0].p_credits, expected === kieCatalog.id ? 70 : 85);
});

test('kie admission shapes the server prompt and private clip and replays without another charge', async t => {
  useKieSource(t); const net = network(t, { catalog: [kieCatalog] });
  const request = { model_id: kieCatalog.id, inputs: { prompt: TEMPLATE_CLIP_PROMPT, aspect_ratio: '9:16' } };
  assert.equal((await post(request)).status, 200);
  assert.equal((await (await post(request)).json()).idempotent, true);
  assert.equal(net.charges(), 1); assert.equal(net.submits.length, 1);
  const payload = net.submits[0];
  assert.equal(payload.model, 'bytedance/seedance-2');
  assert.equal(payload.callBackUrl, 'https://veyrnox.test/api/webhook/kie');
  assert.deepEqual(Object.keys(payload.input).sort(), ['aspect_ratio', 'duration', 'generate_audio', 'prompt', 'reference_image_urls', 'reference_video_urls', 'resolution']);
  assert.equal(payload.input.prompt, EFFECTIVE_PROMPT);
  assert.equal(payload.input.duration, 5); assert.equal(payload.input.resolution, '720p');
  assert.equal(payload.input.generate_audio, true); assert.equal(payload.input.aspect_ratio, '9:16');
  assert.equal(payload.input.reference_image_urls.length, 1); assert.equal(payload.input.reference_video_urls.length, 1);
});

for (const initial of [catalog[0], kieCatalog]) test(`replay follows stored ${initial.provider} after preference flip, deactivation and manifest removal`, async t => {
  useKieSource(t); const options = { catalog: [initial] }, net = network(t, options);
  const request = { model_id: initial.id };
  assert.equal((await post(request)).status, 200);
  options.catalog = [initial.id === kieCatalog.id ? catalog[0] : kieCatalog];
  assert.equal((await (await post(request)).json()).idempotent, true);
  options.active = false;
  assert.equal((await (await post(request)).json()).idempotent, true);
  delete TEMPLATE_CLIP_SOURCES[ID];
  assert.equal((await (await post(request)).json()).idempotent, true);
  assert.equal(net.charges(), 1); assert.equal(net.submits.length, 1);
});

for (const [changes, error] of [[{ frameRate: undefined }, 'source_frame_rate_unknown'], [{ sizeBytes: undefined }, 'source_size_unknown'],
  [{ width: 1280, height: 320 }, 'source_aspect_out_of_range'], [{ frameRate: 12 }, 'source_frame_rate_out_of_range'],
  [{ seconds: 5.1, videoSeconds: 5.1 }, 'source_too_long']]) test(`kie rejects manifest ${error} before debit`, async t => {
  useKieSource(t); Object.assign(TEMPLATE_CLIP_SOURCES[ID], changes);
  const net = network(t, { catalog: [kieCatalog] });
  const available = await get(ID), response = await post({ model_id: kieCatalog.id });
  assert.equal(available.status, 404); assert.equal(response.status, 404);
  assert.equal((await response.json()).error, 'template_clip_not_found');
  assert.equal(net.debits.length, 0); assert.equal(net.submits.length, 0);
});

test('kie two-image request is refused before debit even with multi-reference enabled', async t => {
  useKieSource(t); const net = network(t, { catalog: [kieCatalog] });
  process.env.MULTI_REFERENCE_ENABLED = 'true'; t.after(() => { process.env.MULTI_REFERENCE_ENABLED = 'false'; });
  assert.equal((await (await post({ model_id: kieCatalog.id, references: [photo, { ...photo, asset_id: AUTH }] })).json()).error, 'source_count_exceeded');
  assert.equal(net.debits.length, 0); assert.equal(net.submits.length, 0);
});

test('kie proven submit failure uses the catalog price for one refund', async t => {
  useKieSource(t); const net = network(t, { catalog: [kieCatalog], providerFailure: true });
  const response = await post({ model_id: kieCatalog.id, inputs: { prompt: 'Follow @video1 with @image1.' } });
  assert.equal(response.status, 502); assert.equal((await response.json()).error, 'provider_submit_failed');
  assert.deepEqual(net.refunds, [{ p_job_id: JOB, p_user_id: AUTH, p_credits: 70, p_reason: 'refund:submit_failed' }]);
});

test('kie accepted job refunds provider failure once on duplicate completion', async t => {
  useKieSource(t); const net = network(t, { catalog: [kieCatalog] });
  assert.equal((await post({ model_id: kieCatalog.id })).status, 200);
  const { completeJob } = await import('../lib/providerCompletion.js');
  const debit = net.debits[0], calls = []; let processed = false, inserted = false;
  const job = { id: JOB, user_id: AUTH, credits: debit.p_credits, model_id: debit.p_model_id, state: 'SUBMITTED' };
  t.mock.method(globalThis, 'fetch', async (target, init = {}) => {
    const url = new URL(target), name = url.pathname.split('/').at(-1);
    if (name === 'jobs') return Response.json([job]);
    if (name === 'webhook_events') {
      if (init.method === 'POST') { const previous = inserted; inserted = true; return Response.json(previous ? [] : [{}], { status: 201 }); }
      if (init.method === 'PATCH') { processed = true; return Response.json({}); }
      return Response.json([{ processed_at: processed ? 'done' : null }]);
    }
    assert.ok(url.pathname.includes('/rpc/'));
    calls.push({ name, body: JSON.parse(init.body) });
    if (name === 'job_failed') job.state = 'FAILED';
    if (name === 'ledger_refund') job.state = 'REFUNDED';
    return Response.json({ ok: true });
  });
  const args = { source: 'kie', job, providerJobId: 'fixture-task', outcome: { state: 'fail', errorCode: 'provider_error' },
    cfg: { supabaseUrl: 'https://db.test', serviceRoleKey: 'test' } };
  assert.equal((await completeJob(args)).status, 200); assert.equal((await completeJob(args)).status, 200);
  assert.deepEqual(calls.map(c => c.name), ['job_failed', 'ledger_refund']);
  assert.deepEqual(calls[1].body, { p_job_id: JOB, p_user_id: AUTH, p_credits: 70, p_reason: 'refund:provider_failed' });
});

test('kie API catalog omits the private video slot', async t => {
  network(t, { catalog: [kieCatalog] });
  const response = await GET(new Request('https://veyrnox.test/api/catalog'));
  assert.equal(response.status, 200);
  const model = (await response.json()).models.find(r => r.id === kieCatalog.id);
  assert.deepEqual(Object.keys(model.capabilities.media), ['image']);
  assert.equal(model.capabilities.media.image.maxFiles, 1);
});

for (const imageDimensions of [{ width: 8000, height: 1000 }, { width: 128, height: 128 }]) test(`kie invalid photo ${JSON.stringify(imageDimensions)} cannot debit`, async t => {
  useKieSource(t); const net = network(t, { catalog: [kieCatalog], imageDimensions });
  const response = await post({ model_id: kieCatalog.id });
  assert.equal(response.status, 400); assert.match((await response.json()).error, /^source_/);
  assert.equal(net.debits.length, 0); assert.equal(net.submits.length, 0);
});
test('absent flag keeps both offers off without catalog, media or provider calls', async t => {
  useKieSource(t); const net = network(t, { catalog: [catalog[0], kieCatalog] });
  delete process.env.TEMPLATE_CLIP_ENABLED; t.after(() => { process.env.TEMPLATE_CLIP_ENABLED = 'true'; });
  assert.equal((await get(ID)).status, 404);
  assert.equal((await post({ model_id: kieCatalog.id })).status, 404);
  assert.deepEqual(net.calls, ['check_generation_rate_limit']);
});

test('kie-only projection rejects a fal-era manifest and returns kie once measured metadata is complete', async t => {
  const net = network(t, { catalog: [kieCatalog] });
  const unavailable = await get(ID);
  assert.equal(unavailable.status, 404);
  assert.deepEqual(await unavailable.json(), { error: 'template_clip_not_found' });
  useKieSource(t);
  const available = await get(ID);
  assert.equal(available.status, 200);
  assert.deepEqual(await available.json(), { id: ID, model: kieCatalog.id, credits: 70, durationSeconds: 5 });
  assert.equal(net.debits.length, 0); assert.equal(net.submits.length, 0);
});

for (const row of [catalog[0], kieCatalog]) {
  test(`${row.provider}: edited prompt retries, conflicts and concurrent admission share one job`, async t => {
    if (row === kieCatalog) useKieSource(t);
    const net = network(t, { catalog: [row] });
    const request = { model_id: row.id, inputs: { prompt: '  Follow @VIDEO1.  Recast with @IMAGE1.  ' } };
    const responses = await Promise.all([post(request), post(request)]);
    assert.deepEqual(responses.map(r => r.status), [200, 200]);
    assert.equal(net.charges(), 1);
    assert.equal(net.submits.length, 1);
    assert.equal(net.debits[0].p_inputs.prompt, 'Follow @Video1. Recast with @Image1.');
    assert.equal((await (await post(request)).json()).idempotent, true);
    const changed = await post({ ...request, inputs: { prompt: 'Change @video1 with @image1.' } });
    assert.equal(changed.status, 409);
    assert.equal((await changed.json()).error, 'idempotency_conflict');
    assert.equal(net.charges(), 1);
  });
  test(`${row.provider}: omitted and explicit default have identical admission identity`, async t => {
    if (row === kieCatalog) useKieSource(t);
    const net = network(t, { catalog: [row] });
    const responses = await Promise.all([post({ model_id: row.id }), post({ model_id: row.id, inputs: { prompt: TEMPLATE_CLIP_PROMPT } })]);
    assert.deepEqual(responses.map(r => r.status), [200, 200]);
    assert.equal(net.charges(), 1);
    assert.equal((await (await post({ model_id: row.id })).json()).idempotent, true);
  });
  for (const prompt of ['no tags', '@video1 @video1 @image1', 'word@video1 @image1', '@video10 @image1', '@video1 @image1 ' + 'x'.repeat(2000), 3]) {
    test(`${row.provider}: invalid prompt ${String(prompt).slice(0, 30)} refuses before debit`, async t => {
      if (row === kieCatalog) useKieSource(t);
      const net = network(t, { catalog: [row] });
      const response = await post({ model_id: row.id, inputs: { prompt } });
      assert.equal(response.status, 400);
      assert.equal((await response.json()).error, 'template_clip_prompt_tags');
      assert.equal(net.debits.length, 0);
    });
  }
}

for (const row of [catalog[0], kieCatalog]) test(`${row.provider}: free concurrent edited prompts bind the same identity as paid admission`, async t => {
  if (row === kieCatalog) useKieSource(t);
  process.env.FREE_ALLOWANCE_ENABLED = 'true';
  t.after(() => { process.env.FREE_ALLOWANCE_ENABLED = 'false'; });
  const net = network(t, { catalog: [{ ...row, free_allowance_per_day: 1 }] });
  const request = { model_id: row.id, inputs: { prompt: 'Follow @video1 with @image1.' } };
  const results = await Promise.all([post(request), post(request)]);
  assert.deepEqual(results.map(r => r.status), [200, 200]);
  assert.ok(net.freeAdmissions.length > 0);
  assert.equal(net.debits.length, 0); assert.equal(net.submits.length, 1);
  const changed = await post({ ...request, inputs: { prompt: 'Change @video1 with @image1.' } });
  assert.equal(changed.status, 409); assert.equal((await changed.json()).error, 'idempotency_conflict');
});
