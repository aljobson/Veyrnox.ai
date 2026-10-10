import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

// Untracked files count, so a new page is held to this before its first commit.
const SOURCES = execFileSync('git', ['ls-files', '-co', '--exclude-standard', 'app', 'components'], { encoding: 'utf8' }).split('\n')
    .filter((f) => /\.(js|jsx)$/.test(f));
const MAIN = 'app/veyrnox/_components/Main.js';

test('one component holds the only <main>, and every page renders it', () => {
    // The element is written in one file, so no page can nest a second by hand.
    assert.deepEqual(SOURCES.filter((f) => /<main[\s>]/.test(read(f))), [MAIN]);
    assert.match(read(MAIN), /<main id="main" tabIndex=\{-1\}/);
    // Not the root layout: it wrapped the nav and the footer, so "Skip to
    // content" skipped nothing and neither could be a landmark.
    assert.doesNotMatch(read('app/layout.js'), /<Main[\s>]/);
    // In its own page, or in the one shell that route's pages share.
    const SHELLS = { 'app/legal/': 'app/legal/_lib/Legal.js', 'app/veyrnox/m/': 'app/veyrnox/m/layout.js' };
    const routes = SOURCES.filter((f) => /\/(page|not-found|loading)\.js$/.test(f));
    assert.ok(routes.length > 40, 'the route files were found');
    for (const route of routes) {
        const shell = Object.keys(SHELLS).find((dir) => route.startsWith(dir));
        assert.match(read(shell ? SHELLS[shell] : route), /<Main[\s>]/, `${route} renders no <Main>`);
    }
});

test('the nav is a <header> outside <main>, and the footer follows it', () => {
    const bars = ['app/veyrnox/_components/NavBar.js', 'app/veyrnox/_sections/hero.js'].map(read).join('\n');
    assert.doesNotMatch(bars, /<div data-print="hide" className="sticky top-0/, 'a nav bar that is not a <header>');
    assert.ok((bars.match(/<header data-print="hide" className="sticky top-0/g) || []).length >= 2);
    const home = read('app/veyrnox/page.js');
    assert.match(home, /Nav \/>\s*<Main>/, '<main> opens after the nav');
    assert.match(home, /<\/Main>\s*<FooterForest /, 'and closes before the footer');
    assert.match(read('app/layout.js'), /<a href="#main" className="vx-skip /);
    // The studio nav keeps its current tab in view by moving the strip itself:
    // scrollIntoView() also moves where the next Tab starts, past the skip link.
    assert.doesNotMatch(read('app/veyrnox/_components/NavBar.js'), /\.scrollIntoView\(/);
    // Back to top lands on the same element, without a second scroll of its own.
    assert.match(read('app/veyrnox/_components/SiteChrome.js'), /getElementById\('main'\)\?\.focus\?\.\(\{ preventScroll: true \}\)/);
});

test('the account button opens a list of links, not an ARIA menu, and takes focus back', () => {
    const src = read('app/veyrnox/_components/NavAuthButtons.js');
    assert.doesNotMatch(src, /role="menu(item)?"|aria-haspopup/);
    assert.match(src, /aria-expanded=\{menuOpen\}\s*aria-controls="vx-account-menu"/);
    assert.match(src, /id="vx-account-menu"/);
    assert.match(src, /setMenuOpen\(false\);\s*triggerRef\.current\?\.focus\(\);/, 'Escape returns focus');
    assert.match(src, /triggerRef\.current\?\.focus\(\); setMenuOpen\(false\); setConfirming\(true\);/, 'so cancelling Sign out? does too');
});

test('a toggle has one name, and the password field is named by its label alone', () => {
    const library = read('app/veyrnox/app/library/page.js');
    assert.match(library, /aria-pressed=\{selected\} aria-label="Add to edit"/);
    const menu = read('app/veyrnox/_components/MobileMenu.js');
    assert.match(menu, /aria-expanded=\{open\}/);
    assert.match(menu, /aria-label="Menu"/);
    const gate = read('components/AuthGate.jsx');
    // Its visible word changes (Show, Hide), so its name does, and it has no pressed state.
    assert.match(gate, /aria-label=\{showPassword \? "Hide password" : "Show password"\}/);
    assert.doesNotMatch(gate, /aria-pressed=/);
    assert.match(gate, /<label htmlFor="vx-password" className="[^"]*">Password<\/label>/);
    assert.match(gate, /id="vx-password"/);
    // ON and OFF alone name nothing: the panel's heading is part of each switch's name.
    assert.match(read('app/veyrnox/_components/CameraPanel.js'), /aria-labelledby="vx-camera-title vx-camera-switch"/);
    assert.match(read('app/veyrnox/_components/CharacterPanel.js'), /aria-labelledby="vx-character-title vx-character-switch"/);
});

test('a form field outline reaches 3:1 on its fill and on the card, in all three palettes', () => {
    const lin = (c) => { const v = c / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
    const ratio = (a, b) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);
    const palette = (css, selector) => {
        const block = css.slice(css.indexOf(selector), css.indexOf('}', css.indexOf(selector)));
        const token = (name) => new RegExp(`--vx-${name}: (\\d+) (\\d+) (\\d+);`).exec(block).slice(1).map(Number);
        return { field: token('field'), base: token('base'), panel: token('panel') };
    };
    const globals = read('app/globals.css');
    for (const [name, p] of [
        ['dark', palette(globals, ':root {')],
        ['light', palette(globals, ":root[data-theme='light'] {")],
        ['paper', palette(read('app/veyrnox/veyrnox.css'), '.vx-paper {')],
    ]) {
        assert.ok(ratio(p.field, p.base) >= 3, `${name}: ${ratio(p.field, p.base).toFixed(2)} on base`);
        assert.ok(ratio(p.field, p.panel) >= 3, `${name}: ${ratio(p.field, p.panel).toFixed(2)} on panel`);
    }
    assert.match(globals, /--color-vx-field: rgb\(var\(--vx-field\)\);/);
    // Fields only: a card or a chip keeps the hairline.
    for (const f of ['components/AuthGate.jsx', 'app/veyrnox/_components/PriceSlip.js', 'app/veyrnox/_components/GenerationSettings.js',
        'app/veyrnox/_components/EditSheet.js', 'app/veyrnox/_components/CameraPanel.js', 'app/veyrnox/_components/CharacterPanel.js',
        'app/veyrnox/_components/VoiceDescription.js', 'app/veyrnox/app/create/page.js']) {
        const src = read(f);
        assert.match(src, /border-vx-field/, f);
        const tags = [...src.matchAll(/<(input|textarea|select)\b[\s\S]*?className=(?:"([^"]*)"|\{`([^`]*)`\})/g)];
        for (const [, tag, plain, template] of tags) {
            const cls = plain ?? template;
            // The hero slip's "N more" select is drawn as a chip and matches the chips beside it.
            if (tag === 'select' && /\brounded-full\b/.test(cls)) continue;
            if (/\bborder\b/.test(cls)) assert.doesNotMatch(cls, /border-vx-border/, `${f}: a <${tag}> still has the hairline`);
        }
    }
});

test('forced colours keep the pressed state, and focus stops clear of the sticky nav', () => {
    const css = read('app/veyrnox/veyrnox.css');
    const forced = css.slice(css.indexOf('@media (forced-colors: active)'));
    const pressed = /\[aria-pressed='true'\] \{([^}]*)\}/.exec(forced.slice(0, 1200))[1];
    assert.match(pressed, /background-color: Highlight !important;\s*color: HighlightText !important;/);
    // Without it the browser paints a backplate behind the label and the label disappears.
    assert.match(pressed, /forced-color-adjust: none;/);
    assert.match(read('app/globals.css'), /html \{ scroll-padding-top: 5rem; \}/);
    // One offset, not two: a scroll-margin on every [id] would add to it.
    assert.doesNotMatch(css, /scroll-margin-top/);
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
