import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';
import * as folderLogic from '../app/veyrnox/_lib/chatFolders.js';

const require = createRequire(import.meta.url);
const source = readFileSync(new URL('../app/veyrnox/_components/chat/ThreadList.js', import.meta.url), 'utf8');
const output = { exports: {} };
const code = ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS } }).outputText;
new Function('require', 'module', 'exports', code)(id => id === '../../_lib/chatFolders' ? folderLogic : require(id), output, output.exports);
const { ThreadList } = output.exports;
const props = { threads: [], folders: [] };
const ids = html => [...html.matchAll(/<(?:input|select)\b[^>]*\bid="([^"]+)"/g)].map(match => match[1]);

function renderLists() {
  return renderToStaticMarkup(React.createElement(React.Fragment, null,
    React.createElement('aside', { hidden: true }, React.createElement(ThreadList, props)),
    React.createElement('div', { role: 'dialog', 'aria-label': 'Chats' }, React.createElement(ThreadList, props))));
}

test('desktop and mobile chat lists render unique search and folder control IDs together', () => {
  const controls = ids(renderLists());
  assert.equal(controls.length, 4);
  assert.equal(new Set(controls).size, controls.length, 'The hidden desktop list must not own the mobile drawer control IDs');
});

test('each chat search and folder label targets its own instance rather than the hidden desktop controls', () => {
  const html = renderLists();
  const desktop = html.match(/<aside\b[^>]*>(.*?)<\/aside>/s)[1];
  const mobile = html.match(/<div role="dialog"[^>]*>(.*?)<\/div>$/s)[1];
  const desktopIds = ids(desktop), mobileIds = ids(mobile);
  for (const [index, name] of ['Search chats', 'Folder'].entries()) {
    const target = mobile.match(new RegExp(`<label[^>]*for="([^"]+)"[^>]*>${name}<\\/label>`))[1];
    assert.equal(target, mobileIds[index]);
    assert.notEqual(target, desktopIds[index], `${name} must associate with the visible mobile control`);
    assert.equal(ids(html).filter(id => id === target).length, 1);
  }
});
