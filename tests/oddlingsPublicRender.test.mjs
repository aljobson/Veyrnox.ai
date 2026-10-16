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
};
// Resolved file -> stand-in. The nav is a client component that reads the router.
const stubs = new Map([[abs('app/veyrnox/_components/NavBar.js'), { MarketingNav: () => React.createElement('nav', { 'data-stub': 'marketing-nav' }) }]]);
const cache = new Map();

function resolveRelative(fromFile, id) {
    const base = path.resolve(path.dirname(fromFile), id);
    for (const candidate of [base, `${base}.js`, path.join(base, 'index.js')]) {
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
const renderIndex = () => renderToStaticMarkup(indexPage.default());
const renderDetail = async (id) => renderToStaticMarkup(await detailPage.default({ params: Promise.resolve({ id }) }));
const escapeHtml = (text) => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#x27;');

test('while the flag is off every route is not-found, with a noindex head', async () => {
    for (const flag of [undefined, 'false', 'TRUE', '']) {
        await withFlag(flag, async () => {
            assert.throws(() => indexPage.default(), { message: NOT_FOUND });
            await assert.rejects(renderDetail(cast[0].id), { message: NOT_FOUND });
            assert.deepEqual(indexPage.generateMetadata(), { title: 'Page not found', robots: { index: false } });
            assert.deepEqual(await detailPage.generateMetadata({ params: Promise.resolve({ id: cast[0].id }) }),
                { title: 'Page not found', robots: { index: false } });
        });
    }
});

test('with the flag on the gallery lists every character with portrait, hook, kind and both studio links', () => withFlag('true', () => {
    const html = renderIndex();
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
    assert.match(html, />Copy link to this gallery</);
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
        assert.match(html, /<button type="button"[^>]*>Copy link<\/button>/);
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

test('static params cover exactly the cast and unknown ids are refused by the router', () => {
    assert.deepEqual(detailPage.generateStaticParams(), cast.map((o) => ({ id: o.id })));
    assert.equal(detailPage.dynamicParams, false);
    assert.equal(detailPage.dynamic, 'force-dynamic');
    assert.equal(indexPage.dynamic, 'force-dynamic');
});

test('page metadata keeps the site name and type and carries the character portrait', () => withFlag('true', async () => {
    const index = indexPage.generateMetadata();
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
