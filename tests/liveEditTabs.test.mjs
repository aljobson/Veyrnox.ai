import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import ts from 'typescript';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { TABS, nextTab } from '../app/veyrnox/_lib/liveEdit/tabs.js';

// Loads a source file and its relative imports the way the repo's other component tests do: transpile, then run as CommonJS.
const require = createRequire(import.meta.url), root = new URL('../', import.meta.url).pathname, cache = new Map();
function load(rel) {
    if (cache.has(rel)) return cache.get(rel);
    const file = [rel, `${rel}.js`, `${rel}.jsx`].find(candidate => existsSync(join(root, candidate)) && !candidate.endsWith('/'));
    const out = ts.transpileModule(readFileSync(join(root, file), 'utf8'), { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, allowJs: true } }).outputText;
    const mod = { exports: {} }; cache.set(rel, mod.exports);
    new Function('require', 'module', 'exports', out)(id => id.startsWith('.') ? load(join(dirname(file), id)) : require(id), mod, mod.exports);
    cache.set(rel, mod.exports); return mod.exports;
}
const { Controls } = load('app/veyrnox/app/photo-studio/Controls.jsx');
const { DEFAULTS } = load('app/veyrnox/_lib/liveEdit/settings.js');
const t = key => key; // the keys themselves, so the test does not depend on wording
const render = (props = {}) => renderToStaticMarkup(createElement(Controls, { t, settings: DEFAULTS, update() {}, disabled: false, faceReady: true, hairState: 'ready', retry() {}, addSticker() {}, ...props }));

test('arrow keys wrap around the tabs, Home and End jump, and other keys do nothing', () => {
    assert.deepEqual(TABS, ['adjust', 'makeup', 'hair', 'stickers']);
    assert.equal(nextTab('adjust', 'ArrowRight'), 'makeup');
    assert.equal(nextTab('stickers', 'ArrowRight'), 'adjust');
    assert.equal(nextTab('adjust', 'ArrowLeft'), 'stickers');
    assert.equal(nextTab('hair', 'Home'), 'adjust');
    assert.equal(nextTab('adjust', 'End'), 'stickers');
    assert.equal(nextTab('adjust', 'a'), null);
    assert.equal(nextTab('unknown', 'ArrowRight'), 'makeup');
});

test('the panel shows a tab row with exactly one selected tab and the matching panel', () => {
    const html = render();
    assert.match(html, /role="tablist"/);
    assert.equal((html.match(/role="tab"/g) || []).length, 4);
    assert.equal((html.match(/aria-selected="true"/g) || []).length, 1);
    assert.match(html, /id="studio-tab-adjust"[^>]*aria-selected="true"/);
    assert.match(html, /role="tabpanel"[^>]*aria-labelledby="studio-tab-adjust"/);
    // Only the selected tab is in the tab order.
    assert.equal((html.match(/tabindex="0"/g) || []).length, 1);
});

test('each tab shows only its own tool', () => {
    const adjust = render({ initial: 'adjust' }), makeup = render({ initial: 'makeup' }), hair = render({ initial: 'hair' }), stickers = render({ initial: 'stickers' });
    assert.match(adjust, /app\.photoStudio\.look/); assert.doesNotMatch(adjust, /app\.photoStudio\.makeup\.presets|app\.photoStudio\.hair\.presets|app\.photoStudio\.stickerHelp/);
    assert.match(makeup, /app\.photoStudio\.makeup\.presets/); assert.doesNotMatch(makeup, /app\.photoStudio\.look"|app\.photoStudio\.hair\.presets/);
    assert.match(hair, /app\.photoStudio\.hair\.presets/); assert.doesNotMatch(hair, /app\.photoStudio\.makeup\.presets/);
    assert.match(stickers, /app\.photoStudio\.stickerHelp/); assert.doesNotMatch(stickers, /app\.photoStudio\.hair\.presets/);
});

test('the code-drawn wigs are no longer offered in any tab', () => {
    for (const initial of TABS) assert.doesNotMatch(render({ initial }), /wig/i);
});

test('the tool name is announced once: the tab names it and the section heading is for screen readers only', () => {
    assert.match(render({ initial: 'makeup' }), /<legend class="sr-only">app\.photoStudio\.makeup\.title<\/legend>/);
    assert.match(render({ initial: 'hair' }), /<h2 class="sr-only">app\.photoStudio\.hair\.title<\/h2>/);
});

test('while the editor is busy the whole panel is disabled, and without a face the face tools are', () => {
    assert.match(render({ disabled: true }), /<fieldset disabled=""[^>]*role="tabpanel"/);
    assert.match(render({ initial: 'makeup', faceReady: false }), /<fieldset disabled=""[^>]*class="space-y-4"/);
});
