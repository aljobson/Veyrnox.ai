import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { isDeepStrictEqual } from 'node:util';
import { manifest, catalog, registry, manifestBytes, pin, publishManifest, signedMedia } from './fixtures/templateSwapClips.mjs';
import { createFalWebhookHandler } from '../lib/falWebhookHandler.js';
import { templateSwapPrompt, TEMPLATE_SWAP_CLIP_PROMPT } from '../lib/templateSwapClipPrompt.mjs';
register('data:text/javascript,' + encodeURIComponent(`
export async function resolve(s,c,next) { return next(s === 'next/server' ? 'next/server.js' : s,c); }
export async function load(url,c,next) {
  const result = await next(url,c);
  if (url.endsWith('/packages/adapters/r2.js')) return { ...result, source:
    ${JSON.stringify(`import { recordSignedMedia } from '${new URL('./fixtures/templateSwapClips.mjs', import.meta.url).href}';`)} + String(result.source).replace(
      'export async function presignGetUrl(key, expiresSeconds, cfg, { downloadFilename, responseContentType } = {}) {',
      'export async function presignGetUrl(key, expiresSeconds, cfg, { downloadFilename, responseContentType } = {}) { recordSignedMedia(key);') };

  if (url.endsWith('/app/veyrnox/_lib/templateSwapClips.js')) return { ...result, source: String(result.source).replace(/Object\\.freeze\\(\\[[^\\]]*\\]\\)/, ${JSON.stringify(JSON.stringify(registry))}).replace(/export const TEMPLATE_SWAP_CLIP_MANIFEST_SHA256 = '[0-9a-f]*';/, ${JSON.stringify(`export { pin as TEMPLATE_SWAP_CLIP_MANIFEST_SHA256 } from '${new URL('./fixtures/templateSwapClips.mjs', import.meta.url).href}';`)}) };
  return result;
}`));
Object.assign(process.env, {
  TEMPLATE_SWAP_CLIP_ENABLED: 'true', SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'test-service', FAL_KEY: 'test-fal', KIE_API_KEY: 'test-kie',
  PUBLIC_HOST: 'https://veyrnox.test', R2_ACCOUNT_ID: 'test', R2_ACCESS_KEY_ID: 'test', R2_SECRET_ACCESS_KEY: 'test', R2_BUCKET: 'test',
  FREE_ALLOWANCE_ENABLED: 'false', FAL_DURABLE_DISPATCH_ENABLED: 'false', FAL_DISPATCH_SCHEMA_ENABLED: 'false',
  SUPPLIER_ROUTES_ENABLED: 'false', MAX_CHARGE_ENABLED: 'false', MULTI_REFERENCE_ENABLED: 'true',
});
const { POST } = await import('../app/api/v1/generations/route.js');
const { GET } = await import('../app/api/catalog/route.js');
const EFFECTIVE_PROMPT = templateSwapPrompt('the main character');
const ID = 'community-athlete-identity-swap';
const AUTH = '11111111-1111-4111-8111-111111111111', JOB = '22222222-2222-4222-8222-222222222222';
const PHOTO = '33333333-3333-4333-8333-333333333333';
const photo = { slot: 'image', origin: 'asset', asset_id: PHOTO };
const crop = { ...photo, asset_id: '44444444-4444-4444-8444-444444444444' };
const jpeg = Buffer.from([255,216,255,192,0,17,8,2,128,2,128,3,1,17,0,2,17,0,3,17,0,255,217]);
function network(t, options = {}) {
  publishManifest(options.manifest ?? manifest);
  signedMedia.length = 0;
  const imageType = options.imageType || 'image/png';
  const sourceBytes = (index = 0) => {
    if (options.missingDimensions) return Buffer.from([255,216,255,224,0,8,0,0,0,0,0,0,255,217]);
    const dims = options.pairDimensions?.[index] || options.imageDimensions || { width: 640, height: 640 };
    if (imageType === 'image/jpeg') {
      const bytes = Buffer.from(jpeg); bytes.writeUInt16BE(dims.height, 7); bytes.writeUInt16BE(dims.width, 9); return bytes;
    }
    if (imageType === 'image/webp') {
      const bytes = Buffer.alloc(30); bytes.write('RIFF', 0); bytes.write('WEBP', 8); bytes.write('VP8X', 12);
      bytes.writeUIntLE(dims.width - 1, 24, 3); bytes.writeUIntLE(dims.height - 1, 27, 3); return bytes;
    }
    const bytes = Buffer.alloc(32); Buffer.from([137,80,78,71,13,10,26,10]).copy(bytes);
    bytes.write('IHDR', 12); bytes.writeUInt32BE(dims.width, 16); bytes.writeUInt32BE(dims.height, 20); return bytes;
  };
  const freeAdmissions = [], debits = [], submits = [], calls = [], refunds = [], identities = new Map(); let charges = 0;
  // Mirrors migration 0399's non-chat identity; SQL itself is not run here.
  const identity = body => ({ model: body.p_model_id, inputs: Object.fromEntries(Object.entries(body.p_inputs).filter(([k]) => !['preset_id','source_keys','source_assets'].includes(k))) });
  t.mock.method(globalThis, 'fetch', async (target, init = {}) => {
    const url = new URL(String(target)), name = url.pathname.split('/').at(-1);
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : null;
    calls.push(name);
    if (url.pathname.includes('/template-swap-clips/manifests/')) {
      assert.equal(name, pin + '.json');
      options.manifestSignal = init.signal;
      if (options.manifestFailure === 'headers') return new Promise(() => {});
      if (['body', 'oversize'].includes(options.manifestFailure)) return new Response(new ReadableStream({
        start(c) { if (options.manifestFailure === 'oversize') c.enqueue(new Uint8Array(1024 * 1024 + 1)); },
        cancel() { options.cancelled = true; },
      }));
      if (options.manifestFailure === 'down') return new Response(null, { status: 503 });
      return new Response(options.manifestFailure === 'hash' ? 'corrupt' : manifestBytes);
    }
    if (name === 'runtime_switches') return Response.json([{ key: 'generation', state: 'off' }]);
    if (name === 'model_catalog') {
      if (options.catalogFailure) throw Error('offline');
      const filter = url.searchParams.get('id');
      return Response.json((options.catalog || catalog).filter(r => !filter || `eq.${r.id}` === filter || filter === 'in.(kling-o1-reference)').map(r => ({ ...r, active: options.active === false ? false : r.active })));
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
        return Response.json({ ok: true, state: 'STORED', mime_type: options.missingDimensions ? 'image/jpeg' : imageType, r2_key: `jobs/${body.p_job_id || PHOTO}/output.jpg` });
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
      assert.ok(!url.pathname.includes('template-swap-clips/'), 'trusted shared clips are never sniffed or downloaded');
      assert.ok([PHOTO, crop.asset_id].some(id => url.pathname.endsWith(`jobs/${id}/output.jpg`)));
      const sourceJpeg = sourceBytes(url.pathname.includes(crop.asset_id) ? 1 : 0);
      const [, a, b] = /bytes=(\d+)-(\d+)/.exec(init.headers.Range);
      const start = Number(a), end = Math.min(Number(b), sourceJpeg.length - 1);
      return new Response(sourceJpeg.subarray(start, end + 1), { status: 206, headers: { 'content-type': imageType, 'content-range': `bytes ${start}-${end}/${sourceJpeg.length}` } });
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
  return POST(new Request('https://veyrnox.test/api/v1/generations', { method: 'POST', headers: { 'x-veyrnox-auth-id': AUTH }, body: JSON.stringify({ model_id: 'kling-o1-reference', template_swap: 'community-athlete-identity-swap',
    inputs: {}, consent: true, references: [photo, crop], idempotency_key: 'scene-proof-key', ...overrides }) }));
}
function get(id, auth = true) {
  return GET(new Request('https://veyrnox.test/api/catalog?template_swap=' + encodeURIComponent(id), { headers: auth ? { 'x-veyrnox-auth-id': AUTH } : {} }));
}

test('catalog price, server prompt, signed video and ordered element use the existing admission', async t => {
  process.env.APP_RUNTIME_FLAGS = '{"templateFaceWording":true}';
  t.after(() => { delete process.env.APP_RUNTIME_FLAGS; });
  const net = network(t);
  const response = await get(ID), view = await response.json();
  assert.deepEqual(view, { id: ID, model: 'kling-o1-reference', credits: 47, durationSeconds: 5, role: 'the main character', images: 2 });
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal((await post({ preset: ID, inputs: { prompt: 'Ignored client wording' } })).status, 200);
  assert.equal(net.debits[0].p_credits, 47);
  assert.deepEqual(net.debits[0].p_inputs.template_source, { template: ID, version: 'v1', sha256: 'a'.repeat(64), role: 'the main character' });
  assert.equal(net.debits[0].p_inputs.prompt, EFFECTIVE_PROMPT);
  assert.deepEqual(net.debits[0].p_inputs.references, [photo, crop]);
  assert.equal(Object.hasOwn(net.debits[0].p_inputs, 'preset_id'), false);
  assert.doesNotMatch(JSON.stringify(net.debits[0].p_inputs), /https:|template-swap-clips\//);
  const payload = net.submits[0];
  assert.equal(payload.prompt, EFFECTIVE_PROMPT);
  assert.equal(payload.image_urls, undefined); assert.equal(payload.image_url, undefined);
  assert.equal(payload.elements.length, 1);
  assert.ok(new URL(payload.elements[0].frontal_image_url).pathname.endsWith(`jobs/${PHOTO}/output.jpg`));
  assert.ok(new URL(payload.elements[0].reference_image_urls[0]).pathname.endsWith(`jobs/${crop.asset_id}/output.jpg`)); assert.equal(typeof payload.video_url, 'string');
  const signed = new URL(payload.video_url);
  assert.ok(signed.pathname.endsWith(manifest[ID].key));
  assert.equal(signed.searchParams.get('X-Amz-Expires'), '900');
  assert.equal(payload.duration, '5'); assert.equal(payload.keep_audio, false); assert.equal(payload.aspect_ratio, 'auto');
});
for (const flag of [undefined, 'false', 'TRUE', '1']) test(`flag ${flag} refuses before replay or media`, async t => {
  const net = network(t); process.env.TEMPLATE_SWAP_CLIP_ENABLED = flag;
  t.after(() => { process.env.TEMPLATE_SWAP_CLIP_ENABLED = 'true'; });
  assert.equal((await get(ID)).status, 404);
  assert.deepEqual(await (await post()).json(), { error: 'template_swap_not_found' });
  assert.deepEqual(net.calls, ['check_generation_rate_limit']);
});
for (const [overrides, error] of [
  [{ model_id: 'kling-3.0-i2v' }, 'template_swap_model_mismatch'],
  [{ references: [] }, 'template_swap_photo_count'],
  [{ references: [photo] }, 'template_swap_photo_count'],
  [{ references: [{ ...photo, slot: 'video' }] }, 'template_swap_video_not_allowed'],
  [{ references: [{ origin: 'upload', slot: 'image', key: `uploads/${AUTH}/${PHOTO}.mp4` }] }, 'template_swap_video_not_allowed'],
  [{ video: null }, 'template_swap_video_not_allowed'],
  [{ inputs: { video: null } }, 'template_swap_video_not_allowed'],
  [{ source_keys: [`uploads/${AUTH}/${PHOTO}.mp4`], references: undefined }, 'template_swap_video_not_allowed'],
  [{ duration_seconds: 10 }, 'duration_not_supported'],
  [{ video_urls: [] }, 'template_swap_video_not_allowed'],
  [{ inputs: { video_url: 'https://caller.test/clip.mp4' } }, 'template_swap_video_not_allowed'],
  [{ inputs: { video_urls: ['https://caller.test/clip.mp4'] } }, 'template_swap_video_not_allowed'],
  [{ consent: false }, 'consent_required'],
  [{ inputs: { duration_seconds: 10 } }, 'duration_not_supported'],
  [{ template_swap: '../oops' }, 'template_swap_not_found'],
]) test(`admission refuses ${JSON.stringify(overrides)}`, async t => {
  const net = network(t), response = await post(overrides);
  assert.equal((await response.json()).error, error); assert.equal(net.debits.length, 0); assert.equal(net.submits.length, 0);
});
for (const [change, error] of [[{ videoSeconds: 1 }, 'source_too_short'], [{ seconds: 11 }, 'source_too_long'], [{ seconds: 10.02 }, 'container boundary'], [{ seconds: 7 }, 'longer than the 5 s price unit'], [{ videoSeconds: 7 }, 'stream longer than the price unit'], [{ videoSeconds: 10.02 }, 'stream boundary'], [{ width: 299 }, 'source_resolution_out_of_range'], [{ height: 2161 }, 'source_resolution_out_of_range']]) test(`source ${error} never spends`, async t => {
  const net = network(t, { manifest: { [ID]: { ...manifest[ID], ...change } } });
  assert.equal((await (await post()).json()).error, 'template_swap_not_found'); assert.equal(net.debits.length, 0);
});
test('replay binds effective prompt and photo, template, version and hash, surviving unpublication', async t => {
  const options = {}, net = network(t, options);
  assert.equal((await post()).status, 200);
  assert.equal((await (await post({ inputs: { prompt: TEMPLATE_SWAP_CLIP_PROMPT } })).json()).idempotent, true);
  assert.equal((await post({ references: [crop, photo] })).status, 409);
  assert.equal((await post({ template_swap: 'other-template' })).status, 409);
  publishManifest({ [ID]: { ...manifest[ID], version: 'v2' } }); assert.equal((await post()).status, 409);
  publishManifest({ [ID]: { ...manifest[ID], sha256: 'b'.repeat(64), key: manifest[ID].key.replace('a'.repeat(64), 'b'.repeat(64)) } });
  assert.equal((await post()).status, 409);
  publishManifest({ [ID]: { ...manifest[ID], role: 'the other character' } }); assert.equal((await post()).status, 409);
  options.active = false; publishManifest({});
  process.env.MULTI_REFERENCE_ENABLED = 'false';
  t.after(() => { process.env.MULTI_REFERENCE_ENABLED = 'true'; });
  const start = net.calls.length;
  assert.deepEqual(await (await post()).json(), { job_id: JOB, idempotent: true });
  assert.deepEqual(net.calls.slice(start), ['check_generation_rate_limit', 'users', 'jobs', pin + '.json']);
  assert.equal((await post({ idempotency_key: 'fresh-key' })).status, 404);
  assert.equal(net.debits.length, 1); assert.equal(net.charges(), 1); assert.equal(net.submits.length, 1);
});
test('rate limiting precedes replay and catalog reads', async t => {
  const net = network(t, { throttled: true }); assert.equal((await post()).status, 429);
  assert.deepEqual(net.calls, ['check_generation_rate_limit']);
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
  assert.deepEqual(calls.filter(call => call.name === 'ledger_refund').map(call => call.args), [{ p_job_id: JOB, p_user_id: AUTH, p_credits: 47, p_reason: 'refund:provider_failed' }]);
  assert.equal(net.charges(), 1);
});



for (const flag of [undefined, 'false', 'TRUE', '1', 'true']) test(`paired photos require exact multi-reference flag ${flag}`, async t => {
  if (flag === undefined) delete process.env.MULTI_REFERENCE_ENABLED; else process.env.MULTI_REFERENCE_ENABLED = flag;
  t.after(() => { process.env.MULTI_REFERENCE_ENABLED = 'true'; });
  const net = network(t);
  assert.equal((await post()).status, flag === 'true' ? 200 : 404);
  assert.equal(net.debits.length, flag === 'true' ? 1 : 0);
});
for (const extra of [{ swap: 'a' }, { template_clip: 'a' }, { swap: null }, { template_clip: null }]) test('source conflict ' + JSON.stringify(extra), async t => {
  const net = network(t);
  const response = await post(extra);
  assert.equal(response.status, 400); assert.equal((await response.json()).error, 'template_source_conflict');
  assert.equal(net.debits.length, 0);
});
test('clip and swap conflict without template_swap', async t => {
  network(t);
  assert.equal((await (await post({ template_swap: undefined, template_clip: 'a', swap: 'b' })).json()).error, 'template_source_conflict');
});
test('submit failure retains the existing refund path', async t => {
  const net = network(t, { providerFailure: true });
  const response = await post();
  assert.equal(response.status, 502);
  assert.deepEqual(await response.json(), { error: 'provider_submit_failed', job_id: JOB });
  assert.equal(net.refunds.length, 1);
  assert.equal(net.refunds[0].p_credits, 47);
});

for (const template_swap of [null, [], 'not-published']) test('unpublished or invalid swap is 404: ' + JSON.stringify(template_swap), async t => {
 const net = network(t);
 assert.equal((await post({template_swap})).status,404); assert.equal(net.debits.length,0);
});
test('ordinary template request remains blocked without template_swap', async t => {
 const net = network(t);
 const response = await post({template_swap:undefined,template_id:ID});
 assert.equal((await response.json()).error,'template_blocked'); assert.equal(net.debits.length,0);
});

// Exercise the real route, submit boundary and adapter with offline transport.
for (const gate of [undefined, false, true]) for (const classification of ['bound', 'like-for-like-safe']) {
  test(`photo template ${classification}: runtime gate ${gate}, stored identity and replay`, async t => {
    const { PRESETS } = await import('../app/veyrnox/_lib/templates.js');
    const { templateContract } = await import('../lib/templateContract.js');
    const { swapNeedsSourceVideo } = await import('../lib/templateSwapGuard.js');
    const { TEMPLATE_FACE_WORDING } = await import('../lib/templateFaceWording.mjs');
    const c = PRESETS.map(p => templateContract(p.id)).find(c => c?.class === classification && c.modelId === 'kling-3.0-i2v'
      && c.requiredReferences.imageMax && c.prompt.length < 1400 && !swapNeedsSourceVideo(c.sourcePrompt));
    assert.ok(c);
    if (gate === undefined) delete process.env.APP_RUNTIME_FLAGS;
    else process.env.APP_RUNTIME_FLAGS = JSON.stringify({ templateFaceWording: gate });
    t.after(() => { delete process.env.APP_RUNTIME_FLAGS; });
    const net = network(t, { catalog: [{ id: c.modelId, provider: 'fal', provider_endpoint: 'fal-ai/kling-video/v3/pro/image-to-video', modality: 'image-to-video', credits_5s: 32, active: true, gated_flag: false }] });
    const request = { references: [photo], template_swap: undefined, template_id: c.id, model_id: c.modelId,
      inputs: { prompt: c.prompt, duration_seconds: c.duration, ...(c.aspect ? { aspect_ratio: c.aspect } : {}), ...(c.negativePrompt ? { negative_prompt: c.negativePrompt } : {}) } };
    const first = await post(request);
    assert.equal(first.status, 200, JSON.stringify(await first.json()));
    assert.equal(net.debits[0].p_inputs.prompt, c.prompt);
    assert.equal(net.debits[0].p_inputs.template_fidelity.template_id, c.id);
    assert.equal(net.submits[0].prompt, gate === true ? `${c.prompt} ${TEMPLATE_FACE_WORDING}` : c.prompt);
    const { shapePayload, capabilityFor } = await import('../lib/modelCapabilities.js');
    const expected = shapePayload(capabilityFor('fal-ai/kling-video/v3/pro/image-to-video'), { ...request.inputs, image_url: net.submits[0].start_image_url }, {});
    if (gate !== true) assert.equal(JSON.stringify(net.submits[0]), JSON.stringify(expected));
    const stored = JSON.stringify(net.debits[0].p_inputs);
    // The runtime gate is deliberately not part of accepted request identity.
    process.env.APP_RUNTIME_FLAGS = JSON.stringify({ templateFaceWording: gate !== true });
    // A retry seconds later re-signs the photo URL; the accepted request's identity must not change.
    t.mock.timers.enable({ apis: ['Date'], now: Date.now() + 2000 });
    assert.equal((await post(request)).status, 200);
    assert.equal(net.submits.length, 1); assert.equal(net.charges(), 1);
    assert.equal(JSON.stringify(net.debits[0].p_inputs), stored);
  });
}
test('runtime wording gate does not augment a custom non-template photo request', async t => {
  process.env.APP_RUNTIME_FLAGS = '{"templateFaceWording":true}'; t.after(() => { delete process.env.APP_RUNTIME_FLAGS; });
  const net = network(t, { catalog: [{ id: 'kling-3.0-i2v', provider: 'fal', provider_endpoint: 'fal-ai/kling-video/v3/pro/image-to-video', modality: 'image-to-video', credits_5s: 32, active: true, gated_flag: false }] });
  const response = await post({ references: [photo], template_swap: undefined, model_id: 'kling-3.0-i2v', inputs: { prompt: 'A custom portrait', duration_seconds: 5 } });
  assert.equal(response.status, 200, JSON.stringify(await response.json()));
  assert.equal(net.submits[0].prompt, 'A custom portrait');
});

for (const mode of ['down', 'hash', 'headers', 'body', 'oversize']) test(`manifest ${mode}: fresh admission fails closed; accepted job replays`, async t => {
  const options = {}, net = network(t, options);
  assert.equal((await post()).status, 200);
  options.manifestFailure = mode; publishManifest();
  const start = net.calls.length, signedBefore = signedMedia.length;
  const [fresh, replay, projection] = await Promise.all([
    post({ idempotency_key: 'fresh-without-manifest' }), post(), get(ID),
  ]);
  assert.equal(fresh.status, 404); assert.deepEqual(await fresh.json(), { error: 'template_swap_not_found' });
  assert.equal(projection.status, 404); assert.equal(projection.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await replay.json(), { job_id: JOB, idempotent: true });
  assert.equal(net.calls.slice(start).filter(name => name === pin + '.json').length, 1);
  assert.ok(net.calls.slice(start).every(name => ['check_generation_rate_limit', 'users', 'jobs', pin + '.json'].includes(name)));
  assert.equal(net.debits.length, 1); assert.equal(net.submits.length, 1); assert.equal(net.freeAdmissions.length, 0);
  assert.equal(signedMedia.length, signedBefore, 'no signing during failed admission or replay');
  assert.equal(options.manifestSignal.aborted, true);
  if (mode === 'body' || mode === 'oversize') assert.equal(options.cancelled, true);
});

for (const [width, height, ok] of [[299, 300, false], [300, 300, true], [399, 1000, false], [400, 1000, true], [1000, 400, true], [2501, 1000, false]]) {
  test(`element dimensions ${width}/${height} checked before debit`, async t => {
    const net = network(t, { imageDimensions: { width, height } });
    const response = await post();
    assert.equal(response.status, ok ? 200 : 400);
    if (!ok) assert.deepEqual(await response.json(), { error: 'template_swap_image_size' });
    assert.equal(net.debits.length, ok ? 1 : 0);
    assert.equal(net.submits.length, ok ? 1 : 0);
  });
}
test('missing image dimensions refuse before debit', async t => {
  const net = network(t, { missingDimensions: true });
  assert.deepEqual(await (await post()).json(), { error: 'template_swap_image_size' });
  assert.equal(net.debits.length, 0);
});
test('client elements and role cannot enter the server-held structured input', async t => {
  const net = network(t);
  for (const key of ['elements', 'role']) {
    const response = await post({ inputs: { [key]: 'client supplied' } });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error, `inputs_key_not_allowed:${key}`);
  }
  assert.equal(net.debits.length, 0);
});
test('re-signing and concurrent admission preserve SQL input identity without nested URLs', async t => {
  const net = network(t);
  assert.equal((await post({ idempotency_key: 'first-signature' })).status, 200);
  t.mock.timers.enable({ apis: ['Date'], now: Date.now() + 2000 });
  assert.equal((await post({ idempotency_key: 'second-signature' })).status, 200);
  assert.notEqual(net.submits[0].elements[0].frontal_image_url, net.submits[1].elements[0].frontal_image_url);
  assert.deepEqual(net.debits[0].p_inputs, net.debits[1].p_inputs);
  assert.doesNotMatch(JSON.stringify(net.debits[1].p_inputs), /https:|frontal_image_url|reference_image_urls|elements/);
  const responses = await Promise.all([post({ idempotency_key: 'concurrent' }), post({ idempotency_key: 'concurrent' })]);
  assert.ok(responses.every(r => r.status === 200));
  assert.equal(net.charges(), 3);
  assert.equal(net.submits.length, 3);
  assert.ok(net.debits.every(d => isDeepStrictEqual(d.p_inputs, net.debits[0].p_inputs)));
});

for (const [front, cropSize, ok] of [[1536, 1024, true], [1537, 1024, false], [1536, 1025, false]]) test(`PNG pair caps ${front}/${cropSize}`, async t => {
  const net = network(t, { pairDimensions: [{ width: front, height: 800 }, { width: 800, height: cropSize }] });
  const response = await post(); assert.equal(response.status, ok ? 200 : 400);
  if (!ok) assert.deepEqual(await response.json(), { error: 'template_swap_image_size' });
  assert.equal(net.debits.length, ok ? 1 : 0);
});
test('a byte-sniffed JPEG is refused before debit for swap only', async t => {
  const net = network(t, { imageType: 'image/jpeg' });
  assert.deepEqual(await (await post()).json(), { error: 'template_swap_image_type' });
  assert.equal(net.debits.length, 0); assert.equal(net.submits.length, 0);
});
test('ordinary JPEG submission refusal retains its original response bytes', async t => {
  const net = network(t, { imageType: 'image/jpeg', providerFailure: true,
    catalog: [{ id: 'kling-3.0-i2v', provider: 'fal', provider_endpoint: 'fal-ai/kling-video/v3/pro/image-to-video', modality: 'image-to-video', credits_5s: 32, active: true, gated_flag: false }] });
  const response = await post({ template_swap: undefined, model_id: 'kling-3.0-i2v', references: [photo], inputs: { prompt: 'A portrait', duration_seconds: 5 } });
  assert.equal(response.status, 502); assert.equal(await response.text(), '{"error":"provider_submit_failed"}');
  assert.equal(net.debits.length, 1); assert.equal(net.refunds.length, 1);
});
for (const options of [{ imageType: 'image/gif' }, { imageType: 'image/webp' }, { imageDimensions: { width: 20000, height: 800 } }]) test(`resolver refusal is swap typed: ${JSON.stringify(options)}`, async t => {
  const net = network(t, options), response = await post();
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: options.imageType ? 'template_swap_image_type' : 'template_swap_image_size' });
  assert.equal(net.debits.length, 0);
});
