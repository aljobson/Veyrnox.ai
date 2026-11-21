import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, mkdir, symlink, rm, access, copyFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { importTemplateSwapClips, cli, swapCandidates, tierFor, reviewFingerprint } from '../scripts/import-template-swap-clips.mjs';
import { outsideRepositories, normaliseSwapClip, validateSwapMedia } from '../scripts/lib/swap-clip-normalise.mjs';
import { measure } from '../scripts/import-swap-scenes.mjs';
import { sha256Hex } from '../packages/adapters/r2.js';
import { TEMPLATE_CLIPS } from '../app/veyrnox/_lib/templateClips.js';
const id = 'community-action-hero-strut'; // The importer reads this clip's source prompt, so it keeps its own fixture id.
const decision = { id, approved: true };
const temp = () => mkdtemp(path.join(tmpdir(), 'swap-clip-proof-'));
function synthetic(file, seconds = 5, fps = 12, dimensions = '480x854') {
 execFileSync('ffmpeg', ['-v','error','-f','lavfi','-i',`color=c=blue:s=${dimensions}:r=${fps}`,
  '-f','lavfi','-i','sine=frequency=440', '-t',String(seconds),'-c:v','libx264','-threads','2','-pix_fmt','yuv420p','-c:a','aac',file]);
}
test('all checkout boundaries and symlink ancestors are refused before decisions reads', async () => {
 const common = execFileSync('git', ['rev-parse','--git-common-dir'], { encoding: 'utf8' }).trim();
 const main = path.dirname(path.resolve(common));
 const worktrees = execFileSync('git',['worktree','list','--porcelain'],{encoding:'utf8'}).split('\n').filter(s=>s.startsWith('worktree ')).map(s=>s.slice(9));
 for (const root of [process.cwd(), main, ...worktrees]) {
  await assert.rejects(outsideRepositories(path.join(root, 'review', 'new')), /path_inside_repo/);
  await assert.rejects(cli(['--out-dir', path.join(root,'review'), '--decisions','/nonexistent-private-decisions.json']), /path_inside_repo/);
 }
 const dir = await temp();
 try {
  await symlink(main, path.join(dir,'link'));
  await assert.rejects(outsideRepositories(path.join(dir,'link','new','report.json')), /path_inside_repo/);
  await assert.rejects(importTemplateSwapClips({ decisions: [], outDir: path.join(dir,'link','new') }), /path_inside_repo/);
 } finally { await rm(dir,{recursive:true,force:true}); }
});
test('normalisation requires explicit upscale, keeps even sides, trims to ten, removes audio and clamps fps', async () => {
 const dir = await temp();
 try {
  const input = path.join(dir,'input.mp4'); synthetic(input, 11);
  await assert.rejects(normaliseSwapClip(input,path.join(dir,'refused.mp4')), /source_resolution_too_small/);
  const output = path.join(dir,'normalised.mp4');
  const media = await normaliseSwapClip(input,output,{upscale:true});
  assert.equal(media.width,720); assert.equal(media.height,1282);
  assert.equal(media.seconds,5); assert.equal(media.videoSeconds,5);
  assert.equal(media.audio,false); assert.equal(media.codec,'h264'); assert.equal(media.frameRate,24);
  for (const field of ['seconds','videoSeconds']) {
   assert.doesNotThrow(()=>validateSwapMedia({...media,[field]:5.05}));
   assert.throws(()=>validateSwapMedia({...media,[field]:5.06}), /too_large/);
   assert.throws(()=>validateSwapMedia({...media,[field]:2.99}), /too_short/);
  }
  const fast = path.join(dir,'fast.mp4'); synthetic(fast,3,72,'720x720');
  const clamped = await normaliseSwapClip(fast,path.join(dir,'clamped.mp4'));
  assert.equal(clamped.frameRate,60);
 } finally { await rm(dir,{recursive:true,force:true}); }
});
test('local-only review pack, approved-only processing, hash checks and conditional verified upload', async t => {
 t.mock.method(globalThis,'fetch',()=>assert.fail('network is forbidden'));
 const dir = await temp();
 try {
  const showcaseDir = path.join(dir,'showcase'); await mkdir(showcaseDir);
  const file = path.join(showcaseDir,TEMPLATE_CLIPS.find(c=>c.id===id).previewFile); synthetic(file);
  const sha = await sha256Hex(await readFile(file));
  const records = [{ id, sourceMainMediaUrl: 'https://never-fetch.invalid/result.mp4', localPreviewSha256: sha }];
  const base = { decisions: [decision], outDir: dir, showcaseDir, records, upscale:true };
  const dry = await importTemplateSwapClips(base);
  assert.equal(dry.report.publishable,false); assert.equal(dry.report.results.find(r=>r.id===id).verification,'audit_hash');
  assert.equal(dry.report.results.find(r=>r.id===id).outcome,'ok_for_review');
  assert.equal(dry.manifest[id].seconds,5);
  await access(path.join(dry.runDir,'sheets',id+'.jpg')); await access(path.join(dry.runDir,'index-1.jpg'));
  const decisions = JSON.parse(await readFile(path.join(dry.runDir,'decisions-template.json')));
  assert.equal(decisions.length,(await swapCandidates()).length); assert.ok(decisions.every(d=>d.approved===false));
  assert.equal((await measure(path.join(dry.runDir,'clips',id+'.mp4'))).audio,false);
  await assert.rejects(access(path.join(dry.runDir,'publishable')));
  const bad = await importTemplateSwapClips({...base, records:[{...records[0],localPreviewSha256:'b'.repeat(64)}]});
  assert.equal(bad.report.results.find(r=>r.id===id).outcome,'showcase_hash_mismatch'); assert.deepEqual(bad.manifest,{});
  const ignored = await importTemplateSwapClips({...base,decisions:[{id,approved:false}],showcaseDir:'/does-not-exist'});
  assert.deepEqual(ignored.manifest,{});
  for (const decisions of [[decision,decision],[decision,{id:'unknown',approved:false}]]) await assert.rejects(importTemplateSwapClips({...base,decisions}), /duplicate_template_id|unknown_template_swap/);
  const reviewedDecisions = [{ ...decisions.find(d => d.id === id), approved: true }];
  assert.equal(reviewedDecisions[0].role, dry.manifest[id].role);
  assert.equal(reviewedDecisions[0].reviewFingerprint, await reviewFingerprint(dry.manifest[id].sha256, dry.manifest[id].role));
  const r2 = {accountId:'mock',accessKeyId:'mock',secretAccessKey:'mock',bucket:'mock'}, objects = new Map();
  const storage = {
   async putObject(key,bytes,type,cfg,options) { assert.deepEqual(options,{onlyIfAbsent:true}); assert.equal(type, key.endsWith('.json') ? 'application/json' : 'video/mp4'); assert.equal(cfg,r2); if(objects.has(key)) return {ok:false,status:412}; objects.set(key,bytes); return {ok:true}; },
   async getObject(key) { return {ok:true,response:new Response(objects.get(key))}; },
  };
  for (let i=0;i<2;i++) {
   const uploaded = await importTemplateSwapClips({...base,decisions:reviewedDecisions,upload:true,confirmBucket:'mock',r2,storage});
   assert.equal(uploaded.report.publishable,true);
   const published = path.join(uploaded.runDir,'publishable');
   await assert.rejects(access(path.join(published,'templateSwapClipSources.js')));
   const bytes = await readFile(path.join(published,'manifest.json'));
   const hash = await sha256Hex(bytes), key = `template-swap-clips/manifests/${hash}.json`;
   assert.deepEqual(Buffer.from(objects.get(key)), bytes);
   assert.deepEqual(JSON.parse(bytes), { version: 1, clips: uploaded.manifest });
   const registry = await readFile(path.join(published,'templateSwapClips.js'), 'utf8');
   assert.ok(registry.includes(hash)); assert.ok(registry.includes(id));
   assert.ok(!registry.includes(uploaded.manifest[id].key)); assert.ok(!registry.includes(uploaded.manifest[id].sha256));
   assert.equal([...objects.keys()].at(-1), key);

  }
  assert.equal(objects.size,2);
  for (const patch of [{ role: undefined }, { role: 'the other character' }, { reviewFingerprint: 'f'.repeat(64) }, { sha256: 'f'.repeat(64) }]) {
   await assert.rejects(importTemplateSwapClips({ ...base, decisions: [{ ...reviewedDecisions[0], ...patch }], upload: true, confirmBucket: 'mock', r2,
    storage: { putObject: () => assert.fail('unreviewed role must never upload'), getObject: () => assert.fail('unreviewed role must never read back') } }), /reviewed_role_mismatch/);
  }
  const override = await importTemplateSwapClips({ ...base, decisions: [{ ...decision, role: '  The CAR  ' }] });
  assert.equal(override.manifest[id].role, 'the car');
  const overrideRow = override.report.results.find(r => r.id === id);
  assert.equal(overrideRow.object_role_suspected, true);
  assert.deepEqual(overrideRow.roles, [{ slot: 1, role: 'the main character' }]);
  assert.equal(overrideRow.reviewFingerprint, await reviewFingerprint(override.manifest[id].sha256, 'the car'));
  assert.notEqual(overrideRow.reviewFingerprint, reviewedDecisions[0].reviewFingerprint);
  await assert.rejects(importTemplateSwapClips({ ...base, decisions: [{ ...decision, role: '@Element2' }] }), /template_swap_role_invalid/);
  for (const failure of ['put', 'readback']) {
   let failedRun;
   await assert.rejects(importTemplateSwapClips({...base,decisions:reviewedDecisions,upload:true,confirmBucket:'mock',r2,storage:{
    ...storage,
    putObject: async (...args) => args[0].endsWith('.json') && failure === 'put' ? {ok:false} : storage.putObject(...args),
    getObject: async key => key.endsWith('.json') && failure === 'readback' ? {ok:true,response:new Response('bad')} : storage.getObject(key),
   }}), error => { failedRun = error.runDir; return /manifest_put_failed|manifest_hash_mismatch/.test(error.message); });
   await assert.rejects(access(path.join(failedRun,'publishable')));
  }
  await assert.rejects(importTemplateSwapClips({...base,upload:true,confirmBucket:'mock',r2,storage}), /reviewed_role_mismatch/);
  await assert.rejects(importTemplateSwapClips({...base,decisions:[{...decision,sha256:'c'.repeat(64)}],upload:true,confirmBucket:'mock',r2,storage}), /reviewed_role_mismatch/);
  // A five-plus-slot candidate remains in the all-approved invariant, even when unavailable.
  await assert.rejects(importTemplateSwapClips({ ...base, decisions: [...reviewedDecisions, { id: 'freestyle', approved: true }], upload: true, confirmBucket: 'mock', r2,
   storage: { putObject: () => assert.fail('partial approved set must never upload') } }), /approved_candidates_failed/);
  await copyFile(file, path.join(showcaseDir, TEMPLATE_CLIPS.find(c => c.id === 'freestyle').previewFile));
  const manySlots = await importTemplateSwapClips({ ...base, decisions: [{ id: 'freestyle', approved: true }] });
  assert.ok(manySlots.manifest.freestyle.role);
  assert.equal(manySlots.report.results.find(r => r.id === 'freestyle').roles.length, 7);
  // Every approved clip failing is an error, not a quiet success; zero approved is refused too.
  await assert.rejects(importTemplateSwapClips({...base,decisions:reviewedDecisions,records:[{...records[0],localPreviewSha256:'b'.repeat(64)}],upload:true,confirmBucket:'mock',r2,storage}), /approved_candidates_failed/);
  await assert.rejects(importTemplateSwapClips({...base,decisions:[{id,approved:false}],upload:true,confirmBucket:'mock',r2,storage}), /approved_candidates_failed/);
  await assert.rejects(importTemplateSwapClips({...base,reviewAll:true,upload:true,confirmBucket:'mock',r2,storage}), /review_all_not_with_upload/);
  const unapproved = await importTemplateSwapClips({...base,decisions:[{id,approved:false}],reviewAll:true});
  assert.equal(unapproved.report.results.find(r=>r.id===id).outcome,'ok_for_review'); assert.equal(unapproved.report.results.find(r=>r.id===id).approved,false);
  await access(path.join(unapproved.runDir,'sheets',id+'.jpg'));
  assert.equal(JSON.parse(await readFile(path.join(unapproved.runDir,'decisions-template.json'))).find(d=>d.id===id).sha256,dry.manifest[id].sha256);
  await assert.rejects(importTemplateSwapClips({...base,upload:true,confirmBucket:'wrong',r2,storage}), /confirmed_r2_bucket_required/);
  await assert.rejects(importTemplateSwapClips({...base,decisions:reviewedDecisions,upload:true,confirmBucket:'mock',r2,storage:{...storage,getObject:async()=>({ok:true,response:new Response('corrupt')})}}), /r2_hash_mismatch|source_over_cap/);
  await rm(file); await symlink(path.join(dir,'outside.mp4'),file); await writeFile(path.join(dir,'outside.mp4'),'x');
  const escape = await importTemplateSwapClips(base);
  assert.equal(escape.report.results.find(r=>r.id===id).reason,'source_path_not_allowed');
 } finally { await rm(dir,{recursive:true,force:true}); }
});

test('registry rendering replaces an empty or already populated list and rejects a malformed file', async () => {
  const { renderSwapRegistry } = await import('../scripts/import-template-swap-clips.mjs');
  const empty = "export const TEMPLATE_SWAP_CLIPS = Object.freeze([]);\nexport const TEMPLATE_SWAP_CLIP_MANIFEST_SHA256 = '';\n";
  const first = renderSwapRegistry(empty, ['a-one'], 'a'.repeat(64));
  assert.match(first, /Object\.freeze\(\["a-one"\]\)/);
  const second = renderSwapRegistry(first, ['a-two', 'a-three'], 'b'.repeat(64));
  assert.match(second, /Object\.freeze\(\["a-two","a-three"\]\)/); assert.doesNotMatch(second, /a-one/);
  assert.throws(() => renderSwapRegistry('export const X = 1;\n', ['a']), /registry_render_failed/);
});

test('every video template that needs a source clip is a candidate: swap, video-blocked swap and motion kinds', async () => {
  const all = await swapCandidates();
  const count = kind => all.filter(c => c.kind === kind).length;
  // Pinned so a guard or catalog change that widens or narrows the set shows up in review (hidden and Seedance-labelled templates included).
  assert.deepEqual([count('swap'), count('video_swap'), count('motion')], [132, 314, 78]);
  assert.equal(new Set(all.map(c => c.id)).size, all.length);
  assert.deepEqual((await swapCandidates({ kinds: ['motion'] })).length, 78);
  assert.deepEqual([tierFor('swap', 'audit_hash'), tierFor('swap', 'no_audit_record'), tierFor('video_swap', 'audit_hash'), tierFor('motion', 'no_audit_record')], ['A', 'B', 'C', 'D']);
});

test('verification by hash, by id, absent record, origin exclusion and poster similarity', async t => {
  t.mock.method(globalThis,'fetch',()=>assert.fail('network is forbidden'));
  const dir = await temp();
  try {
    const showcaseDir = path.join(dir,'showcase'); await mkdir(showcaseDir);
    const previewFile = TEMPLATE_CLIPS.find(c=>c.id===id).previewFile;
    synthetic(path.join(showcaseDir,previewFile));
    execFileSync('ffmpeg',['-v','error','-f','lavfi','-i','color=c=blue:s=480x854','-frames:v','1',path.join(showcaseDir,previewFile.replace(/\.mp4$/,'.jpg'))]);
    const sha = await sha256Hex(await readFile(path.join(showcaseDir,previewFile)));
    const run = records => importTemplateSwapClips({ decisions: [], outDir: dir, showcaseDir, records, upscale: true, reviewAll: true, kinds: ['swap'] });
    const row = report => report.results.find(r => r.id === id);
    const byHash = row((await run([{ id: 'some-renamed-id', localPreviewSha256: sha, origin: 'higgsfield' }])).report);
    assert.equal(byHash.verification, 'audit_hash'); assert.equal(byHash.tier, 'A'); assert.equal(byHash.origin, 'higgsfield');
    const none = row((await run([])).report);
    assert.equal(none.verification, 'no_audit_record'); assert.equal(none.tier, 'B'); assert.equal(none.outcome, 'ok_for_review');
    assert.ok(none.posterSimilarity === null || (none.posterSimilarity > 0.9 && none.posterSimilarity <= 1), String(none.posterSimilarity));
    const excluded = await run([{ id, localPreviewSha256: sha, origin: 'syntx' }]);
    assert.equal(row(excluded.report).outcome, 'origin_excluded'); assert.equal(excluded.manifest[id], undefined);
    // Seedance metadata must survive renamed/hash-only matches and duplicate audit hashes.
    for (const records of [
      [{ id: 'sm-brand-new-day', localPreviewSha256: sha, origin: 'seedance' }],
      [{ id: 'sm-brand-new-day', localPreviewSha256: sha, origin: 'seedance' }, { id: 'clean-last', localPreviewSha256: sha, origin: 'higgsfield' }],
      [{ id, localPreviewSha256: sha, origin: 'higgsfield' }, { id: 'other', localPreviewSha256: sha, sourcePlatform: 'Syntx', origin: 'seedance' }],
    ]) {
      const result = await run(records);
      assert.equal(row(result.report).outcome, 'origin_excluded');
      assert.equal(row(result.report).origin, 'syntx');
      assert.equal(result.manifest[id], undefined);
    }
    const allowed = await importTemplateSwapClips({ decisions: [], outDir: dir, showcaseDir, records: [{ id: 'sm-brand-new-day', localPreviewSha256: sha, origin: 'seedance' }], upscale: true, reviewAll: true, includeSyntx: true, kinds: ['swap'] });
    assert.equal(row(allowed.report).outcome, 'ok_for_review');
    const mismatch = row((await run([{ id, localPreviewSha256: 'b'.repeat(64), origin: 'higgsfield' }])).report);
    assert.equal(mismatch.outcome, 'showcase_hash_mismatch');
    assert.match(await readFile(path.join(allowed.runDir,'report.md'),'utf8'), /RESULT CLIP, NOT THE ORIGINAL INPUT/);
  } finally { await rm(dir,{recursive:true,force:true}); }
});
