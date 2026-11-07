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
    await assert.rejects(importTemplateClips({ decisions: [{ ...decision, previewUrl }], download: () => assert.fail('downloaded mismatch') }), /template_preview_mismatch|source_url_not_allowed/);
  }
  await assert.rejects(importTemplateClips({ decisions: [decision, { id: 'unknown', approved: true }], download: () => assert.fail('partial download') }), /unknown_template_clip/);
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
    const dry = await importTemplateClips({ decisions: [decision], outDir: root, download });
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
    await assert.rejects(importTemplateClips({ decisions: [decision], upload: true, r2: cfg, download }), /confirmed_r2_bucket_required/);
    for (let i = 0; i < 2; i++) {
      const uploaded = await importTemplateClips({ decisions: [decision], outDir: root, upload: true, confirmBucket: cfg.bucket, r2: cfg, storage, download });
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
    const imported = await importTemplateClips({ decisions: [decision], outDir: root, download: (_url, to) => copyFile(fixture, to) });
    const actual = await measure(imported.files[0].file), entry = imported.manifest[id];
    for (const field of ['seconds', 'videoSeconds']) {
      assert.equal(entry[field], actual[field]);
      assert.ok(entry[field] >= 5 && entry[field] <= 5.05);
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});
