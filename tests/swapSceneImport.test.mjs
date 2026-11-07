import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, copyFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { register } from 'node:module';
import { decision, syntheticClip } from './fixtures/swapSceneImport.mjs';
import { catalog } from './fixtures/swapScenes.mjs';
import { REPO, MAX_BYTES, downloadClip, boundedBytes, validateBounds, validateDecision, importScenes,
  measure, outsideRepo, renderRegistry, cli } from '../scripts/import-swap-scenes.mjs';
import { swapSceneAvailable } from '../lib/swapSceneGate.js';

const temp = await mkdtemp(path.join(tmpdir(), 'swap-import-proof-'));
after(() => rm(temp, { recursive: true, force: true }));
const clip = path.join(temp, 'testsrc.mp4');
await syntheticClip(clip);
const quick = { ...decision, id: 'fixture-import-quick', swapOffer: 'swap-quick' };
const duo = { ...decision, id: 'fixture-import-duo', people: 2 };
const download = async (_url, target) => copyFile(clip, target);
const imported = await importScenes({ decisions: [decision, quick, duo, { approved: false, reason: 'PRIVATE' }], download, outDir: temp });
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const cfg = { accountId: 'mock', accessKeyId: 'mock', secretAccessKey: 'mock', bucket: 'mock-bucket' };
function memoryStorage() {
  const objects = new Map(), puts = [];
  return { objects, puts,
    async putObject(key, bytes, type, config, options) {
      assert.equal(config, cfg); assert.equal(type, 'video/mp4'); assert.deepEqual(options, { onlyIfAbsent: true });
      puts.push(key);
      if (objects.has(key)) return { ok: false, status: 412 };
      objects.set(key, Buffer.from(bytes)); return { ok: true };
    },
    async getObject(key) { return { ok: true, response: new Response(objects.get(key)) }; },
  };
}

test('real normalisation yields private, bounded H.264 clips and matching audit/manifest facts', async () => {
  assert.equal(imported.scenes.length, 3);
  assert.equal(imported.report.publishable, false);
  const audit = JSON.parse(await readFile(path.join(imported.revisionDir, 'docs/product/source-audit', `swap-scenes-${imported.report.decisionDate}.json`)));
  assert.deepEqual(audit, imported.audit);
  const original = await readFile(clip);
  for (const result of imported.report.results) {
    const source = imported.manifest[result.id], row = audit.find(r => r.id === result.id);
    const bytes = await readFile(result.file), metadata = await measure(result.file);
    assert.equal(hash(bytes), source.sha256); assert.equal(bytes.length, source.sizeBytes);
    assert.equal(hash(original), source.originalSha256); assert.equal(original.length, source.originalSizeBytes);
    for (const key of ['sha256', 'originalSha256', 'sizeBytes', 'originalSizeBytes', 'seconds', 'videoSeconds', 'width', 'height']) assert.equal(row[key], source[key]);
    assert.equal(source.version, source.sha256.slice(0, 12));
    assert.equal(source.key, `swap-scenes/${result.id}/${source.sha256}.mp4`);
    assert.equal(metadata.codec, 'h264'); assert.equal(metadata.audio, false);
    assert.equal(row.moderation, 'reviewed-by-eye'); assert.equal(row.ownerApproved, true);
    assert.equal(row.sourceRecordId, decision.sourceRecordId);
    assert.ok(metadata.seconds >= 5 && metadata.seconds <= 10);
    assert.ok(metadata.videoSeconds >= 5 && metadata.videoSeconds <= 10);
    assert.ok(Math.max(metadata.width, metadata.height) <= 1280);
    assert.equal(metadata.width % 2, 0); assert.equal(metadata.height % 2, 0);
  }
  assert.doesNotMatch(JSON.stringify(audit), /Studio movement|PRIVATE|sourceUrl|reason/);
  assert.deepEqual(imported.report.results.find(r => r.id === duo.id).flags, ['needs_multi_reference']);
  assert.equal(imported.scenes[0].credits, 134); assert.equal(imported.scenes[1].credits, 67);
  assert.equal(imported.scenes[0].model, 'Swap · Pro'); assert.equal(imported.scenes[1].model, 'Swap · Quick');
  assert.ok(imported.scenes.every(s => s.durationSeconds === 5 && s.category === 'YOUR PHOTO' && s.needs === 'Photo'));
});

test('approved decisions are validated before downloading, with no offer default or provider switch', async () => {
  for (const [override, error] of [[{ swapOffer: undefined }, 'swap_offer_required'], [{ swapOffer: 'swap-quick', people: 2 }, 'quick_requires_one_person'],
    [{ people: 3 }, 'unsupported_people'], [{ id: 123 }, 'invalid_scene_id'], [{ id: '../escape' }, 'invalid_scene_id']]) {
    await assert.rejects(importScenes({ decisions: [{ ...decision, ...override }], outDir: temp,
      download: () => assert.fail('download before validation') }), new RegExp(error));
  }
  await assert.rejects(importScenes({ decisions: [decision, decision], outDir: temp }), /duplicate_scene_id/);
  assert.deepEqual(validateDecision(duo), ['needs_multi_reference']);
});

test('offer bounds independently check header and video durations, including 4.9/10.1 and Quick side 199', () => {
  const base = { seconds: 5, videoSeconds: 5, width: 320, height: 240 };
  for (const offer of ['swap-recast', 'swap-quick']) for (const key of ['seconds', 'videoSeconds']) {
    assert.throws(() => validateBounds(offer, { ...base, [key]: 10.1 }), /source_too_long/);
    assert.throws(() => validateBounds(offer, { ...base, [key]: NaN }), /duration_unknown/);
    if (offer === 'swap-recast') assert.throws(() => validateBounds(offer, { ...base, [key]: 4.9 }), /too_short_for_pro/);
    else validateBounds(offer, { ...base, [key]: 4.9 });
    assert.throws(() => validateBounds(offer, { ...base, [key]: 1.9 }), /too_short/);
    for (const value of [offer === 'swap-recast' ? 5 : 2, 10]) validateBounds(offer, { ...base, [key]: value });
  }
  for (const side of ['width', 'height']) for (const value of [199, 2049]) {
    assert.throws(() => validateBounds('swap-quick', { ...base, [side]: value }), /source_resolution_out_of_range/);
  }
});

for (const seconds of [4, 4.9]) test(`${seconds}-second source is refused for Pro and valid for Quick; failures cannot upload a partial revision`, async () => {
  const short = path.join(temp, `short-${seconds}.mp4`); await syntheticClip(short, { seconds });
  const result = await importScenes({ decisions: [decision, quick], download: async (_, file) => copyFile(short, file), outDir: temp,
    dryRun: false, upload: true, r2: cfg, confirmBucket: cfg.bucket, storage: { putObject() { assert.fail('partial upload'); } } });
  assert.equal(result.report.results[0].error, 'too_short_for_pro');
  assert.equal(result.report.results[1].status, 'normalised');
  assert.deepEqual(result.scenes.map(s => s.swapOffer), ['swap-quick']);
  assert.equal(result.report.publishable, false);
});

test('real normaliser clips at t=0 to ten seconds, scales down evenly, and retains audio only on request', async () => {
  const long = path.join(temp, 'long.mp4'); await syntheticClip(long, { seconds: 11, width: 1290, height: 722 });
  const result = await importScenes({ decisions: [quick], download: async (_, file) => copyFile(long, file), outDir: temp });
  const source = result.manifest[quick.id];
  assert.equal(source.seconds, 10); assert.equal(source.videoSeconds, 10);
  assert.equal(source.width, 1280); assert.equal(source.height % 2, 0);
  const audio = await importScenes({ decisions: [quick], download, outDir: temp, keepAudio: true });
  assert.equal((await measure(audio.report.results[0].file)).audio, true);
});

test('downloader rejects protocols, hosts, redirects, MIME, non-MP4 bytes, and declared/streamed overflow', async () => {
  for (const url of ['http://d2ol7oe51mr4n9.cloudfront.net/a.mp4', 'https://evil.test/a.mp4',
    'https://d2ol7oe51mr4n9.cloudfront.net/a.mov', 'https://x@d2ol7oe51mr4n9.cloudfront.net/a.mp4',
    'https://d2ol7oe51mr4n9.cloudfront.net:444/a.mp4']) {
    await assert.rejects(downloadClip(url, path.join(temp, 'never.mp4'), () => assert.fail('network')));
  }
  for (const [response, error] of [
    [new Response(null, { status: 302, headers: { location: 'https://evil.test/a.mp4' } }), 'source_redirect_refused'],
    [new Response('bad', { headers: { 'content-type': 'video/quicktime' } }), 'source_not_mp4'],
    [new Response('bad', { headers: { 'content-type': 'video/mp4' } }), 'source_not_mp4'],
    [new Response('small', { headers: { 'content-type': 'video/mp4', 'content-length': String(MAX_BYTES + 1) } }), 'source_over_cap'],
  ]) await assert.rejects(downloadClip(decision.sourceUrl, path.join(temp, 'never.mp4'), async (_, init) => {
    assert.equal(init.redirect, 'manual'); return response;
  }), new RegExp(error));
  // Same streaming path, small cap avoids allocating a 100 MB test object.
  await assert.rejects(boundedBytes(new Response('12345'), 4), /source_over_cap/);
  const saved = path.join(temp, 'downloaded.mp4');
  await downloadClip(decision.sourceUrl, saved, async () => new Response(await readFile(clip), { headers: { 'content-type': 'video/mp4' } }));
  assert.deepEqual(await readFile(saved), await readFile(clip));
  const invalid = await importScenes({ decisions: [decision], outDir: temp, download: (_, file) => writeFile(file, 'not a video') });
  assert.equal(invalid.report.results[0].error, 'source_not_mp4');
});

test('generated entries obey the existing publication and multi-reference gates', () => {
  for (const scene of imported.scenes) {
    const opts = { scenes: imported.scenes, manifest: imported.manifest, catalog,
      env: { APP_ENV: 'staging', MULTI_REFERENCE_ENABLED: 'true' } };
    assert.equal(swapSceneAvailable(scene.id, opts), true);
    for (const override of [{ env: { APP_ENV: 'production' } }, { manifest: {} },
      { catalog: catalog.map(row => ({ ...row, active: false })) }, { catalog: catalog.map(row => ({ ...row, gated_flag: true })) }]) {
      assert.equal(swapSceneAvailable(scene.id, { ...opts, ...override }), false);
    }
    assert.equal(swapSceneAvailable(scene.id, { ...opts, env: { APP_ENV: 'staging', MULTI_REFERENCE_ENABLED: 'false' } }), scene.people === 1);
  }
});

test('content-addressed re-import never overwrites: conditional puts, same-hash no-op, full read-back required', async () => {
  const storage = memoryStorage();
  const options = { decisions: [decision], download, outDir: temp, dryRun: false, upload: true, confirmBucket: cfg.bucket, r2: cfg, storage };
  const first = await importScenes(options), again = await importScenes(options);
  assert.equal(first.report.publishable, true); assert.equal(again.report.publishable, true);
  assert.equal(again.report.results[0].status, 'already_present_verified');
  assert.equal(first.manifest[decision.id].key, again.manifest[decision.id].key);
  const changed = path.join(temp, 'changed.mp4'); await syntheticClip(changed, { changed: true });
  const next = await importScenes({ ...options, download: async (_, file) => copyFile(changed, file) });
  assert.notEqual(first.manifest[decision.id].key, next.manifest[decision.id].key);
  assert.notEqual(first.manifest[decision.id].version, next.manifest[decision.id].version);
  assert.equal(storage.objects.size, 2); assert.equal(storage.puts.length, 3);
  storage.objects.set(first.manifest[decision.id].key, Buffer.from('different bytes'));
  await assert.rejects(importScenes(options), /r2_hash_mismatch/);
  await assert.rejects(importScenes({ ...options, storage: { ...storage, getObject: async () => ({ ok: false }) } }), /r2_readback_failed/);
  await assert.rejects(importScenes({ ...options, storage: { putObject: async () => ({ ok: false, status: 500 }) } }), /r2_put_failed/);
});

test('upload needs explicit mode, caller credentials and matching bucket; dry-run never touches storage', async () => {
  for (const override of [{ dryRun: false }, { upload: true },
    { dryRun: false, upload: true, r2: {} }, { dryRun: false, upload: true, r2: cfg, confirmBucket: 'wrong' }]) {
    await assert.rejects(importScenes({ decisions: [], outDir: temp, ...override }), /explicit_upload_required|confirmed_r2_bucket_required/);
  }
  await importScenes({ decisions: [decision], outDir: temp, download,
    storage: { putObject() { assert.fail('dry-run upload'); }, getObject() { assert.fail('dry-run GET'); } } });
});

test('empty decisions preserve shipped registries; generated blocks preserve surrounding source and stay below 500 lines', async () => {
  const result = await importScenes({ decisions: [], outDir: temp });
  for (const [relative, name, values] of [['app/veyrnox/_lib/swapScenes.js', 'SWAP_SCENES', imported.scenes],
    ['lib/swapSceneSources.js', 'SWAP_SCENE_SOURCES', imported.manifest]]) {
    const original = await readFile(path.join(REPO, relative), 'utf8');
    assert.equal(await readFile(path.join(result.revisionDir, relative), 'utf8'), original);
    const generated = await readFile(path.join(imported.revisionDir, relative), 'utf8');
    assert.ok(generated.includes(`// BEGIN GENERATED ${name}`));
    assert.equal(renderRegistry(generated, name, values), generated);
    const many = Array.isArray(values) ? Array.from({ length: 35 }, (_, i) => ({ ...values[0], id: `test-${i}` }))
      : Object.fromEntries(Array.from({ length: 35 }, (_, i) => [`test-${i}`, Object.values(values)[0]]));
    assert.ok(renderRegistry(original, name, many).split('\n').length < 500);
  }
  assert.deepEqual(result.audit, []);
  assert.deepEqual(JSON.parse(await readFile(path.join(REPO, 'docs/product/source-audit/swap-scenes-2026-11-07.json'))), []);
});

test('CLI reads only external decisions, defaults dry-run, rejects repo output including symlinks; no tracked media', async t => {
  const decisions = path.join(temp, 'decisions.json'); await writeFile(decisions, '[]');
  t.mock.method(console, 'log', () => {});
  const result = await cli(['--decisions', decisions, '--out-dir', temp]);
  assert.equal(result.report.dryRun, true); assert.equal(result.report.publishable, false);
  await assert.rejects(cli(['--decisions', path.join(REPO, 'package.json')]), /path_inside_repo/);
  await assert.rejects(cli(['--decisions', decisions, '--upload', '--dry-run']), /conflicting_modes/);
  await assert.rejects(importScenes({ decisions: [], outDir: path.join(REPO, 'tmp-scenes') }), /path_inside_repo/);
  const link = path.join(temp, 'checkout'); await symlink(REPO, link);
  await assert.rejects(outsideRepo(path.join(link, 'nested', 'clips')), /path_inside_repo/);
  const tracked = execFileSync('git', ['ls-files'], { cwd: REPO, encoding: 'utf8' });
  assert.equal(tracked.split('\n').filter(file => /swap[-/]?scenes/i.test(file) && /\.mp4$/i.test(file)).length, 0);
});

// Use generated data at the real route boundary. Signing and every transport are
// mocked; request builders, source admission and persisted inputs remain real.
register('data:text/javascript,' + encodeURIComponent(`
export async function resolve(s,c,next) {
 const result = await next(s === 'next/server' ? 'next/server.js' : s,c);
 if (['/lib/swapSceneGate.js', '/lib/swapSceneSources.js', '/app/veyrnox/_lib/swapScenes.js', '/packages/adapters/r2.js'].some(p => result.url.endsWith(p))) return { ...result, url: result.url + '?importProof' };
 return result;
}
export async function load(url,c,next) {
 const result = await next(url,c);
 url = url.split('?')[0];
 if (url.endsWith('/app/veyrnox/_lib/swapScenes.js')) return { ...result, source: String(result.source).replace('Object.freeze([])', ${JSON.stringify(JSON.stringify(imported.scenes))}) };
 if (url.endsWith('/lib/swapSceneSources.js')) return { ...result, source: String(result.source).replace('Object.freeze({})', ${JSON.stringify(JSON.stringify(imported.manifest))}) };
 if (url.endsWith('/packages/adapters/r2.js')) return { ...result, source: String(result.source).replace('export async function presignGetUrl(', 'async function realPresignGetUrl(') + '\\nexport async function presignGetUrl(key, seconds) { if (seconds !== 900) throw Error("ttl"); return {url: "https://signed.test/" + key}; }' };
 return result;
}`));
Object.assign(process.env, {
  APP_ENV: 'staging', SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'mock', FAL_KEY: 'mock',
  CRUN_ENABLED: 'true', CRUN_API_KEY: 'mock', PUBLIC_HOST: 'https://veyrnox.test',
  R2_ACCOUNT_ID: 'mock', R2_ACCESS_KEY_ID: 'mock', R2_SECRET_ACCESS_KEY: 'mock', R2_BUCKET: 'mock',
  FREE_ALLOWANCE_ENABLED: 'false', FAL_DURABLE_DISPATCH_ENABLED: 'false', FAL_DISPATCH_SCHEMA_ENABLED: 'false',
  SUPPLIER_ROUTES_ENABLED: 'false', MAX_CHARGE_ENABLED: 'false', MULTI_REFERENCE_ENABLED: 'false',
});
const { POST } = await import('../app/api/v1/generations/route.js');
const AUTH = '11111111-1111-4111-8111-111111111111', PHOTO = '33333333-3333-4333-8333-333333333333';
const jpeg = Buffer.from([255,216,255,192,0,17,8,2,128,2,128,3,1,17,0,2,17,0,3,17,0,255,217]);
for (const scene of [decision, quick, duo]) test(`no-cost route payload and job provenance: ${scene.swapOffer}, ${scene.people} people`, async t => {
  const submits = [], jobs = [];
  t.mock.method(globalThis, 'fetch', async (target, init = {}) => {
    const url = new URL(String(target)), name = url.pathname.split('/').at(-1);
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : null;
    if (name === 'model_catalog') return Response.json(catalog.filter(row => `eq.${row.id}` === url.searchParams.get('id')));
    if (name === 'users') return Response.json([{ id: AUTH }]);
    if (name === 'jobs') return Response.json([]);
    if (url.pathname.includes('/rpc/')) {
      if (name === 'get_user_asset') return Response.json({ ok: true, state: 'STORED', mime_type: 'image/jpeg', r2_key: `jobs/${PHOTO}/output.jpg` });
      if (name === 'ledger_debit') { jobs.push(body.p_inputs); return Response.json({ ok: true, job_id: AUTH, balance_after: 500 }); }
      return Response.json({ ok: true });
    }
    if (url.hostname === 'signed.test') {
      assert.equal(url.pathname, `/jobs/${PHOTO}/output.jpg`);
      const [, a, b] = /bytes=(\d+)-(\d+)/.exec(init.headers.Range);
      const start = Number(a), end = Math.min(Number(b), jpeg.length - 1);
      return new Response(jpeg.subarray(start, end + 1), { status: 206, headers: {
        'content-type': 'image/jpeg', 'content-range': `bytes ${start}-${end}/${jpeg.length}` } });
    }
    if (['queue.fal.run', 'api.crun.ai'].includes(url.hostname)) {
      submits.push(body); return Response.json(url.hostname === 'queue.fal.run' ? { request_id: 'mock-task' } : { code: 200, data: { task_id: 'mock-task' } });
    }
    assert.fail(`unexpected network ${url.hostname}${url.pathname}`);
  });
  const references = Array.from({ length: scene.people }, () => ({ slot: 'image', origin: 'asset', asset_id: PHOTO }));
  const post = extra => POST(new Request('https://veyrnox.test/api/v1/generations', { method: 'POST',
    headers: { 'x-veyrnox-auth-id': AUTH }, body: JSON.stringify({ model_id: scene.swapOffer, swap: scene.id,
      inputs: {}, consent: true, references, idempotency_key: 'import-proof-key', ...extra }) }));
  const response = await post();
  assert.equal(response.status, scene.people === 2 ? 404 : 200, JSON.stringify(await response.json()));
  if (scene.people === 2) { assert.equal(jobs.length, 0); assert.equal(submits.length, 0); return; }
  const source = imported.manifest[scene.id], payload = submits[0].input || submits[0];
  assert.equal(payload.video_url || payload.video_urls?.[0], `https://signed.test/${source.key}`);
  assert.deepEqual(payload.reference_image_urls || payload.img_urls, [`https://signed.test/jobs/${PHOTO}/output.jpg`]);
  assert.deepEqual(jobs[0].template_source, { scene: scene.id, version: source.version, sha256: source.sha256 });
  assert.deepEqual(jobs[0].references, references);
  assert.doesNotMatch(JSON.stringify(jobs[0]), /https:|swap-scenes\//);
  for (const extra of [{ video_url: 'https://caller.test/x.mp4' }, { inputs: { video_url: 'https://caller.test/x.mp4' } }]) {
    assert.equal((await (await post(extra)).json()).error, 'swap_video_not_allowed');
  }
  assert.equal(submits.length, 1);
});
