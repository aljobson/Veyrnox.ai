import { englishAppImports } from './helpers/appI18nStub.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import * as templates from '../app/veyrnox/_lib/templates.js';
import * as tokens from '../app/veyrnox/_lib/tokens.js';
import * as runnable from '../app/veyrnox/_lib/runnableTemplates.js';
import * as audioTemplates from '../app/veyrnox/_lib/audioTemplates.js';
import * as handoff from '../app/veyrnox/_lib/templateHandoff.js';
import { templateCards } from '../lib/clientTemplates.js';

const require = createRequire(import.meta.url);
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const local = { '../_lib/audioTemplates': audioTemplates, '../_lib/tokens.js': tokens, '../_lib/runnableTemplates.js': runnable, '../_lib/templateHandoff.js': handoff, '../_lib/useTemplates': { useTemplateCards: () => ({ templates: templateCards(), categories: [], ready: true }), useTemplateSearch: (cards) => cards }, './TemplateArtwork': { TemplateArtwork: () => null }, './Modal': { Modal: ({ children, onCancel, initialFocusRef, ...labels }) => createElement('dialog', { open: true, ...labels }, children) } };
const module = { exports: {} };
const compiled = ts.transpileModule(read('app/veyrnox/_components/TemplatePicker.js'), {
  compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS },
}).outputText;
new Function('require', 'module', 'exports', compiled)((id) => local[id] || englishAppImports[id.replace('../../../', '../../../../').replace(/\.jsx$/, '')] || require(id), module, module.exports);

const preset = templates.PRESETS.find((p) => tokens.modelIdForName(p.model));
const models = [{ id: tokens.modelIdForName(preset.model), name: preset.model, kind: 'video' }];

test('the Create template picker lists runnable templates as buttons that name the template', () => {
  const html = renderToStaticMarkup(createElement(module.exports.TemplatePicker, { models, goal: 'video', onPick() {}, onClose() {} }));
  assert.match(html, /<dialog[^>]*aria-labelledby="create-template-picker-title"/);
  assert.match(html, /TEMPLATES/);
  assert.match(html, /Search templates/);
  assert.ok(html.includes(`data-testid="create-template-${preset.id}"`));
  assert.ok(html.includes(`aria-label="Use ${tokens.presetTitle(preset.name)}"`));
});

test('with no runnable model the picker says so instead of listing templates', () => {
  const html = renderToStaticMarkup(createElement(module.exports.TemplatePicker, { models: [], goal: 'image', onPick() {}, onClose() {} }));
  assert.match(html, /No templates match\./);
  assert.doesNotMatch(html, /data-testid="create-template-(?!picker")/);
});

const audio = audioTemplates.AUDIO_TEMPLATES[0];
const renderPicker = (props) => renderToStaticMarkup(createElement(module.exports.TemplatePicker, { onPick() {}, onPickAudio() {}, onClose() {}, ...props }));

test('the picker keeps video and audio templates on separate tabs', () => {
  const html = renderPicker({ models, goal: 'video' });
  assert.match(html, /data-testid="create-kind-video"/);
  assert.match(html, /data-testid="create-kind-audio"/);
  assert.doesNotMatch(html, /data-testid="create-template-audio-/);
});

test('the audio tab lists audio templates only, and only those whose model is offered', () => {
  const html = renderPicker({ models: [{ id: audio.modelId, name: 'm', kind: 'audio' }], goal: 'audio' });
  assert.ok(html.includes(`data-testid="create-template-${audio.id}"`));
  assert.doesNotMatch(html, new RegExp(`data-testid="create-template-${preset.id}"`));
  const none = renderPicker({ models: [{ id: 'unrelated-model', name: 'x', kind: 'audio' }], goal: 'audio' });
  assert.match(none, /No templates match\./);
  assert.doesNotMatch(none, /data-testid="create-template-audio-/);
});

test('create wires an audio pick to applyAudioTemplate and clears animation-only state', () => {
  const page = read('app/veyrnox/app/create/page.js');
  assert.match(page, /onPickAudio=\{applyAudioTemplate\}/);
  const fn = page.slice(page.indexOf('function applyAudioTemplate'), page.indexOf('async function applyTemplate'));
  assert.match(fn, /setAnimationPortrait\(null\)/);
  assert.match(fn, /chooseModel\(tpl\.modelId\)/);
  assert.match(fn, /setPrompt\(tpl\.prompt\)/);
});
