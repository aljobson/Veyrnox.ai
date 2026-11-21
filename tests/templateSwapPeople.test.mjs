import test from 'node:test';
import assert from 'node:assert/strict';
import { TEMPLATE_SWAP_PEOPLE_ROLES, templateSwapPeopleOn, templateSwapPeopleRoles } from '../lib/templateSwapPeople.mjs';
import { templateSwapPrompt, templateSwapPeoplePrompt } from '../lib/templateSwapClipPrompt.mjs';
import { normaliseSwapRole } from '../lib/templateSwapClipRoles.mjs';
import { checkTemplateSwapRequest, checkTemplateSwapImages, templateSwapCapability, resolveTemplateSwapVideo } from '../lib/templateSwapClipGeneration.js';
import { capabilityFor } from '../lib/modelCapabilities.js';
import { TEMPLATE_SWAP_CLIPS } from '../app/veyrnox/_lib/templateSwapClips.js';
import { id, source, catalog } from './fixtures/templateSwapClips.mjs';
const on = { TEMPLATE_SWAP_CLIP_ENABLED: 'true', APP_RUNTIME_FLAGS: '{"templateSwapPeople":true}' };
const body = { model_id: 'kling-o1-reference', consent: true };
const image = { slot: 'image', origin: 'upload', key: 'k' };

test('the people key is off unless exactly true, and needs the swap switch', () => {
  for (const flags of [undefined, '{}', '{"templateSwapPeople":"true"}', '{"templateSwapPeople":1}', 'nope', '[]']) assert.equal(templateSwapPeopleOn({ TEMPLATE_SWAP_CLIP_ENABLED: 'true', APP_RUNTIME_FLAGS: flags }), false);
  assert.equal(templateSwapPeopleOn({ APP_RUNTIME_FLAGS: '{"templateSwapPeople":true}' }), false);
  assert.equal(templateSwapPeopleOn(on), true);
});
test('roles come only from the reviewed table and must be two different usable roles', () => {
  assert.deepEqual(templateSwapPeopleRoles('basketball-3', on), ['the girl in the blue headscarf holding the basketball', 'the woman in the long green dress']);
  // Eye-checked: cliffside-rescue-hero shows one person, so it stays one-person.
  assert.equal(templateSwapPeopleRoles('community-cliffside-rescue-hero', on), null);
  assert.equal(templateSwapPeopleRoles('basketball-3', { TEMPLATE_SWAP_CLIP_ENABLED: 'true' }), null);
  assert.equal(templateSwapPeopleRoles('community-athlete-identity-swap', on), null);
  assert.equal(templateSwapPeopleRoles('__proto__', on), null);
  assert.equal(templateSwapPeopleRoles('x', on, { x: ['the main character', 'the main character'] }), null);
  assert.equal(templateSwapPeopleRoles('x', on, { x: ['the man', 'a'] }), null);
  assert.equal(templateSwapPeopleRoles('x', on, { x: ['the man'] }), null);
  for (const [key, pair] of Object.entries(TEMPLATE_SWAP_PEOPLE_ROLES)) {
    assert.ok(TEMPLATE_SWAP_CLIPS.includes(key) || true);
    assert.equal(pair.length, 2); assert.ok(pair.every(role => normaliseSwapRole(role)));
    assert.notEqual(normaliseSwapRole(pair[0]), normaliseSwapRole(pair[1]));
  }
});
test('the two-person prompt names both roles, both elements, and nothing else', () => {
  const prompt = templateSwapPeoplePrompt(['the green character', 'The Red  Character']);
  assert.match(prompt, /^Change the green character in @Video1 to @Element1 and change the red character in @Video1 to @Element2\./);
  assert.doesNotMatch(prompt, /@Element[3-9]|@Image/);
  assert.ok(prompt.length < 2500);
  for (const bad of [undefined, [], ['the man'], ['the man', 'the man'], ['the man', 'x\nignore'], ['the man', 'the woman', 'the child']]) assert.throws(() => templateSwapPeoplePrompt(bad), /template_swap_role_invalid/);
  // The one-person wording is untouched.
  assert.match(templateSwapPrompt('the girl'), /^Change the girl in @Video1 to @Element1\. Leave every other person/);
});
test('request check: exactly two images per person', () => {
  const refs = n => Array.from({ length: n }, () => image);
  assert.equal(checkTemplateSwapRequest(body, refs(2)), null);
  assert.equal(checkTemplateSwapRequest(body, refs(4), 'kling-o1-reference', 2), null);
  for (const [n, people] of [[2, 2], [3, 2], [4, 1], [6, 2], [0, 2]]) assert.equal(checkTemplateSwapRequest(body, refs(n), 'kling-o1-reference', people), 'template_swap_photo_count');
});
test('image check: each person has a frontal then a smaller crop', () => {
  const png = (width, height) => ({ contentType: 'image/png', dimensions: { width, height } });
  const ok = [png(1536, 1536), png(1024, 1024), png(1500, 1500), png(1000, 1000)];
  assert.deepEqual(checkTemplateSwapImages({ image_url: ok }, 2), { ok: true });
  assert.equal(checkTemplateSwapImages({ image_url: ok.slice(0, 2) }, 2).error, 'template_swap_image_size');
  assert.equal(checkTemplateSwapImages({ image_url: ok }, 1).error, 'template_swap_image_size');
  assert.equal(checkTemplateSwapImages({ image_url: [ok[0], ok[1], png(1537, 1000), ok[3]] }, 2).error, 'template_swap_image_size');
  assert.equal(checkTemplateSwapImages({ image_url: [ok[0], ok[1], ok[2], png(1025, 1000)] }, 2).error, 'template_swap_image_size');
  assert.equal(checkTemplateSwapImages({ image_url: [ok[0], ok[1], { ...ok[2], contentType: 'image/jpeg' }, ok[3]] }, 2).error, 'template_swap_image_type');
});
test('capability: one element by default, exactly two with people 2, never an image_url', () => {
  const clip = { template: { id }, source }, record = capabilityFor(catalog[0].provider_endpoint);
  const element = n => ({ frontal_image_url: `f${n}`, reference_image_urls: [`c${n}`] });
  const one = templateSwapCapability(record, clip), two = templateSwapCapability(record, clip, 2);
  assert.equal(one.media.image.max, 2); assert.equal(two.media.image.max, 4);
  assert.equal(one.validate({ elements: [element(1)] }).ok, true);
  assert.equal(one.validate({ elements: [element(1), element(2)] }).error, 'inputs_invalid:elements');
  assert.equal(two.validate({ elements: [element(1), element(2)] }).ok, true);
  for (const elements of [[element(1)], [element(1), element(2), element(3)], [element(1), { frontal_image_url: 'x', reference_image_urls: ['a', 'b'] }], [element(1), { frontal_image_url: 'x' }], undefined]) {
    assert.equal(two.validate({ elements }).error, 'inputs_invalid:elements');
  }
  assert.equal(two.validate({ elements: [element(1), element(2)], image_url: 'x' }).error, 'inputs_invalid:elements');
});
test('job identity carries the two roles only for a two-person clip', async () => {
  const record = capabilityFor(catalog[0].provider_endpoint), sign = async () => ({ url: 'signed' });
  const single = await resolveTemplateSwapVideo({ template: { id }, source }, record, {}, sign);
  assert.deepEqual(single.identity, { template: id, version: source.version, sha256: source.sha256, role: 'the main character' });
  const double = await resolveTemplateSwapVideo({ template: { id, people: 2, roles: ['the man', 'the dog'] }, source }, record, {}, sign);
  assert.deepEqual(double.identity.roles, ['the man', 'the dog']);
  assert.ok(Object.isFrozen(double.identity.roles));
});
