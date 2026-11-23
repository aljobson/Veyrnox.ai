import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { register } from 'node:module';
import { source as fixtureSource, catalog, registry, manifestBytes, pin, publishManifest } from './fixtures/templateSwapClips.mjs';
import { buildRequest, parseEndpoint, submitTask } from '../packages/adapters/crun.js';
import { classifySubmitFailure } from '../lib/supplierRoutesFailover.js';
import { templateSwapPrompt } from '../lib/templateSwapClipPrompt.mjs';
import { reduceAttempt, swapErrorKey, fetchSwapAvailability } from '../app/veyrnox/_lib/templateSwapClient.mjs';
import { toPublicModels, normalizeCachedModels } from '../lib/publicCatalog.js';
import { capabilityFor } from '../lib/modelCapabilities.js';
import { sweepCrun } from '../lib/crunSweep.js';
import { uploadKeyFor } from '../lib/uploadSource.js';
import { lipSyncMp4 } from './fixtures/lipSyncMp4.mjs';

const TWO = 'basketball-3';
registry.push(TWO);
register('data:text/javascript,' + encodeURIComponent(`
export async function resolve(s,c,next) { return next(s === 'next/server' ? 'next/server.js' : s,c); }
export async function load(url,c,next) {
  const result = await next(url,c);
  if (url.endsWith('/app/veyrnox/_lib/templateSwapClips.js')) return { ...result, source: String(result.source).replace(/Object\\.freeze\\(\\[[^\\]]*\\]\\)/, ${JSON.stringify(JSON.stringify(registry))}).replace(/export const TEMPLATE_SWAP_CLIP_MANIFEST_SHA256 = '[0-9a-f]*';/, ${JSON.stringify(`export { pin as TEMPLATE_SWAP_CLIP_MANIFEST_SHA256 } from '${new URL('./fixtures/templateSwapClips.mjs', import.meta.url).href}';`)}) };
  return result;
}`));
Object.assign(process.env, {
  TEMPLATE_SWAP_CLIP_ENABLED: 'true', SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'test-service', FAL_KEY: 'test-fal',
  CRUN_ENABLED: 'true', CRUN_API_KEY: 'test-crun', PUBLIC_HOST: 'https://veyrnox.test', R2_ACCOUNT_ID: 'test', R2_ACCESS_KEY_ID: 'test',
  R2_SECRET_ACCESS_KEY: 'test', R2_BUCKET: 'test', FREE_ALLOWANCE_ENABLED: 'false', FAL_DURABLE_DISPATCH_ENABLED: 'false',
  FAL_DISPATCH_SCHEMA_ENABLED: 'false', SUPPLIER_ROUTES_ENABLED: 'false', MAX_CHARGE_ENABLED: 'false', MULTI_REFERENCE_ENABLED: 'true', PRIVACY_EXPORT_ENABLED: 'true',
});
const { POST } = await import('../app/api/v1/generations/route.js');
const { GET: catalogGet } = await import('../app/api/catalog/route.js');
const { GET: jobsGet } = await import('../app/api/v1/jobs/route.js');
const { GET: jobGet } = await import('../app/api/v1/jobs/[id]/route.js');
const { GET: provenanceGet } = await import('../app/api/v1/jobs/[id]/provenance/route.js');
const { GET: appealsGet } = await import('../app/api/v1/appeals/route.js');
const { GET: exportGet } = await import('../app/api/v1/account/export/[exportId]/route.js');

const PRIVATE = 'kling-o1-swap-crun', PUBLIC = 'kling-o1-reference', ENDPOINT = 'crun:kling/o1-r2v';
const ID = 'community-athlete-identity-swap';
const AUTH = '11111111-1111-4111-8111-111111111111', JOB = '22222222-2222-4222-8222-222222222222';
const PHOTO = '33333333-3333-4333-8333-333333333333', CROP = '44444444-4444-4444-8444-444444444444';
const refs = [{ slot: 'image', origin: 'asset', asset_id: PHOTO }, { slot: 'image', origin: 'asset', asset_id: CROP }];
const privateRow = { id: PRIVATE, provider: 'crun', provider_endpoint: ENDPOINT, modality: 'video-to-video', credits_5s: 47, active: true, gated_flag: false, name: 'Kling O1 · Reference' };
const SIGNED = 'https://bucket.r2.cloudflarestorage.com/clip.mp4?X-Amz-Signature=deadbeefsecret';
const swapManifest = { [ID]: fixtureSource, [TWO]: { ...fixtureSource, key: `template-swap-clips/${TWO}/${'a'.repeat(64)}.mp4` } };

function png() {
  const bytes = Buffer.alloc(32); Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(bytes);
  bytes.write('IHDR', 12); bytes.writeUInt32BE(640, 16); bytes.writeUInt32BE(640, 20); return bytes;
}

// The shared MP4 fixture is 640x360, below O1's 720 minimum: raise the track header to 1280x720.
function hdMp4() {
  const bytes = Buffer.from(lipSyncMp4({ video: 5, sampleCount: 150 }));
  const at = bytes.indexOf('tkhd') - 4, end = at + bytes.readUInt32BE(at);
  bytes.writeUInt32BE(1280 * 65536, end - 8);
  bytes.writeUInt32BE(720 * 65536, end - 4);
  return bytes;
}

function network(t, { row = privateRow, crun, stored = new Map(), video = null } = {}) {
  publishManifest(swapManifest);
  const state = { debits: [], refunds: [], crun: [], fal: [], stored, catalogFilters: [] };
  t.mock.method(globalThis, 'fetch', async (target, init = {}) => {
    const url = new URL(String(target)), name = url.pathname.split('/').at(-1);
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : null;
    if (url.pathname.includes('/template-swap-clips/manifests/')) return new Response(manifestBytes);
    if (name === 'runtime_switches') return Response.json([{ key: 'generation', state: 'off' }]);
    if (name === 'model_catalog') {
      const filter = url.searchParams.get('id');
      state.catalogFilters.push(filter);
      return Response.json([...catalog, ...(row ? [row] : [])].filter(r => !filter || filter === `eq.${r.id}`));
    }
    if (name === 'users') return Response.json([{ id: AUTH }]);
    if (name === 'jobs') {
      const job = state.stored.get(url.searchParams.get('idempotency_key')?.slice(3));
      return Response.json(job ? [{ id: JOB, model_id: job.model, inputs: job.inputs }] : []);
    }
    if (url.pathname.includes('/rpc/')) {
      if (name === 'get_user_asset') return Response.json({ ok: true, state: 'STORED', mime_type: 'image/png', r2_key: `jobs/${body.p_job_id || PHOTO}/output.png` });
      if (name === 'ledger_refund') state.refunds.push(body);
      if (name === 'ledger_debit') {
        state.debits.push(body);
        const previous = state.stored.get(body.p_idempotency_key);
        if (!previous) state.stored.set(body.p_idempotency_key, { model: body.p_model_id, inputs: body.p_inputs });
        return Response.json({ ok: true, idempotent: !!previous, job_id: JOB, balance_after: 453 });
      }
      return Response.json({ ok: true });
    }
    if (url.hostname.endsWith('.r2.cloudflarestorage.com')) {
      const isVideo = video && url.pathname.endsWith('.mp4');
      const bytes = isVideo ? video : png(), [, a, b] = /bytes=(\d+)-(\d+)/.exec(init.headers.Range);
      const start = Number(a), end = Math.min(Number(b), bytes.length - 1);
      return new Response(bytes.subarray(start, end + 1), { status: 206, headers: { 'content-type': isVideo ? 'video/mp4' : 'image/png', 'content-range': `bytes ${start}-${end}/${bytes.length}` } });
    }
    if (url.hostname === 'api.crun.ai') { state.crun.push(body); return crun ? crun() : Response.json({ code: 200, data: { task_id: 'crun-task-1' } }); }
    if (url.hostname === 'queue.fal.run') { state.fal.push({ path: url.pathname, body: init.body }); return Response.json({ request_id: 'fal-task-1' }); }
    throw Error(`Unexpected network ${url.hostname}${url.pathname}`);
  });
  return state;
}
const post = (over = {}) => POST(new Request('https://veyrnox.test/api/v1/generations', { method: 'POST', headers: { 'x-veyrnox-auth-id': AUTH },
  body: JSON.stringify({ model_id: PUBLIC, template_swap: ID, inputs: {}, consent: true, references: refs, idempotency_key: 'swap-crun-key', ...over }) }));
const elements = (n = 1) => [{ frontal_image_url: 'https://r2.test/1.png', reference_image_urls: Array.from({ length: n }, (_, i) => `https://r2.test/${i + 2}.png`) }];
const swapInputs = over => ({ prompt: templateSwapPrompt('the main character'), duration_seconds: 5, video_url: 'https://r2.test/clip.mp4', elements: elements(), ...over });
const target = parseEndpoint(ENDPOINT);

test('a one-person swap builds exactly the planned Crun body', () => {
  const built = buildRequest(target, swapInputs());
  assert.equal(built.ok, true);
  const { prompt, ...rest } = built.body.input;
  assert.deepEqual({ model: built.body.model, ...rest }, {
    model: 'kling/o1-r2v', reference_videos: ['https://r2.test/clip.mp4'], reference_video_type: 'base_video',
    reference_images: ['https://r2.test/1.png', 'https://r2.test/2.png'], resolution: '720p', aspect_ratio: 'auto', audio: false,
  });
  assert.ok(prompt.length <= 2500);
  assert.doesNotMatch(prompt, /@/);
  assert.match(prompt, /^Change the main character in the reference video to the person shown in reference images 1 and 2\./);
  assert.match(prompt, /Do not alter that person's facial features/);
  const full = buildRequest(target, swapInputs({ elements: elements(2) }));
  assert.equal(full.body.input.reference_images.length, 3);
  assert.match(full.body.input.prompt, /reference images 1 to 3/);
});

test('the Crun swap builder refuses anything outside the swap contract', () => {
  for (const [over, error] of [
    [{ elements: [...elements(), ...elements()] }, 'inputs_invalid:elements'],
    [{ elements: elements(3) }, 'inputs_invalid:elements'],
    [{ elements: [{ ...elements()[0], extra: 1 }] }, 'inputs_invalid:elements'],
    [{ video_url: 'http://r2.test/clip.mp4' }, 'inputs_invalid:video_url'],
    [{ duration_seconds: 10 }, 'duration_not_supported'],
    [{ prompt: 'x'.repeat(2501) }, 'inputs_invalid:prompt'],
    [{ prompt: 'Keep @Image1 here' }, 'inputs_invalid:prompt'],
    [{ aspect_ratio: '16:9' }, 'inputs_key_not_allowed:aspect_ratio'],
  ]) assert.deepEqual(buildRequest(target, swapInputs(over)), { ok: false, error });
});

test('an upstream message with a signed URL never leaves the adapter; failover classes are unchanged', async t => {
  const job = { job_id: 'job-1', provider_endpoint: ENDPOINT, inputs: swapInputs() };
  for (const status of [401, 403, 429]) {
    t.mock.method(globalThis, 'fetch', async () => Response.json({ code: status, message: `bad media ${SIGNED}` }, { status }));
    const out = await submitTask(job, { apiKey: 'k' });
    t.mock.restoreAll();
    assert.equal(out.error, status === 429 ? 'provider_rate_limited' : 'provider_auth_failed');
    assert.doesNotMatch(JSON.stringify(out), new RegExp(SIGNED.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.equal(classifySubmitFailure(out), 'failover');
  }
  t.mock.method(globalThis, 'fetch', async () => Response.json({ code: 400, message: `content policy ${SIGNED}` }, { status: 400 }));
  assert.equal((await submitTask(job, { apiKey: 'k' })).error, 'provider_refused');
  t.mock.restoreAll();
  t.mock.method(globalThis, 'fetch', async () => { throw new Error(`connect failed ${SIGNED}`); });
  const transport = await submitTask(job, { apiKey: 'k' });
  assert.deepEqual([transport.outcome, transport.error], ['unknown', 'provider_unreachable']);
  t.mock.restoreAll();
  t.mock.method(globalThis, 'fetch', async () => Response.json({ code: 400, message: 'plain refusal' }, { status: 400 }));
  const other = await submitTask({ job_id: 'job-2', provider_endpoint: 'crun:kling/v2-6', inputs: { prompt: 'a cat' } }, { apiKey: 'k' });
  assert.equal(other.error, 'provider_refused', 'every Crun model uses the sanitized boundary');
});

test('with the private row active a swap debits it and submits one Crun task; the client sees only the public offer', async t => {
  const net = network(t);
  const availability = await catalogGet(new Request(`https://veyrnox.test/api/catalog?template_swap=${ID}`));
  const offer = await availability.json();
  assert.equal(offer.model, PUBLIC);
  assert.doesNotMatch(JSON.stringify(offer), /swap-crun|crun/);
  assert.ok(await fetchSwapAvailability(ID, async () => Response.json(offer)), 'the unchanged web validator accepts the response');
  const res = await post({ max_charge_credits: 47 });
  const text = await res.text();
  assert.equal(res.status, 200, text);
  assert.doesNotMatch(text, /swap-crun/);
  assert.equal(net.debits.length, 1);
  assert.equal(net.debits[0].p_model_id, PRIVATE);
  assert.equal(net.debits[0].p_credits, 47);
  assert.equal(net.crun.length, 1);
  assert.equal(net.fal.length, 0);
  assert.equal(net.crun[0].model, 'kling/o1-r2v');
  assert.equal(net.crun[0].input.reference_images.length, 2);
  assert.doesNotMatch(JSON.stringify(net.debits[0].p_inputs), /X-Amz|elements|video_url/);
  // Same key again: no second debit effect and no second task.
  const again = await post({ max_charge_credits: 47 });
  assert.deepEqual(await again.json(), { job_id: JOB, idempotent: true });
  assert.equal(net.crun.length, 1);
});

test('without an active private row a swap stays on the fal offer exactly as today', async t => {
  for (const row of [null, { ...privateRow, active: false }]) {
    const net = network(t, { row });
    const res = await post({ idempotency_key: `swap-fal-${row ? 'off' : 'none'}` });
    assert.equal(res.status, 200);
    assert.equal(net.debits[0].p_model_id, PUBLIC);
    assert.equal(net.crun.length, 0);
    assert.equal(net.fal.length, 1);
    t.mock.restoreAll();
  }
});

test('an active private row that does not match the offer refuses before debit', async t => {
  for (const row of [{ ...privateRow, credits_5s: 48 }, { ...privateRow, provider: 'fal' }, { ...privateRow, provider_endpoint: 'crun:kling/v3' }, { ...privateRow, gated_flag: true }]) {
    const net = network(t, { row });
    const res = await post({ idempotency_key: 'swap-mismatch' });
    assert.equal(res.status, 502);
    assert.deepEqual(await res.json(), { error: 'catalog_lookup_failed' });
    assert.equal(net.debits.length, 0);
    t.mock.restoreAll();
  }
});

test('the private id cannot be requested, in either form, with or without a swap', async t => {
  const net = network(t);
  for (const model_id of [PRIVATE, 'kling-o1-swap-a3']) {
    for (const over of [{ model_id }, { model_id, template_swap: undefined }]) {
      const res = await post(over);
      assert.equal(res.status, 404);
      assert.deepEqual(await res.json(), { error: 'model_not_found' });
    }
  }
  assert.equal(net.debits.length, 0);
});

test('a request without template_swap is byte-for-byte the fal request, whatever the private row says', async t => {
  const videoKey = uploadKeyFor(AUTH, 'video/mp4', 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee').key;
  const request = { template_swap: undefined, inputs: { prompt: 'Restyle the clip', duration_seconds: 5 }, references: [refs[0], { slot: 'video', origin: 'upload', key: videoKey }], idempotency_key: 'plain-o1-key' };
  // Signatures carry the clock, so a URL is compared without its query string.
  const unsigned = text => text.replace(/\?X-Amz-[^"]*/g, '');
  const outcomes = [];
  for (const row of [null, privateRow]) {
    const net = network(t, { row, video: hdMp4() });
    const res = await post(request);
    outcomes.push({ status: res.status, body: await res.text(), fal: net.fal.map(f => ({ path: f.path, body: unsigned(f.body) })),
      debit: net.debits.map(d => [d.p_model_id, d.p_credits, unsigned(JSON.stringify(d.p_inputs))]), crun: net.crun.length, readPrivate: net.catalogFilters.includes(`eq.${PRIVATE}`) });
    t.mock.restoreAll();
  }
  assert.equal(outcomes[0].status, 200, outcomes[0].body);
  assert.equal(outcomes[0].fal.length, 1, 'the request reaches fal');
  assert.match(outcomes[0].fal[0].path, /kling-video\/o1\/video-to-video\/reference/);
  assert.deepEqual(outcomes[1], outcomes[0]);
  assert.equal(outcomes[1].debit[0][0], PUBLIC);
  assert.equal(outcomes[1].crun, 0);
  assert.equal(outcomes[1].readPrivate, false);
});

test('a two-person swap refuses before debit on Crun and settles as not charged', async t => {
  process.env.APP_RUNTIME_FLAGS = '{"templateSwapPeople":true}';
  t.after(() => { delete process.env.APP_RUNTIME_FLAGS; });
  const net = network(t);
  const four = [...refs, { ...refs[0], asset_id: '55555555-5555-4555-8555-555555555555' }, { ...refs[0], asset_id: '66666666-6666-4666-8666-666666666666' }];
  const res = await post({ template_swap: TWO, references: four, idempotency_key: 'two-people-key' });
  assert.equal(res.status, 400);
  assert.deepEqual(await res.json(), { error: 'template_swap_people_unsupported' });
  assert.equal(net.debits.length + net.crun.length + net.fal.length, 0);
  const error = { code: 'template_swap_people_unsupported', status: 400, body: { error: 'template_swap_people_unsupported' } };
  assert.equal(reduceAttempt({ state: 'submitting' }, { error }).state, 'not_charged');
  assert.equal(reduceAttempt({ state: 'unknown', uncertain: true, responses: 1 }, { error }).state, 'unknown', 'an earlier ambiguous reply stays uncertain');
  assert.equal(swapErrorKey('template_swap_people_unsupported'), 'presets.swap.people_unsupported');
});

test('a refusal refunds, an ambiguous submit does not, and a signed URL reaches neither logs nor the response', async t => {
  const logs = [];
  t.mock.method(console, 'error', (...args) => logs.push(args.map(String).join(' ')));
  const refused = network(t, { crun: () => Response.json({ code: 422, message: `rejected ${SIGNED}` }, { status: 422 }) });
  const res = await post({ idempotency_key: 'crun-refused' });
  const text = await res.text();
  assert.equal(res.status, 422);
  assert.deepEqual(JSON.parse(text), { error: 'provider_input_rejected', job_id: JOB });
  assert.equal(refused.refunds.length, 1);
  assert.doesNotMatch(text + logs.join('\n'), /X-Amz|deadbeef|cloudflarestorage/);
  t.mock.restoreAll();
  t.mock.method(console, 'error', (...args) => logs.push(args.map(String).join(' ')));
  const ambiguous = network(t, { crun: () => Response.json({ code: 500, message: `oops ${SIGNED}` }, { status: 500 }) });
  const unknown = await post({ idempotency_key: 'crun-ambiguous' });
  const unknownText = await unknown.text();
  assert.equal(ambiguous.refunds.length, 0, 'an ambiguous submit never refunds automatically');
  assert.equal(ambiguous.crun.length, 1);
  assert.doesNotMatch(unknownText + logs.join('\n'), /X-Amz|deadbeef|cloudflarestorage/);
});

test('replay crosses activation and rollback without a second task on the other supplier', async t => {
  const stored = new Map();
  let net = network(t, { row: null, stored });
  assert.equal((await post({ idempotency_key: 'fal-then-crun' })).status, 200);
  assert.equal(net.fal.length, 1);
  t.mock.restoreAll();
  net = network(t, { stored });
  assert.deepEqual(await (await post({ idempotency_key: 'fal-then-crun' })).json(), { job_id: JOB, idempotent: true });
  assert.equal(net.crun.length + net.fal.length + net.debits.length, 0, 'an in-flight fal job replays after activation');
  assert.equal((await post({ idempotency_key: 'crun-then-off' })).status, 200);
  assert.equal(net.crun.length, 1);
  t.mock.restoreAll();
  net = network(t, { row: { ...privateRow, active: false }, stored });
  assert.deepEqual(await (await post({ idempotency_key: 'crun-then-off' })).json(), { job_id: JOB, idempotent: true });
  assert.equal(net.crun.length + net.fal.length + net.debits.length, 0, 'a Crun job replays after rollback');
  const conflict = await post({ idempotency_key: 'crun-then-off', references: [refs[1], refs[0]] });
  assert.equal(conflict.status, 409);
  assert.deepEqual(await conflict.json(), { error: 'idempotency_conflict' });
});

test('rollback leaves a submitted Crun job pollable: it completes or refunds through its retained route', async t => {
  const rows = { model_routes: [{ model_id: PRIVATE, endpoint: ENDPOINT }], jobs: [{ id: JOB, user_id: AUTH, credits: 47, state: 'SUBMITTED', provider_job_id: 'crun-task-1', created_at: new Date().toISOString(), model_id: PRIVATE }] };
  t.mock.method(globalThis, 'fetch', async target => Response.json(rows[new URL(String(target)).pathname.split('/').at(-1)] || []));
  const args = { cfg: { supabaseUrl: 'https://db.test', serviceRoleKey: 'k' }, r2cfg: { accountId: 'a', accessKeyId: 'b', secretAccessKey: 'c', bucket: 'd' }, apiKey: 'k',
    // The shared TaskInfo pacer needs its reservation RPC; this test is about the retained route, not pacing.
    pace: async () => true };
  const settled = [];
  const complete = async call => { settled.push(call); return { status: 200, body: {} }; };
  assert.equal((await sweepCrun({ ...args, complete, read: async () => ({ ok: true, state: 'success', outputUrl: 'https://static.test/out.mp4' }) })).applied, 1);
  assert.equal(settled[0].outcome.state, 'success');
  assert.equal((await sweepCrun({ ...args, complete, read: async () => ({ ok: true, state: 'fail', errorCode: `https://x.test/?sig=1` }) })).applied, 1);
  assert.equal(settled[1].outcome.errorCode, 'provider_failed', 'a code that is not a plain word is not kept');
});

test('every job read shows the public id for a private-row job', async t => {
  const row = { ok: true, state: 'STORED', credits: 47, model_id: PRIVATE, provider: 'crun', created_at: new Date().toISOString() };
  t.mock.method(globalThis, 'fetch', async target => {
    const url = new URL(String(target)), name = url.pathname.split('/').at(-1);
    if (name === 'list_user_jobs') return Response.json({ ok: true, jobs: [{ job_id: JOB, state: 'STORED', credits: 47, model_id: PRIVATE, created_at: row.created_at }] });
    if (name === 'get_user_job') return Response.json(row);
    if (name === 'list_my_sanctions') return Response.json({ ok: true, sanctions: [{ action_id: 'a', job_id: JOB, model_id: PRIVATE }] });
    if (name === 'read_privacy_export_page') return Response.json({ ok: true, rows: [{ job_id: JOB, model_id: PRIVATE }], next: null });
    if (name === 'model_catalog') return Response.json([privateRow]);
    if (name === 'assets') return Response.json([]);
    return Response.json({ ok: true });
  });
  const headers = { 'x-veyrnox-auth-id': AUTH };
  const params = { params: Promise.resolve({ id: JOB }) };
  const responses = [
    await jobsGet(new Request('https://veyrnox.test/api/v1/jobs', { headers })),
    await jobGet(new Request(`https://veyrnox.test/api/v1/jobs/${JOB}`, { headers }), params),
    await provenanceGet(new Request(`https://veyrnox.test/api/v1/jobs/${JOB}/provenance`, { headers }), params),
    await appealsGet(new Request('https://veyrnox.test/api/v1/appeals', { headers })),
    await exportGet(new Request(`https://veyrnox.test/api/v1/account/export/${JOB}?section=creations`, { headers }), { params: Promise.resolve({ exportId: JOB }) }),
  ];
  for (const res of responses) {
    const text = await res.text();
    assert.equal(res.status, 200, text);
    assert.doesNotMatch(text, /swap-crun|swap-a3/);
    assert.match(text, /kling-o1-reference/);
  }
});

test('the private row is in no public list and its id is in no client bundle source', () => {
  const rows = [{ ...privateRow, updated_at: null }, { ...catalog[0], name: 'Kling O1 · Reference', updated_at: null }];
  assert.deepEqual(toPublicModels(rows).map(m => m.id), [PUBLIC]);
  assert.deepEqual(normalizeCachedModels([{ id: PRIVATE }, { id: PUBLIC }]).map(m => m.id), [PUBLIC]);
  assert.equal(capabilityFor(ENDPOINT).provider, 'crun');
  const walk = dir => readdirSync(dir).flatMap(name => {
    const path = join(dir, name);
    if (name === 'node_modules') return [];
    return statSync(path).isDirectory() ? walk(path) : /\.(js|jsx|mjs|ts|tsx|json)$/.test(name) ? [path] : [];
  });
  const clientFiles = [...walk('app/veyrnox'), ...walk('apps/mobile/src'), 'lib/publicModelIds.js', 'lib/jobState.js'];
  assert.ok(clientFiles.length > 100);
  for (const file of clientFiles) assert.ok(!readFileSync(file, 'utf8').includes(PRIVATE), `${file} names the private model`);
  assert.match(readFileSync('apps/mobile/src/lib/templateSwap/availability.ts', 'utf8'), /c\.model !== 'kling-o1-reference'/, 'the installed-app validator still expects the public offer');
});

test('migration 0579 records the owner exception, keeps the price and leaves the public offer alone', () => {
  const sql = readFileSync('packages/db/schema/supabase/0579_kling_o1_swap_crun.sql', 'utf8');
  const code = sql.split('\n').filter(line => !line.startsWith('--')).join('\n');
  assert.match(code, /'kling-o1-swap-crun', 'Kling O1 · Reference', 'crun', 'crun:kling\/o1-r2v', 'video-to-video', 47, 0\.4854/);
  assert.match(code, /OWNER EXCEPTION 2026-11-22: no prior direct probe; the first proof is a live website test/);
  assert.match(code, /ON CONFLICT \(id\) DO NOTHING/, 'a replay after rollback must not reactivate the row');
  assert.doesNotMatch(code, /UPDATE public\.|ledger_entries|credit_balances|model_route_reorder/);
  const adr = readFileSync('docs/adr/0351-swap-templates-on-kling-o1.md', 'utf8');
  assert.match(adr, /## Amendment 21 \(2026-11-22\)/);
  assert.match(adr, /SET active = false, updated_at = now\(\)\n\s+WHERE id = 'kling-o1-swap-crun' AND provider = 'crun';/);
  assert.ok(pin.length === 64);
});

test('the chat close answer never exposes the private swap model', async () => {
  const { closeAnswer } = await import('../lib/chatSendClose.js');
  const response = closeAnswer({ ok: true, closed: false, job_id: '11111111-1111-4111-8111-111111111111', state: 'SUBMITTED', model_id: 'kling-o1-swap-crun' });
  const body = await response.json();
  assert.equal(body.closed, false);
  if (body.model_id !== undefined) assert.equal(body.model_id, 'kling-o1-reference');
  assert.equal(JSON.stringify(body).includes('kling-o1-swap-crun'), false);
});

test('a swap admission conflict re-reads the stored job before answering', async () => {
  const { readFileSync } = await import('node:fs');
  const route = readFileSync(new URL('../app/api/v1/generations/route.js', import.meta.url), 'utf8');
  const conflict = route.indexOf("templateSwap && debit?.ok === false && debit.code === 'IDEMPOTENCY_CONFLICT'");
  assert.ok(conflict > 0);
  assert.ok(route.indexOf('replayTemplateSwapClip(authId, body, cfg', conflict) > conflict);
  assert.ok(conflict < route.indexOf("const debitCode = debit && debit.code"));
});
