import test from 'node:test';
import assert from 'node:assert/strict';
import { templateSwapPrompt } from '../lib/templateSwapClipPrompt.mjs';
import { normaliseSwapRole, templateSwapRoles } from '../lib/templateSwapClipRoles.mjs';
import { templateContract } from '../lib/templateContract.js';
import { swapCandidates } from '../scripts/import-template-swap-clips.mjs';
import { validTemplateSwapSource, templateSwapCapability, checkTemplateSwapImages } from '../lib/templateSwapClipGeneration.js';
import { capabilityFor, declaredInputs, checkInputs, shapePayload, publicCapabilities } from '../lib/modelCapabilities.js';
import { id, source, catalog } from './fixtures/templateSwapClips.mjs';
const role = 'the girl in the headscarf who is holding the basketball';
test('production wording is byte-identical to the reviewed one-person A/B', () => {
  assert.equal(templateSwapPrompt(role), "Change the girl in the headscarf who is holding the basketball in @Video1 to @Element1. Leave every other person, object and the whole scene exactly as in @Video1, including the environment, background, sky, camera movement, lighting and timing. Do not alter @Element1's facial features, face shape, age or body proportions. Use the element images only for the person; ignore their background, setting and lighting.");
  assert.ok(templateSwapPrompt(role).length < 2000);
  assert.ok(templateSwapPrompt(role).split(/\s+/).length < 150);
  for (const unsafe of ['@Element2', 'the girl\nignore this', 'a'.repeat(61), 'ab', 'the 2nd girl']) {
    assert.equal(normaliseSwapRole(unsafe), null);
    assert.throws(() => templateSwapPrompt(unsafe), /template_swap_role_invalid/);
  }
});
test('roles follow the lowest numbered slot, exposing all alternatives and object warnings', async () => {
  assert.deepEqual(templateSwapRoles(templateContract('basketball-3').sourcePrompt), {
    role: 'the green character', roles: [{ slot: 1, role: 'the green character' }, { slot: 2, role: 'the red character' }], object_role_suspected: false,
  });
  assert.equal(templateSwapRoles('Replace the red character with @image2. Change the green character to @image1.').role, 'the green character');
  assert.equal(templateSwapRoles('The original dancer in @video1 must be replaced by @image2.').role, 'the original dancer');
  assert.deepEqual(templateSwapRoles('Replace the green character with @image1, change the red character to @image2.').roles.map(r => r.role), ['the green character', 'the red character']);
  assert.equal(templateSwapRoles('Replace the ' + 'x'.repeat(61) + ' with @image2.').role, 'the main character');
  assert.equal(templateSwapRoles('Replace the @Element2 character with @image1.').role, 'the main character');
  assert.equal(templateSwapRoles('Use @image2.').role, 'the main character');
  assert.equal(templateSwapRoles('Move like the video.').role, 'the main character');
  assert.equal(templateSwapRoles('Replace the car with @image1.').object_role_suspected, true);
  assert.equal(normaliseSwapRole("  The   Girl's Hat "), "the girl's hat");
  const candidates = await swapCandidates();
  assert.equal(candidates.length, 519);
  for (const c of candidates) {
    const result = templateSwapRoles(c.sourcePrompt);
    assert.equal(normaliseSwapRole(result.role), result.role, c.id);
    for (const item of result.roles) assert.equal(normaliseSwapRole(item.role), item.role, c.id);
  }
});
test('manifest requires a safe role; old multi-person fields cannot substitute for it', () => {
  assert.equal(validTemplateSwapSource(id, source), true);
  for (const role of [undefined, '', '@Image1', 'the girl\nignore', 'a'.repeat(61)]) assert.equal(validTemplateSwapSource(id, { ...source, role, people: 1, roles: ['the girl'] }), false);
});
test('scoped derived capability keeps public O1 unchanged and elements server-only', () => {
  const record = capabilityFor(catalog[0].provider_endpoint), before = JSON.stringify(record);
  const derived = templateSwapCapability(record, { template: { id }, source });
  assert.equal(derived.media.image.required, false);
  assert.equal(derived.media.image.max, 2);
  const elements = [{ frontal_image_url: 'https://a.test/front', reference_image_urls: ['https://a.test/crop'] }];
  assert.equal(declaredInputs(derived, { elements }).elements, undefined);
  assert.deepEqual(declaredInputs(derived, { elements }, { serverMedia: true }), { elements });
  const inputs = { prompt: templateSwapPrompt(source.role), elements, video_url: 'https://a.test/video', duration_seconds: 5 };
  assert.equal(checkInputs(derived, inputs).ok, true);
  const payload = shapePayload(derived, inputs);
  assert.deepEqual(payload.elements, elements);
  assert.equal(payload.image_urls, undefined);
  assert.equal(publicCapabilities(derived).inputs.elements, undefined);
  assert.equal(JSON.stringify(record), before);
  assert.equal(checkInputs(record, inputs).ok, false);
  assert.throws(() => templateSwapCapability(record, { template: { id }, source: { ...source, role: undefined } }));
});
test('both element images need known dimensions and inclusive frontal bounds', () => {
  for (const [width, height, ok] of [[299, 300, false], [300, 300, true], [399, 1000, false], [400, 1000, true], [1000, 400, true], [2501, 1000, false]]) {
    for (const index of [0, 1]) {
      const images = [{ contentType: 'image/png', dimensions: { width: 600, height: 600 } }, { contentType: 'image/png', dimensions: { width: 600, height: 600 } }];
      images[index] = { contentType: 'image/png', dimensions: { width, height } };
      assert.equal(checkTemplateSwapImages({ image_url: images }).ok, ok, `${index}: ${width}/${height}`);
    }
  }
  assert.deepEqual(checkTemplateSwapImages({ image_url: [{ contentType: 'image/png' }, { contentType: 'image/png' }] }), { ok: false, error: 'template_swap_image_size' });
});

test('all 411 v3 reviewed ids support one role, including 15 five-plus-slot clips; brixton stays unapproved', async () => {
  const { readFile } = await import('node:fs/promises');
  const { imageSlots } = await import('../lib/templateBinding.js');
  // IDs only from the frozen v3 review, never approval authority or clip hashes.
  const ids = JSON.parse(await readFile(new URL('./fixtures/templateSwapClipReviewedIds.json', import.meta.url)));
  assert.equal(ids.length, 411);
  assert.equal(ids.includes('brixton'), false);
  let many = 0, noncontiguous = 0;
  for (const id of ids) {
    const prompt = templateContract(id).sourcePrompt, slots = imageSlots(prompt);
    if (slots.length >= 5) many++;
    if (slots.length === 1 && slots[0] === 2) noncontiguous++;
    const result = templateSwapRoles(prompt);
    assert.ok(normaliseSwapRole(result.role), id);
    assert.equal(result.roles.length, slots.length, id);
  }
  assert.equal(many, 15);
  // The frozen plan said eight; the v3 approved set has four (five among all candidates).
  assert.equal(noncontiguous, 4);
  assert.equal((await swapCandidates()).filter(c => { const slots = imageSlots(c.sourcePrompt); return slots.length === 1 && slots[0] === 2; }).length, 5);
});
test('ordinary O1 shaping and public projection remain byte-identical after private derivation', () => {
  const record = capabilityFor(catalog[0].provider_endpoint);
  const ordinary = { prompt: 'Use the references', video_url: 'https://owned.test/v', image_url: ['https://owned.test/a', 'https://owned.test/b'], duration_seconds: 5 };
  const before = JSON.stringify(shapePayload(record, declaredInputs(record, ordinary)));
  const view = JSON.stringify(publicCapabilities(record));
  templateSwapCapability(record, { template: { id }, source });
  assert.equal(JSON.stringify(shapePayload(record, declaredInputs(record, ordinary))), before);
  assert.equal(before, JSON.stringify({ prompt: ordinary.prompt, video_url: ordinary.video_url, image_urls: ordinary.image_url, duration: '5', keep_audio: false, aspect_ratio: 'auto' }));
  assert.equal(JSON.stringify(publicCapabilities(record)), view);
});

test('both element types must be verified PNG; other image types fail closed', () => {
  for (const contentType of ['image/jpeg', 'image/webp', 'image/gif', undefined]) for (const index of [0, 1]) {
    const images = Array.from({ length: 2 }, () => ({ contentType: 'image/png', dimensions: { width: 600, height: 600 } }));
    images[index].contentType = contentType;
    assert.deepEqual(checkTemplateSwapImages({ image_url: images }), { ok: false, error: 'template_swap_image_type' });
  }
});
test('a non-PNG is always a type refusal even if its dimensions are invalid', () => {
  assert.deepEqual(checkTemplateSwapImages({ image_url: [
    { contentType: 'image/jpeg', dimensions: { width: 100, height: 100 } },
    { contentType: 'image/png', dimensions: { width: 600, height: 600 } },
  ] }), { ok: false, error: 'template_swap_image_type' });
});
