import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { registryEntries, renderRegistry } from '../scripts/gen-template-clip-registry.mjs';
import { TEMPLATE_CLIPS, publicTemplateClip } from '../app/veyrnox/_lib/templateClips.js';
import { templateClipAvailable, loadTemplateClip } from '../lib/templateClipGate.js';
import { manifest, catalog, id } from './fixtures/templateClips.mjs';

test('generated registry has no drift, duplicates, missing MP4s or catalog imports', () => {
  const text = readFileSync(new URL('../app/veyrnox/_lib/templateClips.js', import.meta.url), 'utf8');
  assert.equal(text, renderRegistry());
  assert.doesNotMatch(text, /^import\s|\bimport\(/m);
  assert.deepEqual(TEMPLATE_CLIPS.map(c => [c.id, c.previewFile]), registryEntries());
  assert.equal(new Set(TEMPLATE_CLIPS.map(c => c.id)).size, TEMPLATE_CLIPS.length);
  for (const clip of TEMPLATE_CLIPS) assert.ok(existsSync(new URL('../public/showcase/' + clip.previewFile, import.meta.url)), clip.id);
});
test('every registered ID stays unavailable with an absent flag or empty manifest', async () => {
  for (const clip of TEMPLATE_CLIPS) {
    assert.equal(templateClipAvailable(clip.id, { env: {}, catalog, manifest }), false);
    assert.equal(templateClipAvailable(clip.id, { env: { TEMPLATE_CLIP_ENABLED: 'true' }, catalog, manifest: {} }), false);
    assert.equal(await loadTemplateClip(clip.id, {}, { env: {}, read: () => assert.fail('flag-off catalog read') }), null);
  }
  assert.ok(publicTemplateClip(id, [{ id, kind: 'ordinary' }]));
});
