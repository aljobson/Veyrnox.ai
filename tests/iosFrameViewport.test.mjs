import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { renderToStaticMarkup } from 'react-dom/server';
const require = createRequire(import.meta.url);
const ts = require('typescript');
const source = readFileSync(new URL('../app/veyrnox/_components/IOSFrame.js', import.meta.url), 'utf8');
const module = { exports: {} };
new Function('require', 'exports', ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS } }).outputText)(require, module.exports);
const tree = module.exports.IOSFrame({ children: 'Synthetic prototype content' });

test('desktop prototype retains its 430px maximum frame and fixed-height phone appearance', () => {
  assert.equal(tree.props.style.width, 430);
  assert.equal(tree.props.style.maxWidth, '100%');
  assert.equal(tree.props.children.props.style.height, 900);
});
test('inner phone shrinks with its capped parent instead of forcing a 430px mobile layout viewport', () => {
  assert.equal(tree.props.children.props.style.width, '100%');
  const html = renderToStaticMarkup(tree);
  assert.match(html, /width:100%;height:900px/);
  assert.match(html, /Synthetic prototype content/);
});
