import test from 'node:test';
import assert from 'node:assert/strict';
import * as React from 'react';
import { fixture } from './helpers/publicSiteRender.mjs';
import { LANDING_DRAFT_KEY } from '../app/veyrnox/_lib/landingDraft.js';
import { templateArrival } from '../app/veyrnox/_lib/templateDraft.js';

const original = { id: 'kling-2.6-pro-kie', name: 'Kling 2.6 Pro', modality: 'image-to-video', kind: 'video', credits: 17, aspects: ['16:9', '9:16'], durations: [5, 10] };
const other = { id: 'wan-2.5-kie', name: 'Wan 2.5', modality: 'image-to-video', kind: 'video', credits: 31, aspects: ['1:1', '4:5'], durations: [5] };
const preset = { id: 'exact-recipe', model: original.name, prompt: '  EXACT community prompt\nwith references.  ', sourcePromptOrigin: 'community-source-exact', sourcePromptRunnable: false, aspect: '9:16', durationSeconds: 10, negativePrompt: 'No distortion' };
function nodes(tree) {
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  return tree && typeof tree === 'object' ? [tree, ...nodes(tree.props?.children)] : [];
}
const select = (tree, label) => nodes(tree).find(node => node.type === 'select' && node.props['aria-label'] === label);
const button = tree => nodes(tree).find(node => node.type === 'button');
const options = node => nodes(node.props.children).filter(child => child.type === 'option').map(child => child.props.value);
function harness({ models = [other, original], live = true, template = preset, prompt = template.prompt } = {}) {
  const states = [];
  let index = 0;
  const pushed = [];
  const f = fixture('en', '/presets/exact-recipe', { moduleMocks: {
    react: { ...React, useState(initial) {
      const slot = index++;
      if (!(slot in states)) states[slot] = initial;
      return [states[slot], value => { states[slot] = value; }];
    } },
    '../../../components/I18nProvider.jsx': { useI18n: () => ({ t: (key, values) => values ? `${key}:${JSON.stringify(values)}` : key }) },
    '../_lib/useCatalog': { useCatalog: () => ({ models, live, loading: !live }) },
    'next/navigation': { useRouter: () => ({ push: href => pushed.push(href) }) },
  } });
  const { UseTemplate } = f.load('app/veyrnox/_components/UseTemplate.js');
  return { render: () => { index = 0; return UseTemplate({ preset: template, prompt }); }, pushed };
}

test('UseTemplate renders an enabled button and defaults for a non-runnable exact prompt', () => {
  const tree = harness().render();
  assert.equal(button(tree).props.disabled, false);
  assert.equal(select(tree, 'label.Model picker').props.value, original.id);
  assert.deepEqual(options(select(tree, 'label.Model picker')), [original.id, other.id]);
  assert.equal(select(tree, 'presets.use.aspect').props.value, '9:16');
  assert.equal(select(tree, 'presets.use.clipLength').props.value, 10);
  assert.deepEqual(options(select(tree, 'presets.use.clipLength')), [5, 10]);
  assert.match(JSON.stringify(button(tree)), /34/);
});

test('changing model updates ratio, seconds and live catalog cost; switching back restores template defaults', () => {
  const h = harness();
  select(h.render(), 'label.Model picker').props.onChange({ target: { value: other.id } });
  const tree = h.render();
  assert.deepEqual(options(select(tree, 'presets.use.aspect')), ['1:1', '4:5']);
  assert.equal(select(tree, 'presets.use.aspect').props.value, '4:5', 'nearest to template portrait');
  assert.deepEqual(options(select(tree, 'presets.use.clipLength')), [5]);
  assert.equal(select(tree, 'presets.use.clipLength').props.value, 5);
  assert.match(JSON.stringify(button(tree)), /31/);
  assert.match(JSON.stringify(select(tree, 'presets.use.clipLength')), /credits.*31/);
  select(tree, 'label.Model picker').props.onChange({ target: { value: original.id } });
  assert.equal(select(h.render(), 'presets.use.aspect').props.value, '9:16');
  assert.equal(select(h.render(), 'presets.use.clipLength').props.value, 10);
});

test('single/unknown/failed catalog hides model picker; empty ratios hide aspect picker', () => {
  for (const config of [
    { models: [original] }, { live: false }, { models: [{ ...original, modality: null }, other] },
    { models: [original, { ...other, modality: null }] },
    { models: [original, { ...other, modality: 'text-to-video' }] },
    ...['gated', 'premium', 'isEdit', 'takesPlan', 'takesTopic'].map(flag => ({ models: [original, { ...other, [flag]: true }] })),
  ]) {
    const tree = harness(config).render();
    assert.equal(select(tree, 'label.Model picker'), undefined, JSON.stringify(config));
    assert.equal(button(tree).props.disabled, false);
  }
  assert.equal(select(harness({ models: [{ ...original, aspects: [] }] }).render(), 'presets.use.aspect'), undefined);
  assert.equal(button(harness({ models: [] }).render()).props.disabled, true);
  assert.equal(button(harness({ models: [{ ...original, gated: true }] }).render()).props.disabled, true);
});

test('ratio defaults use nearest offered ratio, then first when none is recorded', () => {
  assert.equal(select(harness({ template: { ...preset, aspect: '4:5' } }).render(), 'presets.use.aspect').props.value, '9:16');
  assert.equal(select(harness({ template: { ...preset, aspect: null } }).render(), 'presets.use.aspect').props.value, '16:9');
});

test('handoff writes chosen model, aspect, seconds and exact prompt and also carries URL fallback', () => {
  const savedWindow = globalThis.window;
  try {
    const storage = new Map();
    globalThis.window = { sessionStorage: { setItem: (key, value) => storage.set(key, value) } };
    const h = harness();
    select(h.render(), 'label.Model picker').props.onChange({ target: { value: other.id } });
    select(h.render(), 'presets.use.aspect').props.onChange({ target: { value: '1:1' } });
    select(h.render(), 'presets.use.clipLength').props.onChange({ target: { value: '5' } });
    button(h.render()).props.onClick();
    const { at, ...draft } = JSON.parse(storage.get(LANDING_DRAFT_KEY));
    assert.ok(at);
    assert.deepEqual(draft, { prompt: preset.prompt, model: other.id, aspect: '1:1', durationSeconds: 5, negativePrompt: preset.negativePrompt, templateId: preset.id });
    const params = new URL(h.pushed[0], 'https://example.test').searchParams;
    assert.deepEqual(Object.fromEntries(params), { model: other.id, preset: preset.id, duration: '5s', aspect: '1:1' });
    assert.equal(button(h.render()).props.disabled, true, 'opening prevents another click');
    assert.equal(templateArrival(preset, [original, other], params, null).draft.prompt, preset.prompt);
  } finally { globalThis.window = savedWindow; }
});

test('blocked storage still navigates with exact prompt; unsaved personal edits report the existing error', () => {
  const savedWindow = globalThis.window;
  try {
    globalThis.window = { get sessionStorage() { throw Error('blocked'); } };
    const h = harness();
    button(h.render()).props.onClick();
    assert.equal(h.pushed.length, 1);
    const edited = harness({ prompt: 'A personal edit' });
    button(edited.render()).props.onClick();
    assert.equal(edited.pushed.length, 0);
    assert.ok(nodes(edited.render()).some(node => node.props?.role === 'alert'));
  } finally { globalThis.window = savedWindow; }
});

test('empty and over-limit prompts remain disabled', () => {
  for (const prompt of ['   ', 'x'.repeat(30001)]) assert.equal(button(harness({ prompt }).render()).props.disabled, true);
});

test('catalog normalization retains full modality and fallback does not guess it from kind', () => {
  const f = fixture('en', '/presets');
  const { fromApi, fromFallback } = f.load('app/veyrnox/_lib/useCatalog.js');
  const models = fromApi([{ id: 'text', modality: 'text-to-video' }, { id: 'image', modality: 'image-to-video', premium: true }]);
  assert.deepEqual(models.map(model => model.modality), ['text-to-video', 'image-to-video']);
  assert.deepEqual(models.map(model => model.kind), ['video', 'video']);
  assert.equal(models[1].gated, true);
  assert.ok(fromFallback().every(model => Object.hasOwn(model, 'modality')));
});
