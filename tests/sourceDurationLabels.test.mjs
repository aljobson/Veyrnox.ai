import { fixture } from './helpers/publicSiteRender.mjs';
import { englishAppImports } from './helpers/appI18nStub.mjs';
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
import * as sourceSlots from '../lib/generationSourceSlots.mjs';
import { translator } from '../lib/i18n/translate.mjs';
import * as promptLimits from '../lib/promptLimits.js';

const require = createRequire(import.meta.url);
const binding = fixture('en', '/app/chat').load('components/BindingText.jsx');
function component(path, name, stateValues) {
  const output = { exports: {} };
  const code = ts.transpileModule(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'), {
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS },
  }).outputText;
  let stateIndex = 0;
  const imports = {
    ...(stateValues ? { react: { ...require('react'), useState: initial => require('react').useState(stateIndex < stateValues.length ? stateValues[stateIndex++] : initial) } } : {}),
    '../../../../components/BindingText': binding,
    '../../../../lib/generationSourceSlots.mjs': sourceSlots,
    '../../../../lib/createAttach.mjs': { attachAccept: () => 'image/png,video/mp4,audio/mpeg' },
    '../../_lib/chatMedia': chatMedia, '../_lib/chatMedia': chatMedia,
    '../../_lib/modelPricing': pricing, '../_lib/modelPricing': pricing,
    '../../_lib/createErrors': { ERROR_COPY: {} }, '../SourcePickers': { SourcePickers: () => null },
    '../LibraryPicker': { LibraryPicker: ({ kind, mimeTypes }) => createElement('span', { 'data-library-kind': kind, 'data-library-mimes': mimeTypes.join(',') }) }, 'next/navigation': { useRouter: () => ({ push() {} }) },
    '../../../components/I18nProvider': { useI18n: () => ({ locale: 'en', t: translator('en'), href: (p) => p }) },
    '../_lib/landingDraft': { writeStudioDraft() {} }, '../_lib/tokens': tokens, '../_lib/starterModels': starters,
    '../../../lib/promptLimits.js': promptLimits,
    '../../../../lib/promptLimits': promptLimits,
    '../../../../lib/promptLimits.js': promptLimits,
  };
  new Function('require', 'module', 'exports', code)((id) => imports[id] || englishAppImports[id] || require(id), output, output.exports);
  return output.exports[name];
}
function modelFor(endpoint) {
  const record = capabilityFor(endpoint), capabilities = publicCapabilities(record);
  return { id: 'test-model', name: 'Test model', kind: record.kind, credits: 10, gated: false,
    takesPrompt: !!capabilities.inputs.prompt,
    durations: lengthsFor(record), capabilities, media: capabilities.media, presentation: capabilities.presentation || {} };
}
const Composer = component('app/veyrnox/_components/chat/MediaComposer.js', 'MediaComposer');
const Slip = component('app/veyrnox/_components/PriceSlip.js', 'PriceSlip');
const renderComposer = (model, { prompt = 'Test prompt', ...overrides } = {}) => renderToStaticMarkup(createElement(Composer, { kind: model.kind, prompt, onPrompt() {}, media: {
  model, availableModels: [model], duration: 5, sources: {}, jobs: [], cost: 10, freeLeft: 0, balance: 100, catalogLive: true,
  ...overrides,
} }));

test('Kling O1 price slips and Chat preserve selected 5s/10s clip labels and catalog-based prices', () => {
  const live = { ...modelFor('fal-ai/kling-video/o1/video-to-video/reference'), credits: 47 };
  const bundled = tokens.MODELS.find(model => model.id === 'kling-o1-reference');
  for (const model of [live, bundled]) {
    for (const [seconds, cost] of [[5, 47], [10, 94]]) {
      const SelectedSlip = component('app/veyrnox/_components/PriceSlip.js', 'PriceSlip', [model.id, seconds, '']);
      const slip = renderToStaticMarkup(createElement(SelectedSlip, { models: [model] }));
      assert.ok(slip.includes(`${seconds}s clip`));
      assert.ok(slip.includes(`${cost} cr`));
      assert.doesNotMatch(slip, /source up to/i);
      const composer = renderComposer(model, { duration: seconds, cost });
      assert.match(composer, /data-testid="chat-media-duration"/);
      assert.match(composer, />5s</);
      assert.match(composer, />10s</);
      assert.doesNotMatch(composer, /Source up to/);
    }
  }
});

test('prompt-less Chat transforms enable with valid sources while all other submit guards remain active', () => {
  const model = modelFor('fal-ai/latentsync');
  const generateButton = (html) => html.match(/<button\b[^>]*data-testid="chat-media-generate"[^>]*>[^<]*<\/button>/)[0];
  assert.doesNotMatch(generateButton(renderComposer(model, { prompt: '', missingSource: false, missingConsent: false })), /\sdisabled=/);
  for (const guard of [{ missingSource: true }, { missingConsent: true }, { missingVoice: true }, { balance: 0 }, { catalogLive: false }]) {
    assert.match(generateButton(renderComposer(model, { prompt: '', ...guard })), /\sdisabled=/);
  }
  assert.match(generateButton(renderComposer(modelFor('fal-ai/wan-25-preview/text-to-video'), { prompt: '' })), /\sdisabled=/);
});

test('web Chat preserves an over-limit handoff and blocks generation before submit', () => {
  const model = modelFor('fal-ai/wan-25-preview/text-to-video');
  const prompt = 'x'.repeat(801);
  const html = renderComposer(model, { prompt });
  const button = html.match(/<button\b[^>]*data-testid="chat-media-generate"[^>]*>[^<]*<\/button>/)[0];
  assert.match(button, /\sdisabled=/);
  assert.match(html, new RegExp(`<textarea[^>]*>${prompt}</textarea>`));
  assert.match(html, /This prompt is 801 characters\. The model takes up to 800\./);
});

test('all eight prompt-driven audio families keep their Chat text guard; source-only Demucs does not', () => {
  const button = html => html.match(/<button\b[^>]*data-testid="chat-media-generate"[^>]*>[^<]*<\/button>/)[0];
  for (const endpoint of ['fal-ai/ace-step', 'fal-ai/ace-step-1.5', 'fal-ai/elevenlabs/sound-effects/v2', 'fal-ai/mmaudio-v2/text-to-audio', 'fal-ai/inworld-tts', 'fal-ai/elevenlabs/tts/turbo-v2.5', 'fal-ai/minimax/speech-2.6-hd', 'fal-ai/elevenlabs/text-to-dialogue/eleven-v3']) {
    const model = modelFor(endpoint);
    assert.match(button(renderComposer(model, { prompt: '' })), /\sdisabled=/, endpoint);
    assert.doesNotMatch(button(renderComposer(model)), /\sdisabled=/, endpoint);
  }
  assert.doesNotMatch(button(renderComposer(modelFor('fal-ai/demucs'), { prompt: '' })), /\sdisabled=/);
});

test('Chat renders Library with source-slot type and MIME restrictions', () => {
  for (const [slot, kind] of [['image', 'image'], ['endImage', 'image'], ['video', 'video'], ['audio', 'audio']]) {
    const html = renderComposer(modelFor('fal-ai/latentsync'), { libraryFor: slot });
    assert.ok(html.includes(`data-library-kind="${kind}"`), slot);
    assert.ok(html.includes(`data-library-mimes="${sourceSlots.generationMimeTypes(kind).join(',')}"`), slot);
  }
});

test('Chat describes uploaded-source limits and never offers a 5s source duration', () => {
  for (const [endpoint, max] of [['fal-ai/kling-video/ai-avatar/v2/standard', 10], ['fal-ai/latentsync', 40], ['fal-ai/demucs', 120]]) {
    const html = renderComposer(modelFor(endpoint));
    assert.ok(html.includes(`Source up to ${max}s`), endpoint);
    assert.match(html, /Follows your uploaded source/);
    assert.doesNotMatch(html, /data-testid="chat-media-duration"|>5s</);
  }
});

test('landing price slips describe source limits rather than internal 5s units', () => {
  for (const [endpoint, max] of [['fal-ai/kling-video/ai-avatar/v2/standard', 10], ['fal-ai/latentsync', 40]]) {
    const html = renderToStaticMarkup(createElement(Slip, { models: [modelFor(endpoint)] }));
    assert.ok(html.includes(`source up to ${max}s`), endpoint);
    assert.doesNotMatch(html, /5s clip/);
  }
});

test('landing price slip preserves an over-limit handoff and blocks generation', () => {
  const model = modelFor('fal-ai/wan-25-preview/text-to-video');
  const prompt = 'x'.repeat(801);
  const OverLimitSlip = component('app/veyrnox/_components/PriceSlip.js', 'PriceSlip', [model.id, 5, prompt]);
  const html = renderToStaticMarkup(createElement(OverLimitSlip, { models: [model] }));
  assert.match(html, new RegExp(`<textarea[^>]*>${prompt}</textarea>`));
  assert.match(html, /<button[^>]*type="submit"[^>]*disabled=""/);
  assert.match(html, /This prompt is 801 characters\. The model takes up to 800\./);
});

test('landing price slips advertise a live catalog model\'s smaller prompt ceiling', () => {
  const model = { ...modelFor('market:wan/2-5-text-to-video'), promptMax: 800 };
  const html = renderToStaticMarkup(createElement(Slip, { models: [model] }));
  assert.match(html, /maxLength="800"/);
});

test('Chat retains generated video durations for fixed and selectable output models', () => {
  const veo = renderComposer(modelFor('veo:veo3_lite'));
  assert.match(veo, /data-testid="chat-media-duration"/);
  assert.match(veo, />8s</);
  assert.doesNotMatch(veo, /Source up to/);
  const wan = renderComposer(modelFor('fal-ai/wan-25-preview/text-to-video'));
  assert.match(wan, />5s</);
  assert.match(wan, />10s</);
});
