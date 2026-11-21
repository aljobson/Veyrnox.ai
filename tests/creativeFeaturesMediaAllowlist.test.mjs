import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { CREATIVE_FEATURE_EXAMPLES } from '../app/veyrnox/_lib/creativeFeatures.js';

const ORIGINAL_STILLS = [
  'ai-avatar-generator', 'text-to-speech', 'ai-voice-cloning',
  'talking-objects', 'product-image-generator',
];

// Shrinking exception list: remove each slug when its original media lands.
// Only singing-photo (separate session) is still on competitor media. Lip Sync is local since PR #2584.
const LEGACY_EXCEPTIONS = new Set(['singing-photo']);
const ORIGINAL_VIDEOS = [
  'talking-avatar', 'ai-human-generator', 'ai-influencer-generator', 'ai-talking-photo-generator', 'avatar-dialogue', 'video-dubbing', 'talking-cartoon', 'talking-animals', 'ai-baby-podcast', 'ai-ad-clone', 'product-avatar', 'product-video-generator',
];

test('only explicitly deferred slugs may use competitor example media', () => {
  for (const [slug, example] of Object.entries(CREATIVE_FEATURE_EXAMPLES)) {
    for (const asset of [example.url, example.posterUrl].filter(Boolean)) {
      const url = new URL(asset, 'https://veyrnox.ai');
      assert.equal(url.protocol, 'https:', slug);
      assert.equal(url.username + url.password + url.port, '', slug);
      if (url.origin === 'https://veyrnox.ai') {
        assert.ok(url.pathname.startsWith('/examples/'), `${slug}: ${asset}`);
      } else {
        assert.equal(url.origin, 'https://cdn.lipsync.video', slug);
        assert.ok(LEGACY_EXCEPTIONS.has(slug), `${slug} cannot return to competitor media`);
      }
    }
  }
  for (const slug of LEGACY_EXCEPTIONS) {
    assert.ok(CREATIVE_FEATURE_EXAMPLES[slug], `remove stale exception: ${slug}`);
    assert.ok(!ORIGINAL_STILLS.includes(slug), `${slug} must never be an exception`);
  }
});

test('the five original stills resolve to shipped WebP files below 200 KB', async () => {
  for (const slug of ORIGINAL_STILLS) {
    assert.deepEqual(CREATIVE_FEATURE_EXAMPLES[slug], { kind: 'image', url: `/examples/${slug}.webp` });
    const file = new URL(`../public/examples/${slug}.webp`, import.meta.url);
    const bytes = await readFile(file);
    assert.equal(bytes.toString('ascii', 0, 4), 'RIFF', slug);
    assert.equal(bytes.toString('ascii', 8, 12), 'WEBP', slug);
    assert.ok((await stat(file)).size < 200_000, slug);
  }
});

test('the twelve original videos are local H.264 MP4s with JPEG posters', async () => {
  for (const slug of ORIGINAL_VIDEOS) {
    assert.deepEqual(CREATIVE_FEATURE_EXAMPLES[slug], { kind: 'video', url: `/examples/${slug}.mp4`, posterUrl: `/examples/${slug}.jpg` });
    const mp4 = new URL(`../public/examples/${slug}.mp4`, import.meta.url);
    const head = await readFile(mp4);
    assert.equal(head.toString('ascii', 4, 8), 'ftyp', slug);
    assert.ok(head.includes(Buffer.from('avc1')), `${slug} must be H.264`);
    assert.ok((await stat(mp4)).size < 3_000_000, slug);
    const jpg = await readFile(new URL(`../public/examples/${slug}.jpg`, import.meta.url));
    assert.deepEqual([...jpg.subarray(0, 2)], [0xff, 0xd8], slug);
  }
});
