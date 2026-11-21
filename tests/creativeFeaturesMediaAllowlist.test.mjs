import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { CREATIVE_FEATURE_EXAMPLES } from '../app/veyrnox/_lib/creativeFeatures.js';

const ORIGINAL_STILLS = [
  'ai-avatar-generator', 'text-to-speech', 'ai-voice-cloning',
  'talking-objects', 'product-image-generator',
];

// Shrinking exception list: remove each slug when its original media lands.
// A1 leaves 12 other videos, singing-photo (separate session)(Lip Sync is local since PR #2584).
const LEGACY_EXCEPTIONS = new Set([
  'talking-avatar', 'ai-human-generator', 'ai-influencer-generator',
  'ai-talking-photo-generator', 'singing-photo', 'avatar-dialogue',
  'video-dubbing', 'talking-cartoon', 'talking-animals', 'ai-baby-podcast',
  'ai-ad-clone', 'product-avatar', 'product-video-generator',
]);

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
