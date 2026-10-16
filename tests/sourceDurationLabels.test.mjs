import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { capabilityFor, publicCapabilities, lengthsFor } from '../lib/modelCapabilities.js';
import * as pricing from '../app/veyrnox/_lib/modelPricing.js';
import * as chatMedia from '../app/veyrnox/_lib/chatMedia.js';
import * as tokens from '../app/veyrnox/_lib/tokens.js';
import * as starters from '../app/veyrnox/_lib/starterModels.js';

const require = createRequire(import.meta.url);
function component(path, name) {
  const output = { exports: {} };
  const code = ts.transpileModule(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'), {
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const imports = {
    '../../_lib/chatMedia': chatMedia, '../_lib/chatMedia': chatMedia,
    '../../_lib/modelPricing': pricing, '../_lib/modelPricing': pricing,
    '../../_lib/createErrors': { ERROR_COPY: {} }, '../SourcePickers': { SourcePickers: () => null },
    '../LibraryPicker': { LibraryPicker: () => null }, 'next/navigation': { useRouter: () => ({ push() {} }) },
    '../_lib/landingDraft': { writeStudioDraft() {} }, '../_lib/tokens': tokens, '../_lib/starterModels': starters,
  };
  new Function('require', 'module', 'exports', code)((id) => imports[id] || require(id), output, output.exports);
  return output.exports[name];
}
function modelFor(endpoint) {
  const record = capabilityFor(endpoint), capabilities = publicCapabilities(record);
  return { id: 'test-model', name: 'Test model', kind: record.kind, credits: 10, gated: false,
    durations: lengthsFor(record), capabilities, media: capabilities.media, presentation: capabilities.presentation || {} };
}
const Composer = component('app/veyrnox/_components/chat/MediaComposer.js', 'MediaComposer');
const Slip = component('app/veyrnox/_components/PriceSlip.js', 'PriceSlip');
const renderComposer = (model) => renderToStaticMarkup(createElement(Composer, { kind: model.kind, prompt: 'Test prompt', onPrompt() {}, media: {
  model, availableModels: [model], duration: 5, sources: {}, jobs: [], cost: 10, freeLeft: 0, balance: 100, catalogLive: true,
} }));

test('Chat describes uploaded-source limits and never offers a 5s source duration', () => {
  for (const [endpoint, max] of [['fal-ai/kling-video/ai-avatar/v2/standard', 10], ['fal-ai/latentsync', 40], ['fal-ai/demucs', 120]]) {
    const html = renderComposer(modelFor(endpoint));
    assert.ok(html.includes(`Source up to ${max}s`), endpoint);
    assert.match(html, /Follows your uploaded source/);
    assert.doesNotMatch(html, /aria-label="Video duration"|>5s</);
  }
});

test('landing price slips describe source limits rather than internal 5s units', () => {
  for (const [endpoint, max] of [['fal-ai/kling-video/ai-avatar/v2/standard', 10], ['fal-ai/latentsync', 40]]) {
    const html = renderToStaticMarkup(createElement(Slip, { models: [modelFor(endpoint)] }));
    assert.ok(html.includes(`source up to ${max}s`), endpoint);
    assert.doesNotMatch(html, /5s clip/);
  }
});

test('Chat retains generated video durations for fixed and selectable output models', () => {
  const veo = renderComposer(modelFor('veo:veo3_lite'));
  assert.match(veo, /aria-label="Video duration"/);
  assert.match(veo, />8s</);
  assert.doesNotMatch(veo, /Source up to/);
  const wan = renderComposer(modelFor('fal-ai/wan-25-preview/text-to-video'));
  assert.match(wan, />5s</);
  assert.match(wan, />10s</);
});
