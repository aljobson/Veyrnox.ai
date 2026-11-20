import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { isDeepStrictEqual } from 'node:util';
import { source as fixtureSource, catalog, registry, manifestBytes, pin, publishManifest, signedMedia } from './fixtures/templateSwapClips.mjs';
import { createFalWebhookHandler } from '../lib/falWebhookHandler.js';
import { templateSwapPrompt, templateSwapPeoplePrompt } from '../lib/templateSwapClipPrompt.mjs';
const ID0 = 'basketball-3';
registry.push(ID0);
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
const ID = 'basketball-3', ONE = 'community-action-hero-strut';
const manifest = { [ID]: { ...fixtureSource, role: 'the green character', key: `template-swap-clips/${ID}/${fixtureSource.sha256}.mp4` }, [ONE]: fixtureSource };
const AUTH = '11111111-1111-4111-8111-111111111111', JOB = '22222222-2222-4222-8222-222222222222';
const PHOTO = '33333333-3333-4333-8333-333333333333';
const photo = { slot: 'image', origin: 'asset', asset_id: PHOTO };
const crop = { ...photo, asset_id: '44444444-4444-4444-8444-444444444444' };
const asset = n => ({ slot: 'image', origin: 'asset', asset_id: `${n}${n}${n}${n}${n}${n}${n}${n}-1111-4111-8111-111111111111` });
const four = [asset(5), asset(6), asset(7), asset(8)];
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
      assert.match(url.pathname, /jobs\/[0-9a-f-]{36}\/output\.jpg$/);
      const sourceJpeg = sourceBytes(0);
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
  return POST(new Request('https://veyrnox.test/api/v1/generations', { method: 'POST', headers: { 'x-veyrnox-auth-id': AUTH }, body: JSON.stringify({ model_id: 'kling-o1-reference', template_swap: ID,
    inputs: {}, consent: true, references: four, idempotency_key: 'scene-proof-key', ...overrides }) }));
}
function get(id, auth = true) {
  return GET(new Request('https://veyrnox.test/api/catalog?template_swap=' + encodeURIComponent(id), { headers: auth ? { 'x-veyrnox-auth-id': AUTH } : {} }));
}

const ROLES = ['the green character', 'the red character'];
const onFlags = t => { process.env.APP_RUNTIME_FLAGS = '{"templateSwapPeople":true}'; t.after(() => { delete process.env.APP_RUNTIME_FLAGS; }); };
const idOf = ref => ref.asset_id;

test('key ON: the catalog asks for two people, one photo is refused with no job, no debit and no provider call', async t => {
  onFlags(t);
  const net = network(t);
  const view = await (await get(ID)).json();
  assert.deepEqual(view, { id: ID, model: 'kling-o1-reference', credits: 47, durationSeconds: 5, role: ROLES[0], roles: ROLES, people: 2, images: 4 });
  for (const references of [[four[0], four[1]], [four[0]], four.slice(0, 3), [...four, asset(9)]]) {
    const response = await post({ references });
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: 'template_swap_photo_count' });
  }
  assert.equal(net.debits.length, 0); assert.equal(net.freeAdmissions.length, 0); assert.equal(net.submits.length, 0);
});

test('key ON: two people become @Element1 and @Element2 in photo order, one price, roles kept on the job', async t => {
  onFlags(t);
  const net = network(t);
  assert.equal((await post()).status, 200);
  assert.equal(net.debits.length, 1); assert.equal(net.debits[0].p_credits, 47);
  assert.equal(net.debits[0].p_inputs.prompt, templateSwapPeoplePrompt(ROLES));
  assert.deepEqual(net.debits[0].p_inputs.template_source, { template: ID, version: 'v1', sha256: 'a'.repeat(64), role: ROLES[0], roles: ROLES });
  assert.deepEqual(net.debits[0].p_inputs.references, four);
  const payload = net.submits[0];
  assert.equal(payload.prompt, templateSwapPeoplePrompt(ROLES));
  assert.equal(payload.image_url, undefined); assert.equal(payload.image_urls, undefined);
  assert.equal(payload.elements.length, 2);
  const path = url => new URL(url).pathname;
  four.forEach((ref, index) => {
    const element = payload.elements[index >> 1], got = index % 2 ? element.reference_image_urls[0] : element.frontal_image_url;
    assert.ok(path(got).endsWith(`jobs/${idOf(ref)}/output.jpg`), `reference ${index}`);
  });
  assert.equal(payload.duration, '5'); assert.equal(payload.keep_audio, false);
  // A lost reply is replayed from the stored two-role identity: same job, no second charge, no second provider call.
  const again = await post();
  assert.equal(again.status, 200); assert.equal((await again.json()).idempotent, true);
  assert.equal(net.charges(), 1); assert.equal(net.submits.length, 1);
});

test('key ON but another id, or key OFF: the one-person path is unchanged', async t => {
  const off = network(t);
  assert.deepEqual(await (await get(ID)).json(), { id: ID, model: 'kling-o1-reference', credits: 47, durationSeconds: 5, role: ROLES[0], images: 2 });
  assert.equal((await post({ references: four.slice(0, 2) })).status, 200);
  assert.equal(off.submits[0].elements.length, 1);
  assert.equal(off.debits[0].p_inputs.prompt, templateSwapPrompt(ROLES[0]));
  assert.deepEqual(off.debits[0].p_inputs.template_source, { template: ID, version: 'v1', sha256: 'a'.repeat(64), role: ROLES[0] });
  assert.deepEqual(await (await post({ references: four, idempotency_key: 'four-photos-key-off' })).json(), { error: 'template_swap_photo_count' });
  onFlags(t);
  assert.deepEqual(await (await get(ONE)).json(), { id: ONE, model: 'kling-o1-reference', credits: 47, durationSeconds: 5, role: 'the main character', images: 2 });
  const oneOn = await post({ template_swap: ONE, references: four.slice(0, 2), idempotency_key: 'one-person-key-on' });
  assert.equal(oneOn.status, 200);
  assert.equal(off.submits[1].elements.length, 1);
});

test('the people key alone does nothing while the swap switch is off', async t => {
  onFlags(t); network(t); process.env.TEMPLATE_SWAP_CLIP_ENABLED = 'false';
  t.after(() => { process.env.TEMPLATE_SWAP_CLIP_ENABLED = 'true'; });
  assert.equal((await get(ID)).status, 404);
});
