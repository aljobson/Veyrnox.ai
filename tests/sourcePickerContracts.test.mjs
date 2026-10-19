import { englishAppImports } from './helpers/appI18nStub.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import * as slots from '../lib/generationSourceSlots.mjs';
import { mediaGenerationSources } from '../app/veyrnox/_lib/chatMedia.js';

const require = createRequire(import.meta.url);
const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const module = { exports: {} };
const compiled = ts.transpileModule(read('app/veyrnox/_components/SourcePickers.js'), {
  compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS },
}).outputText;
new Function('require', 'module', 'exports', compiled)(id => id.endsWith('/generationSourceSlots.mjs') ? slots : englishAppImports[id.replace('../../../', '../../../../')] || require(id), module, module.exports);
const render = (media, sources = {}) => renderToStaticMarkup(createElement(module.exports.SourcePickers, {
  media, sources, onPick() {}, onLibrary() {},
}));

test('all declared source slots expose typed uploads and Library, including optional end frames', () => {
  const html = render({ image: { required: true }, endImage: { required: false }, video: { required: true }, audio: { required: true }, private: {} });
  assert.match(html, /END IMAGE · OPTIONAL/);
  assert.equal((html.match(/>From library<\/button>/g) || []).length, 4);
  assert.equal((html.match(/type="file"/g) || []).length, 4, 'unknown slots remain unavailable');
  for (const kind of ['image', 'video', 'audio']) assert.ok(html.includes(`accept="${slots.generationMimeTypes(kind).join(',')}"`), kind);
  assert.match(render({ endImage: {} }, { endImage: { previewUrl: 'https://fixture.test/end.png', label: 'End' } }), /alt="End image"/);
});

test('source hints are MIME facts, not assumptions about speech or faces', () => {
  const html = render({ audio: { required: true, maxSeconds: 120, label: 'Mixed audio' }, video: { required: true, maxSeconds: 40 } });
  assert.match(html, /Mixed audio · REQUIRED/);
  assert.match(html, /MP3 or WAV, up to 20 MB, up to 120s/);
  assert.doesNotMatch(html, /SPEECH|visible face/);
});

test('Studio and Chat route every Library slot through the shared kind and MIME facts', () => {
  for (const path of ['app/veyrnox/app/create/page.js', 'app/veyrnox/_components/chat/MediaComposer.js']) {
    const source = read(path);
    assert.match(source, /<LibraryPicker\s+kind=\{generationSlotKind\(libraryFor\)\}\s+mimeTypes=\{generationMimeTypes\(generationSlotKind\(libraryFor\)\)\}/, path);
  }
});

test('Studio preserves mixed upload and Library slot roles with consent and batch idempotency', async () => {
  const model = { media: { image: {}, endImage: {}, video: {}, audio: {} } };
  const calls = [];
  const refs = await mediaGenerationSources(model, {
    image: { file: { name: 'start.png' } }, endImage: { assetId: 'end-asset' },
    video: { assetId: 'video-asset' }, audio: { file: { name: 'mix.wav' } },
    undeclared: { assetId: 'ignored' },
  }, async file => { calls.push(file.name); return `owned/${file.name}`; });
  assert.deepEqual(refs, {
    source_keys: [{ key: 'owned/start.png', slot: 'image' }, { key: 'owned/mix.wav', slot: 'audio' }],
    source_assets: [{ asset_id: 'end-asset', slot: 'endImage' }, { asset_id: 'video-asset', slot: 'video' }],
  });
  assert.deepEqual(calls, ['start.png', 'mix.wav']);
  const page = read('app/veyrnox/app/create/page.js');
  const submit = page.slice(page.indexOf('async function onSubmit()'), page.indexOf('function cancel()'));
  assert.match(submit, /const \{ source_keys, source_assets \} = await mediaGenerationSources\(model, sources, uploadSource\);/);
  assert.match(submit, /if \(missingConsent\)/);
  assert.match(submit, /consent: anySource \? true : undefined/);
  assert.match(submit, /idempotency_key: keys\[i\]/);
  assert.ok(submit.indexOf('mediaGenerationSources(') < submit.indexOf('await sendInOrder('));
});
