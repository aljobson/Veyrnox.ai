import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

test('the root layout holds the only <main>; no page nests another', () => {
    const files = execFileSync('git', ['ls-files', 'app', 'components'], { encoding: 'utf8' }).split('\n')
        .filter((f) => /\.(js|jsx)$/.test(f));
    const withMain = files.filter((f) => /<main[\s>]/.test(read(f)));
    assert.deepEqual(withMain, ['app/layout.js']);
    assert.match(read('app/layout.js'), /<main id="main" tabIndex=\{-1\}>/);
});

test('toasts take their colours from the theme tokens', () => {
    const src = read('components/ToasterMount.jsx');
    assert.match(src, /background: "rgb\(var\(--vx-panel\)\)"/);
    assert.match(src, /color: "rgb\(var\(--vx-fg\)\)"/);
    assert.ok(!/#[0-9a-f]{6}/i.test(src), 'no hard-coded hex colour');
});

test('studio option pills say which one is selected', () => {
    const src = read('app/veyrnox/_components/ControlRow.js');
    assert.match(src, /aria-pressed=\{value === o\}/);
    assert.match(src, /role="group" aria-label=\{label\}/);
});

test('reduced motion is honoured site-wide, not only inside .vx-root', () => {
    const css = read('app/globals.css');
    const block = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'));
    assert.match(block.slice(0, 400), /\*, \*::before, \*::after \{\s*animation: none !important;\s*transition: none !important;/);
});

test('the paper slip uses the light-theme red', () => {
    const css = read('app/veyrnox/veyrnox.css');
    const paper = css.slice(css.indexOf('.vx-paper {'), css.indexOf('}', css.indexOf('.vx-paper {')));
    const light = /:root\[data-theme='light'\] \{[^}]*--vx-danger: ([\d ]+);/.exec(read('app/globals.css'))[1];
    assert.match(paper, new RegExp(`--vx-danger: ${light};`));
});
