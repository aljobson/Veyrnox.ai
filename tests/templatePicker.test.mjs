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
import * as tokens from '../app/veyrnox/_lib/tokens.js';
import { templateById } from '../app/veyrnox/_lib/templates.js';
import { templateDetail } from '../lib/clientTemplates.js';
import { templateStartId } from '../lib/templateStart.js';
import { LICENSED_MUSIC_BASE, LICENSED_MUSIC_TRACKS } from '../lib/licensedMusicCatalog.js';

const require = createRequire(import.meta.url);
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const local = {
  'next/link': ({ href, children, ...props }) => createElement('a', { href, ...props }, children),
  '../_lib/createTemplates.js': createTemplates,
  '../_lib/tokens.js': tokens,
  './Modal': { Modal: ({ children, onCancel, initialFocusRef, ...labels }) => createElement('dialog', { open: true, ...labels }, children) },
};
const compiledModule = { exports: {} };
const compiled = ts.transpileModule(read('app/veyrnox/_components/TemplatePicker.js'), {
  compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
}).outputText;
new Function('require', 'module', 'exports', compiled)((id) => local[id] || englishAppImports[id.replace('../../../', '../../../../').replace(/\.jsx$/, '')] || require(id), compiledModule, compiledModule.exports);

const models = fromFallback();
const renderPicker = (goal, catalog = models) => renderToStaticMarkup(createElement(compiledModule.exports.TemplatePicker, { models: catalog, goal, onPick() {}, onClose() {} }));
const templateButtons = (html) => [...html.matchAll(/data-testid="create-template-(?!picker)[^"]+"/g)].length;

test('the curated Create catalog has three valid templates per medium and bundled previews', () => {
  assert.equal(createTemplates.CREATE_TEMPLATES.length, 9);
  assert.equal(new Set(createTemplates.CREATE_TEMPLATES.map((item) => item.id)).size, 9);
  for (const kind of createTemplates.CREATE_TEMPLATE_KINDS) {
    const choices = createTemplates.createTemplatesFor(kind);
    assert.equal(choices.length, 3);
    for (const choice of choices) {
      assert.equal(models.find((model) => model.id === tokens.templateModelId(choice))?.kind, kind);
      assert.equal(templateById(choice.id), null);
      assert.equal(templateDetail(choice.id)?.modelId, tokens.templateModelId(choice));
      assert.equal(templateStartId(choice.id, tokens.templateModelId(choice)), null);
      assert.equal(templateStartId(choice.id, 'wrong-model'), null);
      assert.ok(choice.prompt.length > 40);
      assert.ok(existsSync(new URL(`../public${choice.previewImage}`, import.meta.url)), choice.previewImage);
      if (kind === 'audio') assert.ok(existsSync(new URL(`../public${choice.previewAudio}`, import.meta.url)), choice.previewAudio);
      if (kind === 'audio') assert.equal(choice.durationSeconds, undefined);
      if (kind === 'video') assert.equal(choice.clipKey, undefined);
      if (kind !== 'audio') assert.match(choice.previewImage, /^\/(?:showcase|cinema)\//);
    }
  }
  for (const choice of createTemplates.createTemplatesFor('audio')) {
    const track = LICENSED_MUSIC_TRACKS.find((item) => item.id === choice.licensedTrackId);
    assert.ok(track, choice.licensedTrackId);
    assert.equal(choice.previewAudio, `${LICENSED_MUSIC_BASE}${track.file}`);
    assert.equal(choice.previewImage, `${LICENSED_MUSIC_BASE}${track.artwork}`);
    assert.equal(choice.previewAttribution, track.attribution);
    assert.equal(choice.previewSourceUrl, track.sourceUrl);
    assert.equal(choice.previewLicenseUrl, track.licenseUrl);
  }
});

test('Create offers exactly three curated video templates', () => {
  const html = renderPicker('video');
  assert.match(html, /<dialog[^>]*aria-labelledby="create-template-picker-title"/);
  assert.match(html, /TEMPLATES · 3/);
  assert.equal(templateButtons(html), 3);
  for (const title of ['CCTV Night', 'Sunset Drift', 'Rainy Taxi']) assert.match(html, new RegExp(title));
  assert.doesNotMatch(html, /Search templates/);
});

test('Create offers exactly three image templates using bundled Veyrnox images', () => {
  const html = renderPicker('image');
  assert.match(html, /TEMPLATES · 3/);
  assert.equal(templateButtons(html), 3);
  for (const source of ['cinematic-portrait.webp', 'hotel-corridor.webp', 'ripple-light-portrait.webp']) assert.match(html, new RegExp(source));
});

test('Create offers exactly three audio templates with real licensed song previews', () => {
  const html = renderPicker('audio');
  assert.match(html, /TEMPLATES · 3/);
  assert.equal(templateButtons(html), 3);
  assert.equal([...html.matchAll(/<audio /g)].length, 3);
  for (const source of ['midnight-theme-cdk-mix.mp3', 'scott-buckley-amberlight.mp3', 'scott-buckley-rise-above.mp3']) assert.match(html, new RegExp(source));
  assert.match(html, /CC BY 3\.0/);
  assert.match(html, /CC BY 4\.0/);
  assert.match(html, /Only a style direction is used/);
  assert.ok(html.includes('href="https://ccmixter.org/files/cdk/14246"'));
  assert.ok(html.includes('href="https://soundcloud.com/scottbuckley/amberlight-cc-by"'));
  assert.match(html, /href="\/app\/music\/discover"/);
});

test('the three choices remain visible but disabled when their models are unavailable', () => {
  const html = renderPicker('image', []);
  assert.equal(templateButtons(html), 3);
  assert.equal([...html.matchAll(/Model unavailable/g)].length, 6);
  assert.equal([...html.matchAll(/ disabled=""/g)].length, 3);
});

test('template metadata keeps human model names and grammatically correct credit labels', () => {
  const videoWithoutLiveCatalog = renderPicker('video', []);
  assert.match(videoWithoutLiveCatalog, /Wan 2\.5 · 17 credits/);
  assert.doesNotMatch(videoWithoutLiveCatalog, /wan-2\.5-kie/);
  assert.doesNotMatch(videoWithoutLiveCatalog, />\s*· 17 credits/);

  const image = renderPicker('image');
  assert.match(image, /Nano Banana · 1 credit/);
  assert.doesNotMatch(image, /1 credits/);
});

test('the all-goal picker follows the currently selected model kind', () => {
  const html = renderToStaticMarkup(createElement(compiledModule.exports.TemplatePicker, { models, goal: 'all', selectedKind: 'audio', onPick() {}, onClose() {} }));
  assert.equal(templateButtons(html), 3);
  assert.equal([...html.matchAll(/<audio /g)].length, 3);
});

test('Create loads every medium through the same template handoff', () => {
  const page = read('app/veyrnox/app/create/page.js');
  assert.match(page, /<TemplatePicker models=\{models\} goal=\{goal\} selectedKind=\{model\?\.kind\} onPick=\{applyTemplate\}/);
  assert.match(page, /const preset = await fetchTemplate\(card\.id\)/);
});

test('Create-only template handoffs do not link to missing public preset pages', () => {
  const handoff = read('app/veyrnox/_components/TemplateHandoffCard.js');
  assert.ok(createTemplates.CREATE_TEMPLATES.every((choice) => choice.createOnly));
  assert.match(handoff, /!preset\.createOnly && <Link href=\{`\/presets\/\$\{encodeURIComponent\(preset\.id\)\}`\}/);
});
