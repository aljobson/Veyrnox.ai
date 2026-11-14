import test from 'node:test';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import React from 'react';
import * as jsxRuntime from 'react/jsx-runtime';
import { renderToStaticMarkup } from 'react-dom/server';
import * as promptHelpers from '../lib/templateClipPrompt.mjs';
import * as templateGenerate from '../app/veyrnox/_lib/templateGenerate.js';

const preset = { id: 'medieval-runway-look', name: 'Medieval Runway Look', model: 'Seedance', modelId: 'seedance', prompt: 'Exact words', sourcePrompt: 'Exact words', sourcePromptOrigin: 'community-source-exact', clip: { video: '/showcase/example.mp4' }, durationSeconds: 5, aspect: '9:16', available: true };
const model = { id: 'seedance', name: 'Seedance', kind: 'video', modality: 'image-to-video', credits: 85, durations: [5], media: { image: { required: true } } };
const t = key => key;
function load(file, source, mocks) {
  const compiled = { exports: {} };
  const output = ts.transpileModule(source, { fileName: file, compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  new Function('require', 'module', 'exports', output)(name => {
    if (name === 'react/jsx-runtime') return jsxRuntime;
    return mocks[name] || {};
  }, compiled, compiled.exports);
  return compiled.exports;
}
// Frozen before this work: mock translations, catalog and imported child components are stable.
const FROZEN = { TemplateRecipe: 'b8266a3e7eccadda1ffcb7499f6bd6e887ac1a2765c2b279c5facba518b39e3f', UseTemplate: 'f7264c462ac3e39874842e7a46213ef22548a5f03d4f996d57f136708035bb36', mobile: '77a98c88ca460189d8ff6bc10d67635c092bec6041a33113e0e4fef5229b7d31' };
const digest = text => createHash('sha256').update(text).digest('hex');
const versions = file => [readFileSync(file, 'utf8')];
const webMocks = {
  react: React, 'next/link': { __esModule: true, default: 'a' }, 'next/navigation': { useRouter: () => ({}) },
  '../../../components/I18nProvider.jsx': { useI18n: () => ({ t }) },
  '../../../lib/templateClipPrompt.mjs': promptHelpers,
  '../_lib/useTemplateClipAvailable': { useTemplateClipAvailable: () => null },
  '../_lib/useSwapSceneAvailable': { useSwapSceneAvailable: () => false },
  '../_lib/templateSourceBlock': { templateSourceUnsupported: () => false },
  '../_lib/templateDraft': { TEMPLATE_PROMPT_MAX: 2000, createPromptModelAvailable: () => true },
  '../_lib/useCatalog': { useCatalog: () => ({ models: [model], live: true }) },
  '../_lib/tokens': { modelIdForName: () => model.id, modelAspectRatios: () => ['9:16'], clipCredits: () => 85, presetHref: () => '/create' },
  '../_lib/templateGenerate': templateGenerate,
  '../../../lib/aspectShapes.mjs': { nearestOption: () => '9:16' },
  '../../../lib/chatLimits.js': { CHAT_USER_TEXT_MAX: 2000 },
  '../../../lib/i18n/presetSteps.mjs': { presetStep: value => value },
  './UseTemplate': { UseTemplate: 'use-template' }, './TemplateGenerate': { TemplateGenerate: 'template-generate' },
};
for (const name of ['TemplateRecipe', 'UseTemplate']) test(`${name}: flag-off rendered markup matches the frozen checkout`, () => {
  const file = `app/veyrnox/_components/${name}.js`;
  const snapshots = versions(file).map(source => {
    const Component = load(file, source, webMocks)[name];
    return renderToStaticMarkup(React.createElement(Component, { preset }));
  });
  assert.equal(digest(snapshots[0]), FROZEN[name]);
});

// Compare the complete render tree without a device or native event assumptions.
test('mobile template: flag-off render tree matches the frozen checkout', () => {
  const file = 'apps/mobile/src/app/(app)/templates/[id].tsx';
  const trees = versions(file).map(source => {
    let state = 0;
    const Component = load(file, source, {
      react: { useEffect() {}, useState(initial) { const i = state++; return [i === 0 ? preset : i === 1 ? false : initial === undefined ? [model] : typeof initial === 'function' ? initial() : initial, () => {}]; } },
      'react-native': { ScrollView: 'scroll', View: 'view' }, 'expo-router': { Stack: { Screen: 'screen' }, useLocalSearchParams: () => ({ id: preset.id }), useRouter: () => ({}) },
      '../../../lib/i18n': { t }, '../../../lib/i18n/translate': { rawText: value => value },
      '../../../components/ui': { Button: 'button', Card: 'card', Chip: 'chip', Text: 'text', TextField: 'field', themedStyles: () => ({}), useThemedStyles: () => ({}) },
      '../../../lib/templateClips': { useTemplateClipAvailable: () => null },
      '../../../lib/templateChoices': { templateModelEligible: () => true, templateOptions: () => ({ aspects: [], durations: [5], duration: 5 }) },
      '../../../lib/templateGenerate': { sourceUnsupported: () => false, photoSlot: () => null, inlineBlockReason: () => null, templateRequest: () => ({}) },
      '../../../lib/useTemplateGenerate': { useTemplateGenerate: () => ({ ready: false }) },
      '../../../lib/templateFilters': { templatePrice: () => '85' }, '../../../lib/presets': { themeTitle: () => 'theme' },
      '../../../lib/media': { estimateCredits: () => 85 }, '../../../lib/promptLimits': { GENERATION_PROMPT_MAX: 2000 },
      '../../../../../../../lib/templateClipPrompt.mjs': promptHelpers,
    }).default;
    const clean = value => {
      if (value == null || typeof value === 'boolean' || typeof value === 'function') return undefined;
      if (Array.isArray(value)) return value.map(clean).filter(v => v !== undefined);
      if (typeof value !== 'object') return value;
      if (value.$$typeof) return { type: typeof value.type === 'symbol' ? 'fragment' : value.type, props: clean(value.props) };
      return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, clean(v)]).filter(([, v]) => v !== undefined));
    };
    return clean(Component());
  });
  assert.equal(digest(JSON.stringify(trees[0])), FROZEN.mobile);
});
