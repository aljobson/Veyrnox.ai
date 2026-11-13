import test from 'node:test';
import assert from 'node:assert/strict';
import * as React from 'react';
import { fixture } from './helpers/publicSiteRender.mjs';
import { bind, imageSlots } from '../lib/templateBinding.js';
import { templatePhotoHints, templateContract } from '../lib/templateContract.js';
import { PRESETS } from '../app/veyrnox/_lib/templates.js';
for (const [source, slots] of [
  ['frame image 2 meters wide', []], ['image 2 of the set', []], ['Image 2 of the set', []],
  ['Image 2 meters wide', []], ['Image 2 - 3 meters wide', []], ['Image 16:9', []],
  ['Image 2: the car', [2]], ['Image 9 — person', [9]], ['Image 1 - product', [1]],
  ['@IMAGE_2 person', [2]], ['<<<IMAGE_5>>>', [5]],
]) test(`reviewed image grammar: ${source}`, () => assert.deepEqual(imageSlots(source), slots));
test('ambiguous capital references prevent a partial binding', () => {
  assert.equal(bind('Image 1: clothes. Use the face from Image 2.', 1).error, 'unmapped-image-reference');
});
test('renumbered slots show original surrounding source text on every web photo control', () => {
  const source = 'The silver car belongs to @image2, parked beside the tree. The red bicycle is @image1, under the lamp.';
  const binding = bind(source, 2);
  const contract = { class: 'bound', sourcePrompt: source, tokenMap: binding.map, slotCount: 2 };
  const hints = templatePhotoHints(contract);
  assert.equal(hints.length, 2);
  assert.match(hints[0], /silver car.*@image2/);
  assert.match(hints[1], /red bicycle.*@image1/);
  const f = fixture('en', '/app/create');
  const html = f.render(React.createElement(f.load('app/veyrnox/_components/TemplatePhotoSlots.js').TemplatePhotoSlots, { count: 2, hints, files: [], onChange() {}, onBusy() {} }));
  for (const hint of hints) assert.ok(html.includes(hint));
  assert.deepEqual(templatePhotoHints({ ...contract, sourcePrompt: '@image1 @image2', tokenMap: bind('@image1 @image2', 2).map }), ['@image1 @image2', '@image1 @image2']);
});
test('every real bound contract supplies a nonempty hint for every slot', () => {
  let count = 0;
  for (const p of PRESETS) {
    const c = templateContract(p.id);
    if (c?.class !== 'bound') continue;
    count++;
    assert.equal(templatePhotoHints(c).length, c.slotCount, p.id);
    assert.ok(templatePhotoHints(c).every(hint => hint.length > 0), p.id);
  }
  assert.ok(count > 0);
});
test('canonical slots show their role hints on web within the original excerpt limit', () => {
  const source = 'The silver car is @image1. The red bicycle is @image2.';
  const hints = templatePhotoHints({ class: 'bound', slotCount: 2, sourcePrompt: source, tokenMap: bind(source, 2).map });
  assert.equal(hints.length, 2);
  assert.match(hints[0], /silver car/);
  assert.match(hints[1], /red bicycle/);
  const f = fixture('en', '/app/create');
  const html = f.render(React.createElement(f.load('app/veyrnox/_components/TemplatePhotoSlots.js').TemplatePhotoSlots, { count: 2, hints, files: [], onChange() {}, onBusy() {} }));
  for (const hint of hints) { assert.ok(html.includes(hint)); assert.ok(hint.length <= 87); }
});
