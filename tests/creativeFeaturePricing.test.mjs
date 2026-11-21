import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import React from 'react';
import * as jsx from 'react/jsx-runtime';
import { renderToStaticMarkup } from 'react-dom/server';
import * as features from '../app/veyrnox/_lib/creativeFeatures.js';
import * as translation from '../lib/i18n/translate.mjs';
import * as locales from '../lib/i18n/locales.mjs';
import english from '../lib/i18n/messages/app/en.mjs';

const source = readFileSync(new URL('../app/veyrnox/_components/CreativeFeatureStudio.js', import.meta.url), 'utf8');
const code = ts.transpileModule(source, {
  compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
}).outputText;
const feature = features.creativeFeature('product-image-generator');

function render(catalog, locale = 'en', messages = english) {
  const t = translation.translator(locale, messages);
  const mocks = {
    react: React,
    'react/jsx-runtime': jsx,
    'next/link': ({ children, ...props }) => React.createElement('a', props, children),
    'next/navigation': { useRouter: () => ({ push() {} }) },
    '../../../components/I18nProvider': { useI18n: () => ({ t, locale }) },
    '../../../lib/i18n/translate.mjs': translation,
    '../../../lib/i18n/locales.mjs': locales,
    '../_lib/creativeFeatures': features,
    '../_lib/useCatalog': { useCatalog: () => catalog },
    './PromptBox': { PromptBox: () => null },
    './SourcePickers': { SourcePickers: () => null },
    './LibraryPicker': { LibraryPicker: () => null },
    '../../../lib/generationSourceSlots.mjs': {},
    '../_lib/landingDraft': {},
    '../_lib/gateway': {},
    '../_lib/editorGenerationUploads.mjs': {},
    '../_lib/creativeScriptUpload.mjs': {},
  };
  const mod = { exports: {} };
  new Function('require', 'module', 'exports', code)(id => {
    assert.ok(Object.hasOwn(mocks, id), `unexpected import: ${id}`);
    return mocks[id];
  }, mod, mod.exports);
  const html = renderToStaticMarkup(React.createElement(mod.exports.default, { feature }));
  return { html, status: html.match(/<p role="status"[^>]*>([^<]*)<\/p>/)?.[1] };
}

const catalog = credits => ({
  live: true, loading: false,
  models: [{ id: 'unrelated-model', credits: 999 }, { id: feature.model, credits }],
});

test('the guided studio displays the selected live catalog price unchanged', () => {
  for (const credits of [0, 1, 37, 1234.5]) {
    const { status, html } = render(catalog(credits));
    assert.equal(status, `${credits.toLocaleString(locales.localeTag('en'))} ${credits === 1 ? 'credit' : 'credits'}`);
    assert.ok(html.includes(english['app.features.finalReview']));
  }
});

test('loading and failed catalogs never display the bundled fallback price', () => {
  assert.equal(render({ ...catalog(777), live: false, loading: true }).status, english['app.create.checkingPrices']);
  assert.equal(render({ ...catalog(777), live: false }).status, english['app.create.pricesUnavailable']);
});

test('missing models and invalid prices show unavailable, not a fabricated price', () => {
  assert.equal(render({ live: true, loading: false, models: [] }).status, english['app.create.pricesUnavailable']);
  for (const credits of [undefined, null, '37', -1, NaN, Infinity]) {
    assert.equal(render(catalog(credits)).status, english['app.create.pricesUnavailable']);
  }
});

test('the reused price messages exist in every locale and format localized counts', async () => {
  for (const locale of ['en', 'es', 'zh', 'hi', 'ar', 'fr', 'pt', 'ru', 'ja', 'de', 'ko']) {
    const { default: messages } = await import(`../lib/i18n/messages/app/${locale}.mjs`);
    for (const key of ['app.create.checkingPrices', 'app.create.pricesUnavailable', 'app.create.credits.other']) {
      assert.equal(typeof messages[key], 'string', `${locale}: ${key}`);
    }
    const t = translation.translator(locale, messages);
    const expected = t(translation.pluralKey(t, locale, 'app.create.credits', 1234), {
      count: (1234).toLocaleString(locales.localeTag(locale)),
    });
    assert.equal(render(catalog(1234), locale, messages).status, expected);
  }
});
