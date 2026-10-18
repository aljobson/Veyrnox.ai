import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Renders the real page modules, with the flag on and off, to markup. The
// framework pieces a plain Node process cannot load (next/link, notFound, the
// client-side nav) are stubbed; everything else, the pages, the card, the share
// control, the helper library and the cast data, is the shipped source.

const require = createRequire(import.meta.url);
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const abs = (rel) => path.join(ROOT, rel);

const NOT_FOUND = 'NEXT_NOT_FOUND';
const framework = {
    'next/link': { __esModule: true, default: ({ href, children, ...rest }) => React.createElement('a', { href, ...rest }, children) },
    'next/navigation': { notFound() { throw Object.assign(new Error(NOT_FOUND), { digest: 'NEXT_HTTP_ERROR_FALLBACK;404' }); } },
    // The pages read the visitor's language from a request header (ADR-0107); with none it is English.
    'next/headers': { headers: async () => new Headers() },
};
// Resolved file -> stand-in. The nav is a client component that reads the router.
const stubs = new Map([[abs('app/veyrnox/_components/NavBar.js'), { MarketingNav: () => React.createElement('nav', { 'data-stub': 'marketing-nav' }) }]]);
const cache = new Map();

function resolveRelative(fromFile, id) {
    const base = path.resolve(path.dirname(fromFile), id);
    for (const candidate of [base, `${base}.js`, `${base}.jsx`, `${base}.mjs`, path.join(base, 'index.js')]) {
        try { readFileSync(candidate); return candidate; } catch { /* try the next */ }
    }
    throw new Error(`cannot resolve ${id} from ${fromFile}`);
}

function load(file) {
    if (stubs.has(file)) return stubs.get(file);
    if (cache.has(file)) return cache.get(file).exports;
    const module = { exports: {} };
    cache.set(file, module);
    const code = ts.transpileModule(readFileSync(file, 'utf8'), {
        compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
    }).outputText;
    new Function('require', 'module', 'exports', code)((id) => {
        if (framework[id]) return framework[id];
        return id.startsWith('.') ? load(resolveRelative(file, id)) : require(id);
    }, module, module.exports);
    return module.exports;
}

const lib = load(abs('app/veyrnox/_lib/oddlingsPublic.js'));
const indexPage = load(abs('app/veyrnox/oddlings/page.js'));
const detailPage = load(abs('app/veyrnox/oddlings/[id]/page.js'));
const seo = load(abs('app/seo.js'));
const cast = lib.listPublicOddlings();

async function withFlag(value, run) {
    const previous = process.env.ODDLINGS_PUBLIC_ENABLED;
    if (value === undefined) delete process.env.ODDLINGS_PUBLIC_ENABLED;
    else process.env.ODDLINGS_PUBLIC_ENABLED = value;
    try { return await run(); } finally {
        if (previous === undefined) delete process.env.ODDLINGS_PUBLIC_ENABLED;
        else process.env.ODDLINGS_PUBLIC_ENABLED = previous;
    }
}
const renderIndex = async () => renderToStaticMarkup(await indexPage.default());
const renderDetail = async (id) => renderToStaticMarkup(await detailPage.default({ params: Promise.resolve({ id }) }));
const unescapeHtml = (text) => text.replaceAll('&quot;', '"').replaceAll('&#x27;', "'").replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&amp;', '&');
// Text between tags, read character by character. A regex tag-stripper is the pattern
// CodeQL flags (js/incomplete-multi-character-sanitization), and this is a test helper
// reading our own server-rendered markup, so a plain scanner is the clearer tool.
function visibleText(html) {
    let text = '';
    let inTag = false;
    for (const char of html) {
        if (char === '<') inTag = true;
        else if (char === '>' && inTag) inTag = false;
        else if (!inTag) text += char;
    }
    return text;
}
// WCAG 2.5.3 (Label in Name): a control's accessible name must contain the text it shows,
// so a voice-control user who says what they see gets the control.
function labelInNameFailures(html) {
    const failures = [];
    for (const match of html.matchAll(/<(a|button)\b([^>]*)>([\s\S]*?)<\/\1>/g)) {
        const label = /\saria-label="([^"]*)"/.exec(match[2]);
        const visible = unescapeHtml(visibleText(match[3])).trim().toLowerCase();
        if (label && visible && !unescapeHtml(label[1]).toLowerCase().includes(visible)) failures.push(`${unescapeHtml(label[1])} / ${visible}`);
    }
    return failures;
}
const escapeHtml = (text) => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#x27;');

test('while the flag is off every route is not-found, with a noindex head', async () => {
    for (const flag of [undefined, 'false', 'TRUE', '']) {
        await withFlag(flag, async () => {
            await assert.rejects(Promise.resolve().then(() => indexPage.default()), { message: NOT_FOUND });
            await assert.rejects(renderDetail(cast[0].id), { message: NOT_FOUND });
            assert.deepEqual(await indexPage.generateMetadata(), { title: 'Page not found', robots: { index: false } });
            assert.deepEqual(await detailPage.generateMetadata({ params: Promise.resolve({ id: cast[0].id }) }),
                { title: 'Page not found', robots: { index: false } });
        });
    }
});

test('with the flag on the gallery lists every character with portrait, hook, kind and both studio links', () => withFlag('true', async () => {
    const html = await renderIndex();
    assert.match(html, /<h1[^>]*>Meet the Oddlings\.<\/h1>/);
    assert.equal((html.match(/data-stub="marketing-nav"/g) || []).length, 1, 'the public nav');
    assert.equal((html.match(/<main[\s>]/g) || []).length, 1, 'exactly one <main>');
    assert.equal((html.match(/<li /g) || []).length, cast.length, 'one card per character');
    assert.match(html, new RegExp(`${cast.length} characters with a look`));
    for (const oddling of cast) {
        assert.ok(html.includes(`href="${oddling.path}"`), `${oddling.id} links to its page`);
        assert.ok(html.includes(`src="${oddling.portrait.src}"`), `${oddling.id} portrait`);
        assert.ok(html.includes(escapeHtml(oddling.hook)), `${oddling.id} hook`);
        assert.equal(html.split(`href="${oddling.studioHref}"`).length - 1, 2, `${oddling.id} Recreate and Animate`);
        assert.ok(html.includes(`>${oddling.name}</a>`), `${oddling.id} name`);
    }
    assert.match(html, /Humans/);
    assert.match(html, /Other beings/);
    assert.match(html, />Share link to this gallery</);
    assert.doesNotMatch(html, />Copy link/, 'the control may open a share sheet, so it is not called Copy');
    assert.equal((html.match(/loading="eager"/g) || []).length, 4, 'only the first row loads at once');
    assert.doesNotMatch(html, /<canvas|<script/i, 'no puppet canvases and no inline script');
    assert.doesNotMatch(html, /ai[ -]influencer|influencer/i);
}));

test('with the flag on each character page renders its own content and the studio deep links', () => withFlag('true', async () => {
    for (const oddling of cast) {
        const html = await renderDetail(oddling.id);
        assert.match(html, new RegExp(`<h1[^>]*>${oddling.name}</h1>`), `${oddling.id} heading`);
        assert.equal((html.match(/<h1/g) || []).length, 1);
        assert.equal((html.match(/<main[\s>]/g) || []).length, 1);
        assert.ok(html.includes(`src="${oddling.portrait.src}"`));
        assert.ok(html.includes(`alt="${oddling.portrait.alt}"`));
        assert.match(html, /not a real person/);
        // Recreate and Animate go to /app/oddlings?oddling=<id>, built with encodeURIComponent.
        const studio = html.match(/<a [^>]*href="(\/app\/oddlings\?oddling=[^"]+)"[^>]*>(Recreate|Animate this character)<\/a>/g) || [];
        assert.equal(studio.length, 2, `${oddling.id} has Recreate and Animate`);
        for (const link of studio) assert.ok(link.includes(`href="/app/oddlings?oddling=${encodeURIComponent(oddling.id)}"`));
        assert.match(html, /<button type="button"[^>]*>Share link<\/button>/);
        assert.doesNotMatch(html, />Copy link/, 'the control may open a share sheet, so it is not called Copy');
        assert.match(html, /role="status"/);
        assert.ok(html.includes('href="/oddlings"'), 'back to the gallery');
        assert.ok(html.includes(oddling.premise.voice) && html.includes(oddling.premise.show));
        // Four neighbours, none of them this character.
        const near = lib.neighbouringOddlings(oddling.id);
        assert.equal(near.length, 4);
        for (const other of near) assert.ok(html.includes(`href="${other.path}"`), `${oddling.id} links to ${other.id}`);
        assert.ok(!html.includes(`href="${oddling.path}"`), 'a page does not link to itself');
    }
}));

test('an id outside the cast is not-found even with the flag on', () => withFlag('true', async () => {
    for (const id of ['portraits', 'oddling-cast.webp', '../app', 'Duchess-Volume', '', 'nobody-here', '__proto__']) {
        await assert.rejects(renderDetail(id), { message: NOT_FOUND }, JSON.stringify(id));
        assert.deepEqual(await detailPage.generateMetadata({ params: Promise.resolve({ id }) }),
            { title: 'Page not found', robots: { index: false } });
    }
}));

test('the pages render per request and carry no static-params exports that force-dynamic would ignore', () => {
    // force-dynamic makes generateStaticParams and dynamicParams = false inert: an id outside the
    // cast reaches the page and renders the not-found body (a streamed, noindex page, like /models/<id>).
    // Exporting them implied a router-level 404 that never happens, so they must not come back.
    assert.equal(detailPage.generateStaticParams, undefined);
    assert.equal(detailPage.dynamicParams, undefined);
    assert.equal(detailPage.dynamic, 'force-dynamic');
    assert.equal(indexPage.dynamic, 'force-dynamic');
});

test('every labelled link names what it shows (Label in Name)', () => withFlag('true', async () => {
    assert.deepEqual(labelInNameFailures(await renderIndex()), []);
    for (const oddling of cast) assert.deepEqual(labelInNameFailures(await renderDetail(oddling.id)), [], oddling.id);
    // The checker itself: it must catch the mismatch it exists for.
    assert.deepEqual(labelInNameFailures('<a href="/x" aria-label="Animate Duchess Volume">Animate this character</a>'),
        ['Animate Duchess Volume / animate this character']);
    assert.deepEqual(labelInNameFailures('<a href="/x" aria-label="Animate Duchess Volume">Animate</a>'), []);
    assert.deepEqual(labelInNameFailures('<a href="/x">Animate this character</a>'), []);
}));

test('page metadata keeps the site name and type and carries the character portrait', () => withFlag('true', async () => {
    const index = await indexPage.generateMetadata();
    assert.equal(index.alternates.canonical, '/oddlings');
    assert.deepEqual(index.openGraph.images, [seo.OG_IMAGE]);
    assert.equal(index.openGraph.siteName, 'Veyrnox.ai');
    for (const oddling of cast) {
        const meta = await detailPage.generateMetadata({ params: Promise.resolve({ id: oddling.id }) });
        assert.equal(meta.alternates.canonical, `/oddlings/${oddling.id}`);
        assert.equal(meta.openGraph.url, `/oddlings/${oddling.id}`);
        assert.equal(meta.openGraph.siteName, 'Veyrnox.ai');
        assert.equal(meta.openGraph.type, 'website');
        assert.equal(meta.openGraph.images.length, 1, 'the portrait replaces the site card');
        assert.equal(meta.openGraph.images[0].url, oddling.portrait.src);
        assert.equal(meta.twitter.images[0].url, oddling.portrait.src);
        assert.ok(meta.title.includes(oddling.name));
    }
}));
