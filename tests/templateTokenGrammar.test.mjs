import test from 'node:test';
import assert from 'node:assert/strict';
import { bind, imageSlots } from '../lib/templateBinding.js';
import { clientContractFor } from '../lib/templateClientContractRuntime.js';
import { templateVideoDependency } from '../lib/templateVideoDependency.js';
import { checkTemplateRequest } from '../lib/templateFidelity.js';
import { templateSwapAvailable } from '../lib/templateSwapClipGate.js';
import { catalog, source } from './fixtures/templateSwapClips.mjs';

for (const token of ['@image1', '@Image 1', '@IMAGE_1', '@image-1', '@iMaGe\t1', '@imagex', '@image_x', '@image-X', '@IMAGE X', '<<<image_1>>>', '<<<IMAGE_1>>>', 'Image 1:', 'image_1.png', 'IMAGE_1.JPEG', 'image_1.webp', 'image_1.gif', '@image', '@IMAGE']) {
  test(`image slot grammar: ${token}`, () => {
    assert.deepEqual(imageSlots(token), [1]);
    const bound = bind(token, 1);
    assert.equal(bound.text, token === 'Image 1:' ? '@Image1:' : '@Image1');
    assert.equal(bound.map[0].token, token === 'Image 1:' ? 'Image 1' : token);
  });
}
for (const text of ['@images', '@imagery', '@image-xyz', '@image_xyz', '@image12abc', '@imageXyz']) {
  test(`not a slot: ${text}`, () => assert.deepEqual(imageSlots(text), []));
}
test('mixed forms share numbers; x reserves numbers globally and allocates each occurrence', () => {
  const text = '@image_x <<<image_2>>> @IMAGE_1 @image-X Image 2: image_1.jpg';
  assert.deepEqual(imageSlots(text), [3, 2, 1, 4]);
  const result = bind(text, 4);
  assert.equal(result.text, '@Image1 @Image2 @Image3 @Image4 @Image2: @Image3');
  assert.deepEqual(result.map.map(r => r.slot), [1, 2, 3, 4, 2, 3]);
  for (const m of result.map) assert.equal(text.slice(m.offset, m.offset + m.token.length), m.token);
  assert.deepEqual(imageSlots('@image1 @image_x @image_x'), [1, 2, 3]);
  assert.deepEqual(imageSlots('@image_x @image_x'), [1, 2]);
  // Not slots, and (like the older @imageOne case) never silently literal: a leftover @image* reference leaves the template unmapped.
  assert.deepEqual(imageSlots('@images @imagery @image1'), [1]);
  for (const text of ['@images @image1', '@imagery @image1', '@imageOne @image1']) assert.equal(bind(text, 1).error, 'unmapped-image-reference', text);
});
test('bare image aliases slot 1 only without any numbered or x token', () => {
  assert.equal(bind('@image and @IMAGE', 1).text, '@Image1 and @Image1');
  for (const numbered of ['@image1', '@image_x', '<<<image_2>>>', 'Image 1:', 'image_1.png']) {
    assert.equal(bind(`@image with ${numbered}`, 1).error, 'unmapped-image-reference');
    assert.equal(bind(`${numbered} with @image`, 1).error, 'unmapped-image-reference');
  }
});
test('selected client contract uses the same resolved grammar', () => {
  const c = clientContractFor({ id: 'grammar', sourcePromptOrigin: 'community-source-exact', sourcePrompt: '@image_x @image1 @image_x' },
    { class: 'bound', slotCount: 3, modelId: 'kling-3.0-i2v' });
  assert.equal(c.prompt, '@Image1 @Image2 @Image3');
  assert.deepEqual(c.tokenMap.map(m => m.token), ['@image_x', '@image1', '@image_x']);
});
for (const token of ['@video', '@video1', '@video_1', '@video-1', '@Video 1', '<<<video_1>>>']) {
  test(`video form ${token} blocks photo admission and requires registered O1 clip`, () => {
    const prompt = `Use @image_x with ${token}`;
    assert.equal(templateVideoDependency(prompt), true);
    assert.equal(bind(prompt, 1).error, token.startsWith('<<<') ? 'unmapped-placeholder' : undefined);
    const id = 'community-driver-portrait';
    assert.equal(checkTemplateRequest({ template_id: id, model_id: 'kling-3.0-i2v', inputs: { prompt } }).error, 'template_blocked');
    const options = { env: { MULTI_REFERENCE_ENABLED: 'true', TEMPLATE_SWAP_CLIP_ENABLED: 'true' }, catalog, registry: [id], manifest: { [id]: { ...source, key: `template-swap-clips/${id}/${source.sha256}.mp4` } } };
    assert.ok(templateSwapAvailable(id, options));
    for (const patch of [{ registry: [] }, { manifest: {} }, { env: {} }, { catalog: [{ ...catalog[0], active: false }] }]) {
      assert.equal(templateSwapAvailable(id, { ...options, ...patch }), null);
    }
  });
}
