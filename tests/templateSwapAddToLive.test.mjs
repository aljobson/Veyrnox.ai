import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { BOUND_SOURCE_CLIP_IDS, importTemplateSwapClips, swapCandidates, tierFor } from '../scripts/import-template-swap-clips.mjs';
import { sha256Hex } from '../packages/adapters/r2.js';
import { TEMPLATE_CLIPS } from '../app/veyrnox/_lib/templateClips.js';

const id = 'community-boardwalk-dance-routine';
const r2 = { accountId: 'a'.repeat(32), accessKeyId: 'mock', secretAccessKey: 'mock', bucket: 'mock', endpoint: 'https://mock.invalid' };
const liveClip = sha => ({ role: 'the main character', key: `template-swap-clips/live-one/${sha}.mp4`, version: sha.slice(0, 12), seconds: 5, videoSeconds: 5,
  width: 720, height: 1280, frameRate: 24, contentType: 'video/mp4', sha256: sha, sizeBytes: 10 });

function memoryStorage(seed = {}) {
  const objects = new Map(Object.entries(seed));
  return { objects,
    putObject: async (key, bytes) => { objects.set(key, new Uint8Array(bytes)); return { ok: true, status: 200 }; },
    getObject: async key => objects.has(key) ? { ok: true, response: new Response(objects.get(key)) } : { ok: false, response: new Response(null, { status: 404 }) } };
}

async function reviewedRun(dir) {
  const showcaseDir = path.join(dir, 'showcase'); await mkdir(showcaseDir);
  execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=600x1066:r=24', '-t', '5', '-c:v', 'libx264', '-threads', '2', '-pix_fmt', 'yuv420p',
    path.join(showcaseDir, TEMPLATE_CLIPS.find(c => c.id === id).previewFile)]);
  const base = { outDir: dir, showcaseDir, records: [], upscale: true, kinds: ['bound_source'], r2 };
  const review = await importTemplateSwapClips({ ...base, decisions: [{ id, approved: false, role: 'the man in the yellow jacket' }], reviewAll: true });
  const row = JSON.parse(await readFile(path.join(review.runDir, 'decisions-template.json'), 'utf8')).find(d => d.id === id);
  return { base, decisions: [{ ...row, approved: true }] };
}

test('the ten approved bound templates are reachable only through their own kind', async () => {
  assert.equal(BOUND_SOURCE_CLIP_IDS.length, 10);
  assert.deepEqual((await swapCandidates({ kinds: ['bound_source'] })).map(c => c.id).sort(), [...BOUND_SOURCE_CLIP_IDS].sort());
  const defaults = new Set((await swapCandidates()).map(c => c.id));
  assert.ok(BOUND_SOURCE_CLIP_IDS.every(boundId => !defaults.has(boundId)));
  assert.equal(tierFor('bound_source', 'audit_hash'), 'E');
});

test('add-to-live keeps every live clip and hidden clips stay out of the registry', async t => {
  t.mock.method(globalThis, 'fetch', () => assert.fail('network is forbidden'));
  const dir = await mkdtemp(path.join(tmpdir(), 'swap-add-live-'));
  try {
    const { base, decisions } = await reviewedRun(dir);
    const clips = { 'live-one': liveClip('b'.repeat(64)), 'hidden-one': { ...liveClip('c'.repeat(64)), key: `template-swap-clips/hidden-one/${'c'.repeat(64)}.mp4` } };
    const liveBytes = new TextEncoder().encode(JSON.stringify({ version: 1, clips }));
    const livePin = await sha256Hex(liveBytes);
    const storage = memoryStorage({ [`template-swap-clips/manifests/${livePin}.json`]: liveBytes });
    const run = await importTemplateSwapClips({ ...base, decisions, upload: true, confirmBucket: 'mock', storage, addToLive: true, livePin, liveIds: ['live-one'] });
    const written = JSON.parse(await readFile(path.join(run.runDir, 'publishable/manifest.json'), 'utf8'));
    assert.deepEqual(Object.keys(written.clips).sort(), [id, 'hidden-one', 'live-one'].sort());
    assert.deepEqual(written.clips['live-one'], clips['live-one']);
    const registry = await readFile(path.join(run.runDir, 'publishable/templateSwapClips.js'), 'utf8');
    assert.ok(registry.includes(`Object.freeze(${JSON.stringify([id, 'live-one'])})`));
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('an unreadable or tampered live manifest stops the run before any clip is written', async t => {
  t.mock.method(globalThis, 'fetch', () => assert.fail('network is forbidden'));
  const dir = await mkdtemp(path.join(tmpdir(), 'swap-add-live-'));
  try {
    const { base, decisions } = await reviewedRun(dir);
    const livePin = 'd'.repeat(64);
    const missing = memoryStorage();
    await assert.rejects(importTemplateSwapClips({ ...base, decisions, upload: true, confirmBucket: 'mock', storage: missing, addToLive: true, livePin }), /live_manifest_unreadable/);
    assert.equal(missing.objects.size, 0);
    const tampered = memoryStorage({ [`template-swap-clips/manifests/${livePin}.json`]: new TextEncoder().encode('{}') });
    await assert.rejects(importTemplateSwapClips({ ...base, decisions, upload: true, confirmBucket: 'mock', storage: tampered, addToLive: true, livePin }), /live_manifest_hash_mismatch/);
    assert.equal(tampered.objects.size, 1);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
