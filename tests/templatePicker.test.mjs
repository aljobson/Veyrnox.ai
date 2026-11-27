import { fromFallback } from '../app/veyrnox/_lib/useCatalog.js';
import { englishAppImports } from './helpers/appI18nStub.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import * as createTemplates from '../app/veyrnox/_lib/createTemplates.js';
import * as runnableTemplates from '../app/veyrnox/_lib/runnableTemplates.js';
import * as tokens from '../app/veyrnox/_lib/tokens.js';
import { templateById } from '../app/veyrnox/_lib/templates.js';
import { templateCards, templateDetail } from '../lib/clientTemplates.js';
import { templateStartId } from '../lib/templateStart.js';
import { internalModelId } from '../lib/publicModelIds.js';

const require = createRequire(import.meta.url);
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const local = {
  'next/link': ({ href, children, ...props }) => createElement('a', { href, ...props }, children),
  '../_lib/createTemplates.js': createTemplates,
  '../_lib/runnableTemplates.js': runnableTemplates,
  '../_lib/tokens.js': tokens,
  '../_lib/useTemplates.js': { useTemplateCards: () => ({ templates: [], categories: ['ALL', 'NEW'], ready: false }) },
  './Modal': { Modal: ({ children, onCancel, initialFocusRef, ...labels }) => createElement('dialog', { open: true, ...labels }, children) },
};
const compiledModule = { exports: {} };
const compiled = ts.transpileModule(read('app/veyrnox/_components/TemplatePicker.js'), {
  compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
}).outputText;
new Function('require', 'module', 'exports', compiled)((id) => local[id] || englishAppImports[id.replace('../../../', '../../../../').replace(/\.jsx$/, '')] || require(id), compiledModule, compiledModule.exports);

const models = fromFallback();
const renderPicker = (goal, catalog = models, galleryCards) => renderToStaticMarkup(createElement(compiledModule.exports.TemplatePicker, { models: catalog, goal, galleryCards, onPick() {}, onClose() {} }));
const templateButtons = (html) => [...html.matchAll(/data-testid="create-template-(?!picker)[^"]+"/g)].length;

test('the curated Create catalog has valid image and audio templates, no video, and bundled previews', () => {
  assert.equal(createTemplates.CREATE_TEMPLATES.length, 9);
  assert.equal(new Set(createTemplates.CREATE_TEMPLATES.map((item) => item.id)).size, 9);
  for (const kind of createTemplates.CREATE_TEMPLATE_KINDS) {
    const choices = createTemplates.createTemplatesFor(kind);
    assert.equal(choices.length, { video: 0, image: 3, audio: 6 }[kind]);
    for (const choice of choices) {
      assert.equal(models.find((model) => model.id === tokens.templateModelId(choice))?.kind, kind);
      assert.equal(templateById(choice.id), null);
      // The answer names the model by its supplier-neutral public id (lib/publicModelIds.js); it maps back to the catalog key.
      assert.equal(internalModelId(templateDetail(choice.id)?.modelId), tokens.templateModelId(choice));
      assert.equal(templateStartId(choice.id, tokens.templateModelId(choice)), null);
      assert.equal(templateStartId(choice.id, 'wrong-model'), null);
      assert.ok(choice.prompt.length > 40);
      assert.ok(existsSync(new URL(`../public${choice.previewImage}`, import.meta.url)), choice.previewImage);
      if (kind === 'audio') assert.equal(choice.durationSeconds, undefined);
      if (kind === 'video') assert.equal(choice.clipKey, undefined);
      if (kind !== 'audio') assert.match(choice.previewImage, /^\/(?:showcase|cinema)\//);
    }
  }
  assert.ok(createTemplates.createTemplatesFor('audio').every((choice) => choice.model === 'Suno Sound Effects'));
});

test('Create lists the gallery video templates, each with its poster and a link to the gallery', () => {
  const cards = templateCards();
  const video = cards.filter((card) => card.kind !== 'image');
  const runnable = runnableTemplates.runnableTemplates(video, models, 'video');
  assert.ok(runnable.length >= 20, `only ${runnable.length} runnable video templates`);
  const html = renderPicker('video', models, cards);
  assert.match(html, /<dialog[^>]*aria-labelledby="create-template-picker-title"/);
  assert.equal(templateButtons(html), runnable.length);
  assert.match(html, new RegExp(`TEMPLATES · ${runnable.length}`));
  assert.doesNotMatch(html, /create-template-picker-empty/);
  assert.match(html, /<video src="\/showcase\/[^"]+\.mp4" poster="\/showcase\/[^"]+\.jpg" controls=""/);
  assert.match(html, /href="\/app\/templates"[^>]*>Open the template gallery</);
  assert.ok(runnable.every(({ model }) => model.kind === 'video'));
});

test('the video picker says it is loading until the gallery answers, and points to the gallery when it cannot', () => {
  const loading = renderPicker('video');
  assert.match(loading, /data-testid="create-template-picker-loading"/);
  assert.match(loading, /Loading templates…/);
  assert.doesNotMatch(loading, /create-template-picker-empty/);
  const failed = renderPicker('video', models, []);
  assert.match(failed, /data-testid="create-template-picker-empty"/);
  assert.match(failed, /href="\/app\/templates"[^>]*>Open the template gallery</);
});

test('the picker keeps failures visible and prevents duplicate picks while loading', () => {
  const html = renderToStaticMarkup(createElement(compiledModule.exports.TemplatePicker, {
    models,
    goal: 'image',
    busy: true,
    error: 'Template unavailable. Choose another or try again later.',
    onPick() {},
    onClose() {},
  }));
  assert.match(html, /data-testid="create-template-picker-error"/);
  assert.match(html, /role="alert"/);
  assert.match(html, /Template unavailable\. Choose another or try again later\./);
  assert.equal([...html.matchAll(/<button[^>]* disabled=""/g)].length, 3);
});

test('Create offers exactly three image templates using bundled Veyrnox images', () => {
  const html = renderPicker('image');
  assert.match(html, /TEMPLATES · 3/);
  assert.equal(templateButtons(html), 3);
  for (const source of ['cinematic-portrait.webp', 'hotel-corridor.webp', 'ripple-light-portrait.webp']) assert.match(html, new RegExp(source));
});

test('Create offers six runnable Sound Effects templates without retired music previews', () => {
  const html = renderPicker('audio');
  assert.match(html, /TEMPLATES · 6/);
  assert.equal(templateButtons(html), 6);
  assert.equal([...html.matchAll(/<audio /g)].length, 0);
  assert.match(html, /Suno Sound Effects · 2 credits/);
  assert.match(html, /City Rain Window/);
  assert.match(html, /Ocean Loop/);
  assert.match(html, /href="\/app\/music\/sounds"/);
});

test('templates whose models are unavailable are omitted', () => {
  const html = renderPicker('image', []);
  assert.equal(templateButtons(html), 0);
  assert.match(html, /data-testid="create-template-picker-empty"/);
  assert.doesNotMatch(html, /Model unavailable/);
});

test('template metadata keeps human model names and grammatically correct credit labels', () => {
  const image = renderPicker('image');
  assert.match(image, /Nano Banana · 2 credits/);
  assert.doesNotMatch(image, /2 credit(?!s)/);
});

test('the all-goal picker follows the currently selected model kind', () => {
  const html = renderToStaticMarkup(createElement(compiledModule.exports.TemplatePicker, { models, goal: 'all', selectedKind: 'audio', onPick() {}, onClose() {} }));
  assert.equal(templateButtons(html), 6);
  assert.equal([...html.matchAll(/<audio /g)].length, 0);
});

test('Create loads every medium through the same template handoff', () => {
  const page = read('app/veyrnox/app/create/page.js');
  assert.match(page, /<TemplatePicker models=\{models\} goal=\{goal\} selectedKind=\{model\?\.kind\} onPick=\{applyTemplate\}/);
  assert.match(page, /const preset = await fetchTemplate\(card\.id\)/);
  assert.doesNotMatch(page, /async function applyTemplate\(card\) \{\n\s+setTemplatesOpen\(false\)/);
  assert.match(page, /if \(!preset \|\| !nextModel \|\| !draft\) \{ setTemplatePickError\(t\('presets\.swap\.unavailable'\)\); return; \}/);
});

test('Create-only template handoffs do not link to missing public preset pages', () => {
  const handoff = read('app/veyrnox/_components/TemplateHandoffCard.js');
  assert.ok(createTemplates.CREATE_TEMPLATES.every((choice) => choice.createOnly));
  assert.match(handoff, /!preset\.createOnly && <Link href=\{`\/presets\/\$\{encodeURIComponent\(preset\.id\)\}`\}/);
});
