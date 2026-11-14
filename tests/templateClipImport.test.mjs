import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, copyFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { canonicalPreview, sourceUrl, validateDecision, downloadClip, importTemplateClips } from '../scripts/import-template-clips.mjs';
import { measure } from '../scripts/import-swap-scenes.mjs';
import { sha256Hex } from '../packages/adapters/r2.js';
const id = 'medieval-runway-look', canonical = 'https://veyrnox.ai/showcase/viral-medieval-runway-look.mp4';
const decision = { id, approved: true };

test('only canonical own-preview URLs; every mismatch is rejected before any download', async () => {
  assert.equal(canonicalPreview(id), canonical); assert.equal(validateDecision(decision), canonical);
  for (const previewUrl of ['https://veyrnox.ai/showcase/another.mp4', 'https://syntx.ai/showcase/a.mp4']) {
    await assert.rejects(importTemplateClips({ showcaseDir: '/private/tmp/template-chips-nonexistent-showcase', decisions: [{ ...decision, previewUrl }], download: () => assert.fail('downloaded mismatch') }), /template_preview_mismatch|source_url_not_allowed/);
  }
  await assert.rejects(importTemplateClips({ showcaseDir: '/private/tmp/template-chips-nonexistent-showcase', decisions: [decision, { id: 'unknown', approved: true }], download: () => assert.fail('partial download') }), /unknown_template_clip/);
  for (const url of ['http://veyrnox.ai/showcase/a.mp4', 'https://user:pass@veyrnox.ai/showcase/a.mp4', 'https://veyrnox.ai.evil.test/showcase/a.mp4', 'https://veyrnox.ai/private/a.mp4', 'https://veyrnox.ai/showcase/a.webm', canonical + '?x=1', canonical + '#x']) assert.throws(() => sourceUrl(url));
});

test('download rejects redirects, MIME and bounded byte violations with mock responses', async () => {
  for (const [response, error] of [[new Response(null, { status: 302 }), /redirect/], [new Response('x'), /not_mp4/],
    [new Response('x', { headers: { 'content-type': 'video/mp4', 'content-length': String(101 * 1024 * 1024) } }), /over_cap/]]) {
    await assert.rejects(downloadClip(canonical, '/unused', async (_url, init) => { assert.equal(init.redirect, 'manual'); return response; }), error);
  }
});

test('offline ffmpeg normalization, deterministic hashes and conditional in-memory upload', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'template-clip-proof-'));
  try {
    const fixture = path.join(root, 'synthetic.mp4');
    execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=320x480:r=12', '-t', '2.5', '-c:v', 'libx264', '-threads', '2', '-pix_fmt', 'yuv420p', fixture]);
    const download = async (url, to) => { assert.equal(url, canonical); await copyFile(fixture, to); };
    const dry = await importTemplateClips({ showcaseDir: '/private/tmp/template-chips-nonexistent-showcase', decisions: [decision], outDir: root, download });
    const failed = await importTemplateClips({ showcaseDir: '/private/tmp/template-chips-nonexistent-showcase', decisions: [decision], outDir: root, download, modelId: 'seedance-2.0-reference-kie' });
    assert.equal(failed.report.results[0].reason, 'kie_reference_requires_five_seconds');
    assert.equal(dry.report.publishable, false); assert.ok(dry.revisionDir.endsWith('/preview'));
    const bytes = await readFile(dry.files[0].file), sha = await sha256Hex(bytes), media = await measure(dry.files[0].file);
    assert.equal(dry.manifest[id].key, `template-clips/${id}/${sha}.mp4`);
    assert.equal(media.codec, 'h264'); assert.equal(media.audio, false); assert.ok(media.seconds <= 5.05);
    const cfg = { accountId: 'mock', accessKeyId: 'mock', secretAccessKey: 'mock', bucket: 'mock-bucket' }, objects = new Map();
    const storage = {
      async putObject(key, value, type, config, options) {
        assert.deepEqual(options, { onlyIfAbsent: true }); assert.equal(type, 'video/mp4'); assert.equal(config, cfg);
        if (objects.has(key)) return { ok: false, status: 412 };
        objects.set(key, Buffer.from(value)); return { ok: true };
      },
      async getObject(key) { return { ok: true, response: new Response(objects.get(key)) }; },
    };
    await assert.rejects(importTemplateClips({ showcaseDir: '/private/tmp/template-chips-nonexistent-showcase', decisions: [decision], upload: true, r2: cfg, download }), /confirmed_r2_bucket_required/);
    for (let i = 0; i < 2; i++) {
      const uploaded = await importTemplateClips({ showcaseDir: '/private/tmp/template-chips-nonexistent-showcase', decisions: [decision], outDir: root, upload: true, confirmBucket: cfg.bucket, r2: cfg, storage, download });
      assert.equal(uploaded.report.publishable, true); assert.deepEqual(uploaded.manifest, dry.manifest);
    }
    assert.equal(objects.size, 1);
  } finally { await rm(root, { recursive: true, force: true }); }
});


test('a 10.04-second source imports its first five seconds with measured manifest lengths', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'template-clip-window-'));
  try {
    const fixture = path.join(root, 'synthetic.mp4');
    execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=s=320x480:r=25', '-t', '10.04', '-c:v', 'libx264', '-threads', '2', '-pix_fmt', 'yuv420p', fixture]);
    assert.ok((await measure(fixture)).videoSeconds > 10);
    const imported = await importTemplateClips({ showcaseDir: '/private/tmp/template-chips-nonexistent-showcase', decisions: [decision], outDir: root, download: (_url, to) => copyFile(fixture, to) });
    const actual = await measure(imported.files[0].file), entry = imported.manifest[id];
    for (const field of ['seconds', 'videoSeconds']) {
      assert.equal(entry[field], actual[field]);
      assert.ok(entry[field] >= 5 && entry[field] <= 5.05);
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});

for (const dimensions of ['1280x720', '1920x1080', '640x360']) test(`kie import 29.97 fps ${dimensions} enforces measured pixel window before upload`, async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'template-kie-import-'));
  try {
    const fixture = path.join(root, 'synthetic.mp4');
    execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', `color=c=blue:s=${dimensions}:r=30000/1001`, '-t', '6', '-c:v', 'libx264', '-threads', '2', '-pix_fmt', 'yuv420p', fixture]);
    const r2 = { accountId: 'mock', accessKeyId: 'mock', secretAccessKey: 'mock', bucket: 'mock' };
    let uploads = 0;
    const options = { decisions: [decision], outDir: root, modelId: 'seedance-2.0-reference-kie',
      r2, download: (_url, to) => copyFile(fixture, to), storage: { putObject() { uploads++; assert.fail('invalid clip uploaded'); } } };
    if (dimensions === '640x360') {
      const failed = await importTemplateClips({ showcaseDir: '/private/tmp/template-chips-nonexistent-showcase', ...options, upload: true, confirmBucket: 'mock' });
      assert.equal(failed.report.results[0].reason, 'source_too_small');
      assert.equal(uploads, 0);
      // The same undersized kie source retains fal's existing acceptance.
      assert.equal((await importTemplateClips({ showcaseDir: '/private/tmp/template-chips-nonexistent-showcase', ...options, modelId: 'seedance-2.0-reference' })).report.results[0].status, 'normalised');
      return;
    }
    const imported = await importTemplateClips({ ...options, showcaseDir: '/private/tmp/template-chips-nonexistent-showcase' }), source = imported.manifest[id];
    assert.equal(source.width, 1280); assert.equal(source.height, 720); assert.equal(source.pixels, 921600);
    assert.equal(source.frameRate, 30); assert.equal(source.sizeBytes, (await readFile(imported.files[0].file)).length);
    for (const seconds of [source.seconds, source.videoSeconds]) assert.ok(Math.abs(seconds - 5) <= 1 / 30);
    const { resolveTemplateClipVideo } = await import('../lib/templateClipGeneration.js');
    const { capabilityFor } = await import('../lib/modelCapabilities.js');
    const admitted = await resolveTemplateClipVideo({ template: { id }, source }, capabilityFor('market:bytedance/seedance-2'), {}, async () => ({ url: 'https://fixture.test/clip.mp4' }));
    assert.equal(admitted.ok, true);
  } finally { await rm(root, { recursive: true, force: true }); }
});

// A tiny fake showcase directory exercises bulk behavior without reading real media.
test('bulk local-first import reports failures, resumes verified clips and refuses escaping symlinks', async () => {
  const { mkdir, symlink } = await import('node:fs/promises');
  const { TEMPLATE_CLIPS } = await import('../app/veyrnox/_lib/templateClips.js');
  const { localClip } = await import('../scripts/import-template-clips.mjs');
  const entries = TEMPLATE_CLIPS.slice(0, 3);
  const root = await mkdtemp(path.join(tmpdir(), 'template-bulk-proof-'));
  try {
    const showcaseDir = path.join(root, 'showcase'); await mkdir(showcaseDir);
    const fixture = path.join(root, 'synthetic.mp4');
    execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=320x480:r=25', '-t', '2.5', '-c:v', 'libx264', '-threads', '2', '-pix_fmt', 'yuv420p', fixture]);
    await copyFile(fixture, path.join(showcaseDir, entries[0].previewFile));
    await symlink(fixture, path.join(showcaseDir, entries[1].previewFile));
    let downloads = 0;
    const options = { all: true, decisions: entries.map(({ id }) => ({ id, approved: true })), outDir: root, showcaseDir, chunkSize: 1,
      download: async (url, file) => { downloads++; assert.equal(url, canonicalPreview(entries[2].id)); await copyFile(fixture, file); } };
    const first = await importTemplateClips(options);
    assert.equal(downloads, 1);
    assert.deepEqual(Object.keys(first.manifest), [entries[0].id, entries[2].id]);
    assert.equal(first.report.results.find(r => r.id === entries[1].id).reason, 'source_path_not_allowed');
    assert.equal(first.report.results.filter(r => r.status === 'skipped').length, TEMPLATE_CLIPS.length - 3);
    assert.match(await readFile(path.join(first.runDir, 'report.txt'), 'utf8'), /normalised:.*\nfailed:/);
    const resumed = await importTemplateClips({ ...options, resumeDir: first.runDir, download: () => assert.fail('download on resume') });
    assert.deepEqual(resumed.manifest, first.manifest);
    assert.equal(resumed.report.results.filter(r => r.reason === 'resumed').length, 2);
    await assert.rejects(localClip('../escape', path.join(root, 'bad.mp4'), showcaseDir), /unknown_template_clip/);
    assert.throws(() => sourceUrl('https://veyrnox.ai/showcase/../showcase/a.mp4'), /source_url_not_allowed/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('900 tuple-encoded manifest entries remain below 150 KB', async () => {
  const { manifestModule } = await import('../scripts/import-template-clips.mjs');
  const { TEMPLATE_CLIPS } = await import('../app/veyrnox/_lib/templateClips.js');
  const sample = Object.fromEntries(Array.from({ length: 900 }, (_, i) => [`${TEMPLATE_CLIPS[i % TEMPLATE_CLIPS.length].id}-${i}`, {
    sha256: 'a'.repeat(64), seconds: 5, videoSeconds: 5, width: 1280, height: 720, frameRate: 30, sizeBytes: 1234567,
  }]));
  const candidateModule = manifestModule(sample);
  assert.ok(Buffer.byteLength(candidateModule) < 150_000);
  const loaded = await import('data:text/javascript,' + encodeURIComponent(candidateModule));
  assert.equal(Object.keys(loaded.TEMPLATE_CLIP_SOURCES).length, 900);
});
