import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { NAV_CATEGORIES } from '../app/veyrnox/_lib/tokens.js';

// The public pages read as one site: one nav, two page-title sizes, one left
// edge. Each of these had drifted (two navs in two orders, eight title sizes,
// five page widths), so each is pinned here.

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
// Every source file once: [path, text]. Untracked files count, so a new
// component is checked before its first commit.
const SOURCES = execFileSync('git', ['ls-files', '-co', '--exclude-standard', 'app', 'components'], { encoding: 'utf8' })
    .split('\n').filter((f) => /\.(js|jsx|css)$/.test(f)).map((f) => [f, read(f)]);

// The home page is not in either list: its title sits in the video panel and
// keeps its own size (veyrnox.css says why). Its hero line is checked below.
const INDEX_PAGES = [
    'app/veyrnox/pricing/page.js', 'app/veyrnox/models/page.js',
    'app/veyrnox/presets/page.js', 'app/veyrnox/tools/page.js', 'app/veyrnox/guides/page.js', 'app/not-found.js',
];
const DETAIL_PAGES = [
    'app/veyrnox/models/[id]/page.js', 'app/veyrnox/presets/[id]/page.js', 'app/veyrnox/guides/[id]/page.js',
    'app/veyrnox/social-cinema/SocialCinema.js', 'app/veyrnox/social-cinema/pass/PassPanel.js',
    'app/veyrnox/social-cinema/title/[id]/TitlePage.js', 'app/legal/_lib/Legal.js', 'app/veyrnox/design-system/page.js',
];

test('there is one public nav, in one order', () => {
    for (const [f, src] of SOURCES) assert.doesNotMatch(src, /\bWideNav\b/, `${f} still has a second nav`);
    const nav = read('app/veyrnox/_components/NavBar.js');
    const marketing = nav.slice(nav.indexOf('export function MarketingNav'), nav.indexOf('export function AppNav'));
    assert.match(marketing, /NAV_CATEGORIES\.map\(/, 'the links on the bar');
    assert.match(marketing, /<MobileMenu items=\{NAV_CATEGORIES\}/, 'the same links in the phone menu');
    // Eight links, search and the account buttons need about 1,200px: the row shows from xl.
    assert.match(marketing, /<nav aria-label="Primary" className="hidden xl:flex /);
    // A home-page section is a plain link: the browser glides to it on the home page.
    assert.match(marketing, /const Item = section \? 'a' : Link;/);
    assert.match(read('app/veyrnox/_components/MobileMenu.js'), /const Item = it\.href\.includes\('#'\) \? 'a' : Link;/);
    assert.deepEqual(NAV_CATEGORIES.map((c) => c.label),
        ['Explore', 'Models', 'Templates', 'Tools', 'LLM Chat', 'Pricing', 'FAQ', 'Social Cinema']);
    // The home page's sections stay one press away from every page.
    for (const href of ['/#explore', '/#models', '/#faq']) assert.ok(NAV_CATEGORIES.some((c) => c.href === href), href);
    assert.equal(NAV_CATEGORIES.at(-1).href, '/social-cinema', 'a page that says it is not open yet does not lead');
    for (const id of ['explore', 'models', 'faq']) {
        const found = ['hero', 'showcase', 'footer'].some((s) => read(`app/veyrnox/_sections/${s}.js`).includes(`id="${id}"`));
        assert.ok(found, `the home page has no section #${id}`);
    }
    // From another page the home page arrives behind its loading state, so the
    // browser often finds no section to go to. The page makes that jump itself.
    assert.match(read('app/veyrnox/page.js'), /<SectionJump \/>/);
    const jump = read('app/veyrnox/_components/SectionJump.js');
    assert.match(jump, /if \(window\.scrollY > 0\) return;/, 'never moves a reader who has scrolled');
    assert.match(jump, /document\.getElementById\(id\)\?\.scrollIntoView\(\{ behavior: 'instant' \}\)/);
});

test('a page title is one of two sizes', () => {
    const css = read('app/veyrnox/veyrnox.css').replace(/\s+/g, ' ');
    assert.match(css, /\.vx-title-index \{ font-size: 52px; \}/);
    assert.match(css, /\.vx-title-detail \{ font-size: 40px; \}/);
    assert.match(css, /min-width: 40rem\) \{ \.vx-title-index \{ font-size: 76px; \} \.vx-title-detail \{ font-size: 56px; \} \}/);
    assert.match(css, /min-width: 64rem\) \{ \.vx-title-index \{ font-size: 92px; \} \}/);
    const titles = (f) => [...read(f).matchAll(/<h1 className="([^"]*)"/g)].map((m) => m[1]);
    for (const [files, size] of [[INDEX_PAGES, 'vx-title-index'], [DETAIL_PAGES, 'vx-title-detail']]) {
        for (const f of files) {
            const found = titles(f);
            assert.ok(found.length > 0, `${f} has no <h1>`);
            for (const cls of found) {
                assert.ok(cls.split(' ').includes('vx-display') && cls.split(' ').includes(size), `${f}: "${cls}"`);
                assert.doesNotMatch(cls, /text-\[\d+px\]|text-\dxl/, `${f} sets its own title size`);
            }
        }
    }
    // On the home page the hero line and the closing line share the index
    // size, and nothing is set larger.
    assert.match(read('app/veyrnox/_sections/hero.js'), /<h[12] className="vx-display vx-title-index">\s*The price is on the button\./);
    const closing = read('app/veyrnox/_sections/footer.js');
    assert.match(closing.slice(closing.indexOf('export function ClosingCTA')), /<h2 className="vx-display vx-title-index /);
    for (const s of ['hero', 'film', 'showcase', 'footer']) {
        assert.doesNotMatch(read(`app/veyrnox/_sections/${s}.js`), /text-\[(9[3-9]|\d{3,})px\]/, `${s}.js`);
    }
});

test('every public page starts on the same left edge', () => {
    // The loading skeleton too: a page must not jump sideways when it replaces it.
    for (const f of [...INDEX_PAGES, ...DETAIL_PAGES, 'app/veyrnox/_sections/hero.js', 'app/veyrnox/_sections/film.js', 'app/veyrnox/social-cinema/watch/[id]/Player.js', 'app/veyrnox/loading.js']) {
        const shells = [...read(f).matchAll(/className="([^"]*\bmx-auto\b[^"]*)"/g)].map((m) => m[1])
            .filter((cls) => /\bpx-4\b/.test(cls));
        assert.ok(shells.length > 0, `${f} has no page shell`);
        for (const cls of shells) {
            assert.match(cls, /max-w-\[1300px\]/, `${f}: "${cls}"`);
            assert.match(cls, /\bsm:px-6\b/, `${f}: "${cls}"`);
        }
    }
});

test('one premium label and one large-panel radius', () => {
    for (const [f, src] of SOURCES) {
        if (f !== 'app/veyrnox/_components/PremiumTag.js') assert.doesNotMatch(src, />premium<\/span>/, `${f} draws its own premium label`);
        assert.doesNotMatch(src, /rounded-3xl/, `${f}: large panels are rounded-2xl`);
    }
});
