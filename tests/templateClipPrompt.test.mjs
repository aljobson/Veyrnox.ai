import test from 'node:test';
import assert from 'node:assert/strict';
import { TEMPLATE_CLIP_PROMPT, templateClipSegments, templateClipPhotoPrompt, normalizeTemplateClipPrompt, validTemplateClipPrompt, templateClipProviderPrompt } from '../lib/templateClipPrompt.mjs';
import { clipInlineEligible, inlineBlockReason, templateRun } from '../app/veyrnox/_lib/templateGenerate.js';

const valid = '@video1 with @image1';
test('token parsing and serialization preserve every editable character', () => {
  for (const text of [TEMPLATE_CLIP_PROMPT, '雪 @VIDEO1\n person @IMAGE1!', 'a@video1 @image1_suffix']) {
    const segments = templateClipSegments(text);
    assert.equal(segments.map(s => s.token ?? s.text).join(''), text.replace(/@VIDEO1/g, '@video1').replace(/@IMAGE1/g, '@image1'));
  }
});
test('whole Unicode tokens, case, duplicates and the 2000 character boundary', () => {
  for (const text of [valid, '@VIDEO1\n@Image1', valid + '.' + 'x'.repeat(1999 - valid.length)]) assert.equal(validTemplateClipPrompt(text), true);
  for (const text of ['', '@video1', '@image1', '@video1 @image1 @VIDEO1', '@@video1 @image1', 'é@video1 @image1', '@video10 @image1', '@video1_ @image1', '@video1 @image1字', valid + '.' + 'x'.repeat(2000 - valid.length), {}, null]) assert.equal(validTemplateClipPrompt(text), false);
});
test('photo attachment and removal retain edits and restore the default insertion point', () => {
  const empty = templateClipPhotoPrompt(TEMPLATE_CLIP_PROMPT, false);
  assert.equal(templateClipSegments(empty).filter(s => s.token).length, 1);
  assert.equal(templateClipPhotoPrompt(empty, true), TEMPLATE_CLIP_PROMPT);
  const edited = templateClipPhotoPrompt('Follow @video1. Use @image1, slowly.', false);
  assert.equal(edited, 'Follow @video1. Use , slowly.');
  assert.equal(validTemplateClipPrompt(templateClipPhotoPrompt(edited, true)), true);
  assert.equal(templateClipPhotoPrompt(valid, true), valid);
});
for (const model of ['seedance-2.0-reference', 'seedance-2.0-reference-kie']) test(`${model} maps tokens once after shared normalization`, () => {
  assert.equal(templateClipProviderPrompt('  Follow  @VIDEO1\nwith @IMAGE1.  ', model), 'Follow @Video1 with @Image1.');
  assert.equal(templateClipProviderPrompt('', model), templateClipProviderPrompt(undefined, model));
  assert.equal(templateClipProviderPrompt('no tags', model), null);
});
test('clip eligibility bypasses audio/video needs but still requires the projected usable model', () => {
  const preset = { id: 'seedance-birthday-morning', needs: 'preserved audio and video' };
  const model = { id: 'seedance-2.0-reference', kind: 'video', inputs: { prompt: {} }, media: { image: { required: true } } };
  const clip = { id: preset.id, model: model.id };
  assert.equal(inlineBlockReason(preset, model, { photo: true }), 'media');
  assert.equal(clipInlineEligible(clip, model), true);
  for (const override of [{ gated: true }, { premium: true }, { id: 'another' }]) assert.equal(clipInlineEligible(clip, { ...model, ...override }), false);
  assert.equal(clipInlineEligible(null, model), false);
});
test('normalized client prompt, template and selected model bind continuation keys', () => {
  let n = 0;
  const identity = (prompt = valid, template = 'template', model = 'seedance-2.0-reference') => JSON.stringify([model, normalizeTemplateClipPrompt(prompt), template]);
  const first = templateRun(null, identity(), 85, () => String(++n));
  first.confirm = true; first.quote = { total: 85 };
  assert.equal(templateRun(first, identity('  @VIDEO1  with @IMAGE1 '), 85, () => String(++n)), first);
  for (const changed of [identity(valid + '.'), identity(valid, 'another'), identity(valid, 'template', 'seedance-2.0-reference-kie')]) {
    const next = templateRun(first, changed, 85, () => String(++n));
    assert.notDeepEqual(next.keys, first.keys); assert.equal(next.confirm, undefined); assert.equal(next.quote, undefined);
  }
});
