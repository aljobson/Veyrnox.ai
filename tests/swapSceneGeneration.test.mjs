import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { isDeepStrictEqual } from 'node:util';
import { readFileSync } from 'node:fs';
import { scenes, manifest, catalog } from './fixtures/swapScenes.mjs';
// Fixtures replace only empty data modules in this isolated test process.
register('data:text/javascript,' + encodeURIComponent(`
export async function resolve(s,c,next) { return next(s === 'next/server' ? 'next/server.js' : s,c); }
export async function load(url,c,next) {
  const result = await next(url,c);
  if (url.endsWith('/app/veyrnox/_lib/swapScenes.js')) return { ...result, source: String(result.source).replace('Object.freeze([])', ${JSON.stringify(JSON.stringify(scenes))}) };
  if (url.endsWith('/lib/swapSceneSources.js')) return { ...result, source: String(result.source).replace('Object.freeze({})', ${JSON.stringify(JSON.stringify(manifest))}) };
  if (url.endsWith('/lib/templateStart.js')) return { ...result, source: 'export const templateStartId = raw => raw === \"fixture-matching-template\" ? raw : null;' };
  return result;
}`));
Object.assign(process.env, {
  APP_ENV: 'staging', SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'test-service', FAL_KEY: 'test-fal',
  CRUN_ENABLED: 'true', CRUN_API_KEY: 'test-crun', PUBLIC_HOST: 'https://veyrnox.test',
  R2_ACCOUNT_ID: 'test', R2_ACCESS_KEY_ID: 'test', R2_SECRET_ACCESS_KEY: 'test', R2_BUCKET: 'test',
  FREE_ALLOWANCE_ENABLED: 'false', FAL_DURABLE_DISPATCH_ENABLED: 'false', FAL_DISPATCH_SCHEMA_ENABLED: 'false',
  SUPPLIER_ROUTES_ENABLED: 'false', MAX_CHARGE_ENABLED: 'false', MULTI_REFERENCE_ENABLED: 'false',
});
const { POST } = await import('../app/api/v1/generations/route.js');
const { GET } = await import('../app/api/catalog/route.js');
const { SWAP_SCENE_SOURCES } = await import('../lib/swapSceneSources.js');
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
      return Response.json(catalog.filter(r => `eq.${r.id}` === url.searchParams.get('id')).map(r => ({ ...r, active: options.active !== false })));
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
      assert.ok(!url.pathname.includes('swap-scenes/'), 'trusted shared clips are never sniffed or downloaded');
      assert.ok(url.pathname.endsWith(`jobs/${PHOTO}/output.jpg`));
      const [, a, b] = /bytes=(\d+)-(\d+)/.exec(init.headers.Range);
      const start = Number(a), end = Math.min(Number(b), jpeg.length - 1);
      return new Response(jpeg.subarray(start, end + 1), { status: 206, headers: { 'content-type': 'image/jpeg', 'content-range': `bytes ${start}-${end}/${jpeg.length}` } });
    }
    if (['queue.fal.run', 'api.crun.ai'].includes(url.hostname)) {
      submits.push(body);
      return Response.json(url.hostname === 'queue.fal.run' ? { request_id: 'fixture-task' } : { code: 200, data: { task_id: 'fixture-task' } });
    }
    throw Error(`Unexpected network ${url.hostname}${url.pathname}`);
  });
  return { debits, submits, calls, charges: () => charges };
}
function post(scene = scenes[0], overrides = {}) {
  return POST(new Request('https://veyrnox.test/api/v1/generations', { method: 'POST', headers: { 'x-veyrnox-auth-id': AUTH }, body: JSON.stringify({ model_id: scene.swapOffer, swap: scene.id,
    inputs: {}, consent: true, references: [photo], idempotency_key: 'scene-proof-key', ...overrides }) }));
}
function get(id, auth = true) {
  return GET(new Request('https://veyrnox.test/api/catalog?swap=' + encodeURIComponent(id), { headers: auth ? { 'x-veyrnox-auth-id': AUTH } : {} }));
}
for (const scene of [scenes[0], scenes[3]]) for (const seconds of [5,7,10]) test(`${scene.swapOffer}: ${seconds}s clip displays and debits one unit, provider URL is server-owned`, async t => {
  const net = network(t); const source = SWAP_SCENE_SOURCES[scene.id], old = { ...source };
  Object.assign(source, { seconds, videoSeconds: seconds }); t.after(() => Object.assign(source, old));
  const config = await get(scene.id, false), view = await config.json();
  assert.equal(view.credits, scene.credits); assert.equal(view.durationSeconds, 5);
  assert.equal(config.headers.get('cache-control'), 'no-store');
  assert.doesNotMatch(JSON.stringify(view), /sha256|swap-scenes\/|X-Amz|video_url/);
  const res = await post(scene); assert.equal(res.status, 200, JSON.stringify(await res.json()));
  assert.equal(net.debits[0].p_credits, scene.credits);
  assert.deepEqual(net.debits[0].p_inputs.template_source, { scene: scene.id, version: 'v1', sha256: 'a'.repeat(64) });
  assert.deepEqual(net.debits[0].p_inputs.references, [photo]);
  assert.doesNotMatch(JSON.stringify(net.debits[0].p_inputs), /https:|swap-scenes\//);
  const payload = net.submits[0].input || net.submits[0];
  const signed = new URL(payload.video_url || payload.video_urls?.[0]);
  assert.ok(signed.pathname.endsWith(source.key)); assert.equal(signed.searchParams.get('X-Amz-Expires'), '900');
  assert.equal(payload.duration, undefined);
});
for (const [label, overrides, error] of [
  ['URL', { inputs: { video_url: 'https://caller.test/a.mp4' } }, 'swap_video_not_allowed'],
  ['top-level URL', { video_url: 'https://caller.test/a.mp4' }, 'swap_video_not_allowed'],
  ['video asset', { references: [photo, { ...photo, slot: 'video' }] }, 'swap_video_not_allowed'],
  ['legacy video upload', { references: undefined, source_key: `uploads/${AUTH}/${PHOTO}.mp4` }, 'swap_video_not_allowed'],
  ['wrong model', { model_id: 'swap-quick' }, 'swap_model_mismatch'],
  ['no photo', { references: [] }, 'swap_photo_count'],
  ['extra photo', { references: [photo, photo] }, 'swap_photo_count'],
  ['long output', { inputs: { duration_seconds: 10 } }, 'duration_not_supported'],
  ['foreign customer upload', { references: [{ slot: 'image', origin: 'upload', key: `uploads/${JOB}/${PHOTO}.jpg` }] }, 'source_not_found'],
  ['untrusted reference origin', { references: [{ slot: 'image', origin: 'scene', key: 'swap-scenes/test.mp4' }] }, 'references_invalid'],
  ['no consent', { consent: false }, 'consent_required'],
]) test(`refuses ${label} before debit`, async t => {
  const net = network(t), res = await post(scenes[0], overrides);
  assert.equal((await res.json()).error, error); assert.equal(net.debits.length, 0); assert.equal(net.submits.length, 0);
});
for (const [override, error] of [[{ seconds: undefined }, 'source_length_unknown'], [{ seconds: 11, videoSeconds: 7 }, 'source_too_long']]) test(`manifest admission: ${error}`, async t => {
  const source = SWAP_SCENE_SOURCES[scenes[0].id], old = { ...source }; Object.assign(source, override);
  t.after(() => Object.assign(source, old)); const net = network(t), res = await post();
  assert.equal((await res.json()).error, error); assert.equal(net.debits.length, 0);
});
test('config and generation share the environment, active-row and effective photo-count gate', async t => {
  const net = network(t);
  for (const flag of ['false', 'true']) {
    process.env.MULTI_REFERENCE_ENABLED = flag;
    const scene = scenes[2];
    assert.equal((await get(scene.id)).status, flag === 'true' ? 200 : 404);
    assert.equal((await post(scene, { references: [photo, photo] })).status, flag === 'true' ? 200 : 404);
  }
  process.env.MULTI_REFERENCE_ENABLED = 'false';
  process.env.APP_ENV = 'production'; t.after(() => { process.env.APP_ENV = 'staging'; });
  assert.equal((await get(scenes[0].id)).status, 404); assert.equal((await post(scenes[0], { idempotency_key: 'production-new-key' })).status, 404);
  assert.equal(net.charges(), 1);
});
for (const options of [{ active: false }, { catalogFailure: true }]) test(`hidden offer ${JSON.stringify(options)} gives uniform not found`, async t => {
  const net = network(t, options);
  assert.deepEqual(await (await get(scenes[0].id)).json(), { error: 'swap_scene_not_found' });
  assert.deepEqual(await (await post()).json(), { error: 'swap_scene_not_found' });
  assert.equal(net.debits.length, 0);
});
test('unknown and missing manifest are not found regardless of inbound identity', async t => {
  const net = network(t); const source = SWAP_SCENE_SOURCES[scenes[0].id]; delete SWAP_SCENE_SOURCES[scenes[0].id];
  t.after(() => { SWAP_SCENE_SOURCES[scenes[0].id] = source; });
  for (const id of ['missing', scenes[0].id]) {
    assert.equal((await get(id)).status, 404); assert.equal((await post(scenes[0], { swap: id })).status, 404);
  }
  assert.equal((await get('missing', false)).status, 404); assert.equal(net.debits.length, 0);
});
test('identical replay never resubmits; different scene, version or hash conflicts under the retained identity', async t => {
  const net = network(t);
  assert.equal((await post()).status, 200);
  assert.equal((await (await post()).json()).idempotent, true);
  assert.equal((await post(scenes[1])).status, 409);
  const source = SWAP_SCENE_SOURCES[scenes[0].id], old = { ...source };
  t.after(() => Object.assign(source, old)); source.version = 'v2';
  assert.equal((await post()).status, 409);
  source.version = 'v1'; source.sha256 = 'b'.repeat(64);
  assert.equal((await post()).status, 409);
  assert.equal(net.charges(), 1); assert.equal(net.submits.length, 1);
  const migration = readFileSync(new URL('../packages/db/schema/supabase/0399_multi_reference_identity.sql', import.meta.url), 'utf8');
  assert.match(migration, /- ARRAY\['preset_id','source_keys','source_assets'\]/);
  assert.doesNotMatch(migration, /'template_source'/);
});


test('swap never records caller preset attribution', async t => {
  const net = network(t);
  assert.equal((await post(scenes[0], { preset: 'fixture-matching-template' })).status, 200);
  assert.equal(Object.hasOwn(net.debits[0].p_inputs, 'preset_id'), false);
});
test('rate limit precedes every scene/catalog and replay read', async t => {
  const net = network(t, { throttled: true });
  assert.equal((await post()).status, 429);
  assert.deepEqual(net.calls, ['check_generation_rate_limit']);
});
test('accepted scene replays after pausing or unpublishing without debit, media reads or dispatch', async t => {
  const options = {}, net = network(t, options);
  assert.equal((await post()).status, 200);
  assert.equal(net.calls[0], 'check_generation_rate_limit');
  options.active = false;
  let start = net.calls.length;
  assert.deepEqual(await (await post()).json(), { job_id: JOB, idempotent: true });
  assert.deepEqual(net.calls.slice(start), ['check_generation_rate_limit', 'users', 'jobs']);
  const source = SWAP_SCENE_SOURCES[scenes[0].id]; delete SWAP_SCENE_SOURCES[scenes[0].id];
  t.after(() => { SWAP_SCENE_SOURCES[scenes[0].id] = source; });
  start = net.calls.length;
  assert.equal((await post()).status, 200);
  assert.deepEqual(net.calls.slice(start), ['check_generation_rate_limit', 'users', 'jobs']);
  assert.equal((await post(scenes[0], { inputs: { prompt: 'changed' } })).status, 409);
  assert.equal((await post(scenes[0], { references: [{ ...photo, asset_id: AUTH }] })).status, 409);
  assert.equal((await post(scenes[1])).status, 409);
  assert.equal((await post(scenes[0], { idempotency_key: 'new-scene-key' })).status, 404);
  assert.equal(net.charges(), 1); assert.equal(net.debits.length, 1); assert.equal(net.submits.length, 1);
});

test('generation kill switch preserves an admitted swap replay before the publication lookup', async t => {
  const options = {}, net = network(t, options);
  assert.equal((await post()).status, 200);
  const { refreshRuntimeSwitches } = await import('../lib/runtimeSwitchCache.js');
  await refreshRuntimeSwitches();
  options.active = false;
  let start = net.calls.length;
  assert.deepEqual(await (await post()).json(), { job_id: JOB, idempotent: true });
  assert.deepEqual(net.calls.slice(start), ['users', 'jobs', 'check_generation_rate_limit', 'users', 'jobs']);
  start = net.calls.length;
  assert.equal((await post(scenes[0], { idempotency_key: 'paused-new-key' })).status, 503);
  assert.deepEqual(net.calls.slice(start), ['users', 'jobs']);
  assert.equal(net.charges(), 1); assert.equal(net.submits.length, 1);
});
