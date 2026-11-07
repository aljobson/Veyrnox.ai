import test from 'node:test';
import assert from 'node:assert/strict';
import * as React from 'react';
import ts from 'typescript';
import { readFileSync } from 'node:fs';
import { fixture } from './helpers/publicSiteRender.mjs';
import { bind, imageSlots } from '../lib/templateBinding.js';
import { templateVideoDependency } from '../lib/templateVideoDependency.js';
import { templateContract } from '../lib/templateContract.js';
import { PRESETS } from '../app/veyrnox/_lib/templates.js';
import { writeTemplateMediaHandoff, takeTemplateMediaHandoff } from '../app/veyrnox/_lib/templateMediaHandoff.js';
import { settingsInputs } from '../app/veyrnox/_lib/generationSettings.js';

for (const prose of ['image 16:9', 'image 2 seconds', 'image 4k', 'image 2048 px', 'frame image 2 meters wide', 'image 2 of the set', 'Image 2 of the set', 'Image 2 meters wide', 'image 2: a caption', 'Image 16:9', 'Image 2 - 3 meters wide']) {
  test(`bare image prose is not a slot: ${prose}`, () => {
    assert.deepEqual(imageSlots(prose), []);
    assert.equal(bind(`@image1 ${prose}`, 1).text, `@Image1 ${prose}`);
  });
}
for (const prose of ['a video 5 seconds long', 'video 2 of the series', 'video 16:9', 'video 4k']) {
  test(`bare video prose is not a dependency: ${prose}`, () => assert.equal(templateVideoDependency(prose), false));
}
test('numbered role headings remain slots and dependencies', () => {
  assert.equal(bind('Image 5: the car', 1).text, '@Image1: the car');
  assert.equal(templateVideoDependency('Video 2: copy its motion'), true);
});
test('N-photo handoff is bounded, ordered, memory-only and single-use', () => {
  for (let count = 1; count <= 9; count++) {
    const images = Array.from({ length: count }, (_, i) => new Blob([`${i}`], { type: 'image/png' }));
    const target = {};
    const input = { templateId: 'epic-train-doorway-scene', modelId: 'seedance-2.0-reference', images };
    assert.equal(writeTemplateMediaHandoff(target, input), true);
    assert.deepEqual(takeTemplateMediaHandoff(target, input.templateId, input.modelId), { images });
    assert.equal(takeTemplateMediaHandoff(target, input.templateId, input.modelId), null);
  }
  for (const images of [[], Array(10).fill(new Blob(['x'], { type: 'image/png' })), [null], [new Blob(['x'], { type: 'video/mp4' })]]) {
    assert.equal(writeTemplateMediaHandoff({}, { templateId: 'test', modelId: 'seedance-2.0-reference', images }), false);
  }
});
test('web slots have required labels, empty state, focus and touch targets, without reorder', () => {
  const f = fixture('en', '/app/create');
  const Component = f.load('app/veyrnox/_components/TemplatePhotoSlots.js').TemplatePhotoSlots;
  for (let count = 1; count <= 9; count++) {
    const html = f.render(React.createElement(Component, { count, files: [], onChange() {}, onBusy() {} }));
    assert.equal((html.match(/type="file"/g) || []).length, count);
    assert.ok(html.includes(`Fill all ${count} photo slots`));
    for (let i = 1; i <= count; i++) assert.ok(html.includes(`aria-label="Photo ${i}:`));
    assert.match(html, /min-h-11/); assert.match(html, /focus-within:outline/); assert.match(html, /role="status"/);
    assert.doesNotMatch(html, /Move earlier|Move later|vx-press|animate-/);
  }
});
for (const mode of ['valid', 'small', 'decode-failure', 'bad-type', 'oversize', 'replace', 'remove', 'stale']) {
  test(`web fixed slot pick: ${mode}`, async () => {
    const source = readFileSync('app/veyrnox/_components/TemplatePhotoSlots.js', 'utf8');
    const ast = ts.createSourceFile('slots.js', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JSX);
    let pick;
    const visit = node => { if (ts.isFunctionDeclaration(node) && node.name?.text === 'pick') pick = node.getText(ast); ts.forEachChild(node, visit); }; visit(ast);
    const other = { name: 'third.png' }, files = [null, { name: 'old.png' }, other], state = { errors: {}, busy: {} }, runs = { current: {} };
    let closed = 0;
    const file = { name: 'new.png' };
    const context = { runs, setErrors: fn => { state.errors = fn(state.errors); }, setBusy: fn => { state.busy = fn(state.busy); }, onBusy() {}, onChange: (i, value) => { files[i] = value; },
      templateImageFileError: () => mode === 'bad-type' || mode === 'oversize' ? 'invalid' : '',
      prepareUpload: async file => { if (mode === 'stale') runs.current[1] = {}; return file; },
      createImageBitmap: async () => { if (mode === 'decode-failure') throw Error('decode'); return { width: mode === 'small' ? 255 : 256, height: 256, close() { closed++; } }; },
    };
    await new Function('context', `with(context) { return (${pick}); }`)(context)(1, mode === 'remove' ? null : file);
    assert.equal(files[2], other, 'later slot stays in place');
    assert.equal(files[1], ['valid', 'decode-failure', 'replace'].includes(mode) ? file : null);
    if (mode === 'small') assert.equal(state.errors[1], 'presets.fidelity.photoMinimum');
    if (mode === 'bad-type' || mode === 'oversize') assert.equal(state.errors[1], 'presets.use.photoInvalid');
    assert.equal(closed, ['valid', 'small', 'replace'].includes(mode) ? 1 : 0);
  });
}
test('prose-only blocked detail renders its blocked note without a live catalog', async () => {
  const preset = PRESETS.find(p => p.id === 'community-driver-portrait');
  assert.equal(templateContract(preset.id).class, 'blocked-needs-video');
  assert.equal(templateContract(preset.id).videoCount, 0);
  const f = fixture('en', '/presets/' + preset.id);
  const html = f.render(React.createElement(f.load('app/veyrnox/_components/TemplateRecipe.js').TemplateRecipe, { preset }));
  assert.match(html, /data-source-unsupported/);
  const page = f.render(await f.load('app/veyrnox/presets/[id]/page.js').default({ params: Promise.resolve({ id: preset.id }) }));
  assert.match(page, /data-source-unsupported/);
});
test('custom web settings retain base bytes, including long negative prompts', () => {
  const negative = `  ${'blur '.repeat(600)}  `;
  assert.equal(settingsInputs({ takesNegative: true, negativeMax: 500 }, { seed: '', negative }).negative_prompt, negative.trim());
});

test('actual web Create preparation accepts only exactly N filled slots for every bound contract', async () => {
  const { templateBoundPrompt, fidelityTemplateId, templatePhotoError } = await import('../lib/templateContract.js');
  const { sourceList } = await import('../lib/generationSourceSlots.mjs');
  const { templateInputs } = await import('../app/veyrnox/_lib/templateGenerate.js');
  const { templateModelId, presetHref, MODELS } = await import('../app/veyrnox/_lib/tokens.js');
  const { nearestOption } = await import('../lib/aspectShapes.mjs');
  const { templateArrival } = await import('../app/veyrnox/_lib/templateDraft.js');
  const { fallbackCapabilitiesFor } = await import('../lib/fallbackModelCapabilities.js');
  const source = readFileSync('app/veyrnox/app/create/page.js', 'utf8');
  const ast = ts.createSourceFile('create.js', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JSX);
  let prepare;
  const visit = node => { if (ts.isVariableDeclaration(node) && node.name.getText(ast) === 'prepareTemplateRun') prepare = node.initializer.arguments[0].getText(ast); ts.forEachChild(node, visit); }; visit(ast);
  let tested = 0;
  for (const preset of PRESETS) {
    const c = templateContract(preset.id); if (c?.class !== 'bound') continue;
    tested++;
    const modelId = templateModelId(preset), cap = fallbackCapabilitiesFor(modelId);
    const model = { ...MODELS.find(m => m.id === modelId), media: cap.media, aspects: cap.inputs.aspect_ratio.values };
    const arrival = templateArrival(preset, [model], new URL(presetHref(preset), 'https://test').searchParams, null);
    assert.equal(arrival.modelId, c.modelId);
    assert.equal(nearestOption(arrival.draft.aspect, model.aspects) || model.aspects[0], c.aspect, c.id);
    const inputs = templateInputs(preset, model, { prompt: arrival.draft.prompt, aspect: c.aspect, aspectOptions: model.aspects, durationSeconds: c.duration });
    for (const count of [0, c.slotCount - 1, c.slotCount, c.slotCount + 1]) {
      const context = { photoContract: c, fidelity: c, templateImageCount: count, sources: { image: Array.from({ length: count }, (_, i) => ({ file: new Blob([String(i)], { type: 'image/png' }) })) }, sourceList, templateBoundPrompt, fidelityTemplateId, templatePhotoError,
        t: key => key, setAttachNotice() {}, uneditedTemplate: true, cinemaOn: false, characterOn: false, modelId,
        createImageBitmap: async () => ({ width: 256, height: 256, close() {} }) };
      const run = new Function('context', `with(context) { return (${prepare}); }`)(context);
      if (count === c.slotCount) assert.equal(await run({ ...inputs }), c.id);
      else await assert.rejects(run({ ...inputs }), { code: 'template_references_invalid' });
    }
  }
  assert.equal(tested, 162);
});
