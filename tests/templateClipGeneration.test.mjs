import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { isDeepStrictEqual } from 'node:util';
import { manifest, catalog } from './fixtures/templateClips.mjs';
import { createFalWebhookHandler } from '../lib/falWebhookHandler.js';
import { TEMPLATE_CLIP_PROMPT } from '../lib/templateClipPrompt.mjs';
register('data:text/javascript,' + encodeURIComponent(`
export async function resolve(s,c,next) { return next(s === 'next/server' ? 'next/server.js' : s,c); }
export async function load(url,c,next) {
  const result = await next(url,c);
  if (url.endsWith('/lib/templateClipSources.js')) return { ...result, source: String(result.source).replace('Object.freeze({})', ${JSON.stringify(JSON.stringify(manifest))}) };
  return result;
}`));
Object.assign(process.env, {
  TEMPLATE_CLIP_ENABLED: 'true', SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'test-service', FAL_KEY: 'test-fal',
  PUBLIC_HOST: 'https://veyrnox.test', R2_ACCOUNT_ID: 'test', R2_ACCESS_KEY_ID: 'test', R2_SECRET_ACCESS_KEY: 'test', R2_BUCKET: 'test',
  FREE_ALLOWANCE_ENABLED: 'false', FAL_DURABLE_DISPATCH_ENABLED: 'false', FAL_DISPATCH_SCHEMA_ENABLED: 'false',
  SUPPLIER_ROUTES_ENABLED: 'false', MAX_CHARGE_ENABLED: 'false', MULTI_REFERENCE_ENABLED: 'false',
});
const { POST } = await import('../app/api/v1/generations/route.js');
const { GET } = await import('../app/api/catalog/route.js');
const { TEMPLATE_CLIP_SOURCES } = await import('../lib/templateClipSources.js');
const ID = 'medieval-runway-look';
const AUTH = '11111111-1111-4111-8111-111111111111', JOB = '22222222-2222-4222-8222-222222222222';
const PHOTO = '33333333-3333-4333-8333-333333333333';
const photo = { slot: 'image', origin: 'asset', asset_id: PHOTO };
const jpeg = Buffer.from([255,216,255,192,0,17,8,2,128,2,128,3,1,17,0,2,17,0,3,17,0,255,217]);
function network(t, options = {}) {
  const debits = [], submits = [], calls = [], identities = new Map(); let charges = 0;
  // Mirrors migration 0399's non-chat identity; SQL itself is not run here.
  const identity = body => ({ model: body.p_model_id, inputs: Object.fromEntries(Object.entries(body.p_inputs).filter(([k]) => !['preset_id','source_keys','source_assets'].includes(k))) });
  t.mock.method(globalThis, 'fetch', async (target, init = {}) => {
    const url = new URL(String(target)), name = url.pathname.split('/').at(-1);
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : null;
    calls.push(name);
    if (name === 'runtime_switches') return Response.json([{ key: 'generation', state: 'off' }]);
    if (name === 'model_catalog') {
      if (options.catalogFailure) throw Error('offline');
      return Response.json(catalog.filter(r => !url.searchParams.has('id') || `eq.${r.id}` === url.searchParams.get('id')).map(r => ({ ...r, active: options.active !== false })));
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
      const start = Number(a), end = Math.min(Number(b), jpeg.length - 1);
      return new Response(jpeg.subarray(start, end + 1), { status: 206, headers: { 'content-type': 'image/jpeg', 'content-range': `bytes ${start}-${end}/${jpeg.length}` } });
    }
    if (['queue.fal.run', 'api.crun.ai'].includes(url.hostname)) {
      submits.push(body);
      if (options.providerFailure) return Response.json({ detail: 'rejected' }, { status: 422 });
      return Response.json({ request_id: 'fixture-task' });
    }
    throw Error(`Unexpected network ${url.hostname}${url.pathname}`);
  });
  return { debits, submits, calls, charges: () => charges };
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
  assert.equal((await post({ inputs: { prompt: 'untrusted green character' } })).status, 200);
  assert.equal(net.debits[0].p_credits, 85);
  assert.deepEqual(net.debits[0].p_inputs.template_source, { template: ID, version: 'v1', sha256: 'a'.repeat(64) });
  assert.equal(net.debits[0].p_inputs.prompt, TEMPLATE_CLIP_PROMPT);
  assert.deepEqual(net.debits[0].p_inputs.references, [photo]);
  assert.doesNotMatch(JSON.stringify(net.debits[0].p_inputs), /https:|template-clips\//);
  const payload = net.submits[0];
  assert.equal(payload.prompt, TEMPLATE_CLIP_PROMPT);
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
test('replay ignores client prompt but binds photo, template, version and hash, surviving unpublication', async t => {
  const options = {}, net = network(t, options);
  assert.equal((await post()).status, 200);
  assert.equal((await (await post({ inputs: { prompt: 'ignored even on replay' } })).json()).idempotent, true);
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

test('replay survives a change to the server prompt constant', async () => {
  const { replayTemplateClip } = await import('../lib/templateClipReplay.js');
  const oldPrompt = 'An earlier server-owned prompt, before the current constant';
  assert.notEqual(oldPrompt, TEMPLATE_CLIP_PROMPT);
  const stored = { prompt: oldPrompt, duration_seconds: 5, references: [photo],
    template_source: { template: ID, version: 'v1', sha256: 'a'.repeat(64) } };
  const replay = await replayTemplateClip(AUTH, { model_id: 'seedance-2.0-reference', template_clip: ID,
    inputs: { prompt: 'ignored client edit' }, consent: true, references: [photo], idempotency_key: 'earlier' }, {}, {
    manifest, read: async table => table === 'users' ? [{ id: AUTH }] : [{ id: JOB, model_id: 'seedance-2.0-reference', inputs: stored }],
  });
  assert.deepEqual(replay, { status: 200, body: { job_id: JOB, idempotent: true } });
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
