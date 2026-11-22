import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import React from 'react';
import * as jsx from 'react/jsx-runtime';
import { renderToStaticMarkup } from 'react-dom/server';
import { translator } from '../lib/i18n/translate.mjs';
import { swapImageCounts, swapFullBody } from '../app/veyrnox/_lib/templateSwapClient.mjs';
const t = translator('en');
const one = { id: 'a', model: 'kling-o1-reference', credits: 47, durationSeconds: 5, images: 2, role: 'the dancer', name: 'Kling O1' };
const two = { id: 'b', model: 'kling-o1-reference', credits: 47, durationSeconds: 5, images: 4, people: 2, role: 'the green character', roles: ['the green character', 'the red character'], name: 'Kling O1' };
let attempts = [];
function load(file, mocks) {
  const mod = { exports: {} };
  const output = ts.transpileModule(readFileSync(new URL('../' + file, import.meta.url), 'utf8'), { fileName: file, compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  new Function('require', 'module', 'exports', output)(id => { if (id === 'react') return React; if (id === 'react/jsx-runtime') return jsx; if (Object.hasOwn(mocks, id)) return mocks[id]; throw Error(`missing mock ${id}`); }, mod, mod.exports);
  return mod.exports;
}
const { SwapComposer } = load('app/veyrnox/_components/SwapComposer.js', {
  '../../../components/I18nProvider.jsx': { useI18n: () => ({ t }) }, '../_lib/useSwapDraft.js': { useSwapDraft: () => ({ accountId: 'A', attempts }) },
  '../_lib/templateSwapRuntime.js': { swapActions: {} }, '../_lib/templateSwapClient.mjs': { swapErrorKey: () => 'presets.swap.no_face', unsettled: () => false, swapImageCounts, swapFullBody },
  '../_lib/useOnlineStatus.js': { useOnlineStatus: () => true }, './SwapAttemptStatus.js': { swapControl: 'min-h-11' }, './TemplatePhotoExample.js': { TemplatePhotoExample: () => null },
});
const html = offer => renderToStaticMarkup(React.createElement(SwapComposer, { offer }));
const count = (text, needle) => text.split(needle).length - 1;
test('one person: one photo step, as before', () => {
  attempts = [];
  const page = html(one);
  assert.equal(count(page, '<input type="file"'), 1);
  assert.match(page, /You will replace: the dancer/); assert.match(page, /Your photo/);
  assert.doesNotMatch(page, /Photo for:/);
});
test('two people: a labelled photo step per person, the second locked until the first is ready', () => {
  attempts = [];
  const page = html(two);
  assert.equal(count(page, '<input type="file"'), 2);
  assert.match(page, /You will replace: the green character and the red character/);
  assert.match(page, /Photo for: the green character/); assert.match(page, /Photo for: the red character/);
  const inputs = page.match(/<input type="file"[^>]*>/g);
  assert.doesNotMatch(inputs[0], /disabled/); assert.match(inputs[1], /disabled/);
  assert.match(page, /<button[^>]*disabled[^>]*>Generate/);
});
test('two people: second step opens after the first, Generate only with all four images', () => {
  const files = n => Array.from({ length: n }, () => ({})), urls = n => Array.from({ length: n }, (_, i) => `blob:${n}-${i}`);
  attempts = [{ key: 'k', state: 'ready', files: files(2), urls: urls(2) }];
  let page = html(two);
  assert.doesNotMatch(page.match(/<input type="file"[^>]*>/g)[1], /disabled/);
  assert.match(page, /<button[^>]*disabled[^>]*>Generate/);
  attempts = [{ key: 'k', state: 'ready', files: files(4), urls: urls(4) }];
  page = html(two);
  assert.equal(count(page, '<img '), 4);
  assert.doesNotMatch(page, /<button[^>]*disabled[^>]*>Generate/);
});

test('full body (amendment 18): full-length guidance, three labelled previews, Generate with three images or the two-image set', () => {
  const full = { ...one, fullBody: true }, files = n => Array.from({ length: n }, () => ({})), urls = n => Array.from({ length: n }, (_, i) => `blob:${n}-${i}`);
  attempts = [];
  let page = html(full);
  assert.equal(count(page, '<input type="file"'), 1);
  assert.match(page, /a close-up or a full-length photo/); assert.doesNotMatch(page, /with a large face/);
  attempts = [{ key: 'k', state: 'ready', files: files(3), urls: urls(3) }];
  page = html(full);
  assert.equal(count(page, '<img '), 3);
  for (const label of ['Face', 'Head and shoulders', 'Full body']) assert.match(page, new RegExp(`<figcaption[^>]*>${label}<`));
  assert.doesNotMatch(page, /<button[^>]*disabled[^>]*>Generate/);
  attempts = [{ key: 'k', state: 'ready', files: files(3), urls: urls(3) }];
  assert.match(html(one), /<button[^>]*disabled[^>]*>Generate/, 'three images never submit for an offer without fullBody');
});
