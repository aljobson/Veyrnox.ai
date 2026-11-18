import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolutionVariants, RESOLUTION_VARIANTS } from '../app/veyrnox/_lib/modelVariants.js';

const row = (id, credits) => ({ id, credits });
const both = [row('kling-3.0-i2v', 32), row('kling-3.0-standard-i2v', 24), row('wan-2.5-kie', 17)];

test('either Kling 3.0 image-to-video model offers 720p then 1080p, priced from its own catalog row', () => {
  for (const id of ['kling-3.0-i2v', 'kling-3.0-standard-i2v']) {
    const variants = resolutionVariants(id, both);
    assert.deepEqual(variants.map((v) => v.label), ['720p', '1080p']);
    assert.deepEqual(variants.map((v) => v.model.credits), [24, 32]);
    assert.deepEqual(variants.map((v) => v.model.id), ['kling-3.0-standard-i2v', 'kling-3.0-i2v']);
  }
});

test('a switched-off variant is not offered, and a model with no counterpart shows no choice', () => {
  assert.deepEqual(resolutionVariants('kling-3.0-i2v', [row('kling-3.0-i2v', 32)]), []);
  assert.deepEqual(resolutionVariants('wan-2.5-kie', both), []);
  assert.deepEqual(resolutionVariants(undefined, both), []);
});

test('the groups are frozen and the Create page mounts the choice for video models', () => {
  assert.ok(Object.isFrozen(RESOLUTION_VARIANTS) && Object.isFrozen(RESOLUTION_VARIANTS[0]));
  const page = readFileSync(new URL('../app/veyrnox/app/create/page.js', import.meta.url), 'utf8');
  assert.match(page, /<ResolutionVariantChoice model=\{model\} models=\{models\}/);
});
