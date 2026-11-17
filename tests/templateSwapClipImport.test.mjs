import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, mkdir, symlink, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { importTemplateSwapClips, cli } from '../scripts/import-template-swap-clips.mjs';
import { outsideRepositories, normaliseSwapClip, validateSwapMedia } from '../scripts/lib/swap-clip-normalise.mjs';
import { measure } from '../scripts/import-swap-scenes.mjs';
import { sha256Hex } from '../packages/adapters/r2.js';
import { TEMPLATE_CLIPS } from '../app/veyrnox/_lib/templateClips.js';
import { id } from './fixtures/templateSwapClips.mjs';
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
  assert.equal(dry.report.publishable,false); assert.equal(dry.report.results.find(r=>r.id===id).verification,'result_clip_not_original');
  assert.equal(dry.report.results.find(r=>r.id===id).outcome,'ok_for_review');
  assert.equal(dry.manifest[id].seconds,5);
  await access(path.join(dry.runDir,'sheets',id+'.jpg')); await access(path.join(dry.runDir,'index-1.jpg'));
  const decisions = JSON.parse(await readFile(path.join(dry.runDir,'decisions-template.json')));
  assert.equal(decisions.length,127); assert.ok(decisions.every(d=>d.approved===false));
  assert.equal((await measure(path.join(dry.runDir,'clips',id+'.mp4'))).audio,false);
  await assert.rejects(access(path.join(dry.runDir,'publishable')));
  const bad = await importTemplateSwapClips({...base, records:[{...records[0],localPreviewSha256:'b'.repeat(64)}]});
  assert.equal(bad.report.results.find(r=>r.id===id).outcome,'showcase_hash_mismatch'); assert.deepEqual(bad.manifest,{});
  const ignored = await importTemplateSwapClips({...base,decisions:[{id,approved:false}],showcaseDir:'/does-not-exist'});
  assert.deepEqual(ignored.manifest,{});
  for (const decisions of [[decision,decision],[decision,{id:'unknown',approved:false}]]) await assert.rejects(importTemplateSwapClips({...base,decisions}), /duplicate_template_id|unknown_template_swap/);
  const reviewedDecisions = [{...decision,sha256:dry.manifest[id].sha256}];
  const r2 = {accountId:'mock',accessKeyId:'mock',secretAccessKey:'mock',bucket:'mock'}, objects = new Map();
  const storage = {
   async putObject(key,bytes,type,cfg,options) { assert.deepEqual(options,{onlyIfAbsent:true}); assert.equal(type,'video/mp4'); assert.equal(cfg,r2); if(objects.has(key)) return {ok:false,status:412}; objects.set(key,bytes); return {ok:true}; },
   async getObject(key) { return {ok:true,response:new Response(objects.get(key))}; },
  };
  for (let i=0;i<2;i++) {
   const uploaded = await importTemplateSwapClips({...base,decisions:reviewedDecisions,upload:true,confirmBucket:'mock',r2,storage});
   assert.equal(uploaded.report.publishable,true); await access(path.join(uploaded.runDir,'publishable','templateSwapClipSources.js'));
  }
  assert.equal(objects.size,1);
  await assert.rejects(importTemplateSwapClips({...base,upload:true,confirmBucket:'mock',r2,storage}), /reviewed_hash_mismatch/);
  await assert.rejects(importTemplateSwapClips({...base,decisions:[{...decision,sha256:'c'.repeat(64)}],upload:true,confirmBucket:'mock',r2,storage}), /reviewed_hash_mismatch/);
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
  const empty = 'export const TEMPLATE_SWAP_CLIPS = Object.freeze([]);\n';
  const first = renderSwapRegistry(empty, ['a-one']);
  assert.match(first, /Object\.freeze\(\["a-one"\]\)/);
  const second = renderSwapRegistry(first, ['a-two', 'a-three']);
  assert.match(second, /Object\.freeze\(\["a-two","a-three"\]\)/); assert.doesNotMatch(second, /a-one/);
  assert.throws(() => renderSwapRegistry('export const X = 1;\n', ['a']), /registry_render_failed/);
});
