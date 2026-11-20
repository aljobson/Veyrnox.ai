import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import React from 'react';
import * as jsx from 'react/jsx-runtime';
import { renderToStaticMarkup } from 'react-dom/server';

const file = 'app/veyrnox/_components/SwapTemplatePreview.js';
const mod = { exports: {} };
const out = ts.transpileModule(readFileSync(new URL('../' + file, import.meta.url), 'utf8'), { fileName: file, compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
const mocks = {
  react: React, 'react/jsx-runtime': jsx,
  '../../../components/I18nProvider.jsx': { useI18n: () => ({ t: (k, v) => `${v?.title} preview` }) },
  '../_lib/useTemplates.js': { fetchTemplate: async () => null },
  '../_lib/useClipPlayback': { useClipPlayback: () => {} },
  '../_lib/tokens': { presetTitle: x => x },
};
new Function('require', 'module', 'exports', out)(id => { if (id in mocks) return mocks[id]; throw Error('missing mock ' + id); }, mod, mod.exports);
const { swapPreviewRatio, SwapTemplatePreview } = mod.exports;

test('aspect ratio accepts only a plain ratio and falls back to 9 / 16', () => {
  assert.equal(swapPreviewRatio('406 / 720'), '406 / 720');
  assert.equal(swapPreviewRatio('16:9'), '16/9');
  for (const bad of [undefined, null, '', 'auto', '1 / 2; background:red', 'url(x)']) assert.equal(swapPreviewRatio(bad), '9 / 16');
});

test('a protocol-relative or absolute poster path is refused', () => {
  assert.match(readFileSync(new URL('../app/veyrnox/_components/SwapTemplatePreview.js', import.meta.url), 'utf8'), /SAFE_PATH_RE = \/\^\\\/\(\?!\\\/\)/);
});

test('while loading the swap preview reserves its box and is marked busy, with no media', () => {
  const html = renderToStaticMarkup(React.createElement(SwapTemplatePreview, { id: 'community-billboard-product-swap' }));
  assert.match(html, /data-swap-preview/);
  assert.match(html, /aria-busy="true"/);
  assert.match(html, /aspect-ratio:9 \/ 16/);
  assert.doesNotMatch(html, /<img|<video/);
});
