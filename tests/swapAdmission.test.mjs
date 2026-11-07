import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { lipSyncMp4 } from './fixtures/lipSyncMp4.mjs';
import { estimatedCredits } from '../lib/generationEstimate.js';
register('data:text/javascript,' + encodeURIComponent(`export async function resolve(s,c,next) { return next(s === 'next/server' ? 'next/server.js' : s,c); }`));
Object.assign(process.env, {
  SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'test-service', FAL_KEY: 'test-fal',
  CRUN_ENABLED: 'true', CRUN_API_KEY: 'test-crun', PUBLIC_HOST: 'https://veyrnox.test',
  R2_ACCOUNT_ID: 'test', R2_ACCESS_KEY_ID: 'test', R2_SECRET_ACCESS_KEY: 'test', R2_BUCKET: 'test',
  FREE_ALLOWANCE_ENABLED: 'false', FAL_DURABLE_DISPATCH_ENABLED: 'false', FAL_DISPATCH_SCHEMA_ENABLED: 'false',
  SUPPLIER_ROUTES_ENABLED: 'false', MAX_CHARGE_ENABLED: 'false',
});
const { POST } = await import('../app/api/v1/generations/route.js');
const { GET } = await import('../app/api/catalog/route.js');
const AUTH = '11111111-1111-4111-8111-111111111111', JOB = '22222222-2222-4222-8222-222222222222';
const PHOTO = '33333333-3333-4333-8333-333333333333', VIDEO = '55555555-5555-4555-8555-555555555555';
const rows = [
  { id: 'swap-recast', name: 'Swap · Pro', provider: 'fal', provider_endpoint: 'fal-ai/minimax-h3-max-recast', credits_5s: 134 },
  { id: 'swap-quick', name: 'Swap · Quick', provider: 'crun', provider_endpoint: 'crun:wan/2-2-animate-replace', credits_5s: 67 },
].map(row => ({ ...row, modality: 'video-to-video', gated_flag: false, active: true }));
// Structural JPEG sufficient for the existing bounded metadata reader; never sent to a provider.
function jpeg(width = 640, height = 640) {
  const bytes = Buffer.from([255,216,255,192,0,17,8,0,0,0,0,3,1,17,0,2,17,0,3,17,0,255,217]);
  bytes.writeUInt16BE(height, 7); bytes.writeUInt16BE(width, 9); return bytes;
}
function mp4(seconds = 5, width = 640, height = 360, unknown = false) {
  const bytes = lipSyncMp4({ video: seconds, sampleCount: seconds * 25, handler: unknown ? 'meta' : 'vide' });
  const at = bytes.indexOf('tkhd'); bytes.writeUInt32BE(width * 65536, at + 80); bytes.writeUInt32BE(height * 65536, at + 84);
  return bytes;
}
function network(t, row, { clip = mp4(), photo = jpeg(), quicktime = false } = {}) {
  const calls = [], assets = {
    [PHOTO]: { bytes: photo, mime_type: 'image/jpeg', r2_key: `jobs/${PHOTO}/output.jpg` },
    [VIDEO]: { bytes: clip, mime_type: quicktime ? 'video/quicktime' : 'video/mp4', r2_key: `jobs/${VIDEO}/output.${quicktime ? 'mov' : 'mp4'}` },
  };
  t.mock.method(globalThis, 'fetch', async (target, init = {}) => {
    const url = new URL(String(target)), body = typeof init.body === 'string' ? JSON.parse(init.body) : null;
    const name = url.pathname.split('/').at(-1); calls.push({ name, body, url });
    if (url.pathname === '/rest/v1/model_catalog') {
      if (url.searchParams.get('active') === 'eq.true') return Response.json(row.active ? [row] : []);
      return Response.json([row]);
    }
    if (name === 'users') return Response.json([{ id: AUTH }]);
    if (name === 'jobs') return Response.json([]);
    if (url.pathname.includes('/rpc/')) {
      if (name === 'get_user_asset') {
        assert.equal(body.p_auth_id, AUTH);
        const { bytes: _bytes, ...asset } = assets[body.p_job_id];
        return Response.json({ ok: true, state: 'STORED', ...asset });
      }
      if (name === 'ledger_debit') return Response.json({ ok: true, job_id: JOB, balance_after: 500 });
      return Response.json({ ok: true });
    }
    if (url.hostname.endsWith('.r2.cloudflarestorage.com')) {
      const object = Object.values(assets).find(asset => url.pathname.endsWith(asset.r2_key)); assert.ok(object);
      const [, from, to] = /bytes=(\d+)-(\d+)/.exec(init.headers.Range);
      const start = Number(from), end = Math.min(Number(to), object.bytes.length - 1);
      return new Response(object.bytes.subarray(start, end + 1), { status: 206, headers: { 'content-type': object.mime_type, 'content-range': `bytes ${start}-${end}/${object.bytes.length}` } });
    }
    if (url.hostname === 'queue.fal.run') return Response.json({ request_id: 'swap-test-task' });
    if (url.hostname === 'api.crun.ai') return Response.json({ code: 200, data: { task_id: 'swap-test-task' } });
    throw new Error(`Unexpected network request: ${url.hostname}${url.pathname}`);
  });
  return { calls, debit: () => calls.filter(c => c.name === 'ledger_debit'), submits: () => calls.filter(c => ['queue.fal.run', 'api.crun.ai'].includes(c.url.hostname)) };
}
function post(row, inputs = {}) {
  return POST(new Request('https://veyrnox.test/api/v1/generations', { method: 'POST', headers: { 'x-veyrnox-auth-id': AUTH, 'content-type': 'application/json' }, body: JSON.stringify({
    model_id: row.id, idempotency_key: 'swap-proof-test', consent: true, inputs,
    source_assets: [{ asset_id: VIDEO, slot: 'video' }, { asset_id: PHOTO, slot: 'image' }],
  }) }));
}
for (const row of rows) {
  for (const seconds of [undefined, 5, 10]) for (const sourceSeconds of [row.id === 'swap-recast' ? 5 : 2, 10]) {
    test(`${row.id}: source ${sourceSeconds}s, caller duration ${seconds} never underpays`, async t => {
      const net = network(t, row, { clip: mp4(sourceSeconds) });
      const res = await post(row, seconds === undefined ? {} : { duration_seconds: seconds });
      const body = await res.json();
      const estimate = estimatedCredits({ credits: row.credits_5s, modality: row.modality, durations: [5] }, seconds);
      if (seconds === 10) {
        assert.equal(res.status, 400); assert.equal(body.error, 'duration_not_supported');
        assert.equal(estimate, null); assert.equal(net.debit().length, 0); assert.equal(net.submits().length, 0);
      } else {
        assert.equal(res.status, 200, JSON.stringify(body));
        assert.equal(net.debit().length, 1); assert.equal(net.debit()[0].body.p_credits, row.credits_5s);
        assert.equal(estimate, row.credits_5s); assert.equal(net.submits().length, 1);
        const payload = net.submits()[0].body;
        assert.equal(payload.duration, undefined); assert.equal(payload.input?.duration, undefined);
        if (row.provider === 'fal') { assert.equal(payload.enable_safety_checker, true); assert.equal(payload.resolution, '768P'); }
        else { assert.equal(payload.input.resolution, '720P'); assert.equal(payload.callback_url, undefined); }
      }
    });
  }
  for (const [label, options, error] of [
    ['short', { clip: mp4(1) }, 'source_too_short'],
    ['unknown length', { clip: mp4(5, 640, 360, true) }, 'source_length_unknown'],
    ['QuickTime', { quicktime: true }, 'source_type_unsupported'],
    ['too long', { clip: mp4(11) }, 'source_too_long'],
    ...(row.provider === 'crun' ? [
      ['small photo', { photo: jpeg(199, 640) }, 'source_resolution_out_of_range'],
      ['large photo', { photo: jpeg(640, 4097) }, 'source_resolution_out_of_range'],
      ['small video', { clip: mp4(5, 199, 360) }, 'source_resolution_out_of_range'],
      ['large video', { clip: mp4(5, 640, 2049) }, 'source_resolution_out_of_range'],
    ] : []),
  ]) test(`${row.id} refuses ${label} before debit and dispatch`, async t => {
    const net = network(t, row, options), res = await post(row), body = await res.json();
    assert.equal(res.status, 400, JSON.stringify(body)); assert.equal(body.error, error);
    assert.equal(net.debit().length, 0); assert.equal(net.submits().length, 0);
  });
  test(`${row.id} inactive row is excluded from catalog and cannot be bought`, async t => {
    const inactive = { ...row, active: false }, net = network(t, inactive);
    assert.deepEqual((await (await GET()).json()).models, []);
    const res = await post(inactive); assert.equal(res.status, 404);
    assert.equal(net.debit().length, 0); assert.equal(net.submits().length, 0);
  });
  for (const key of ['enable_safety_checker', 'resolution', 'callback_url', 'unknown']) test(`${row.id} refuses caller ${key}`, async t => {
    const net = network(t, row), res = await post(row, { [key]: false });
    assert.equal(res.status, 400); assert.equal(net.debit().length, 0); assert.equal(net.submits().length, 0);
  });
}
