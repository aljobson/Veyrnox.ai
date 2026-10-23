import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { parseJsonc } from '../scripts/check-migration-ledger.mjs';
import { ODDLING_ARCHETYPES, ODDLING_SHOWS, ODDLING_TONES } from '../app/veyrnox/_lib/character.js';
import {
    ODDLINGS_PUBLIC_FLAG,
    listPublicOddlings,
    neighbouringOddlings,
    oddlingMetadata,
    oddlingPath,
    oddlingSitemapPaths,
    oddlingStudioHref,
    oddlingsIndexMetadata,
    oddlingsPublicEnabled,
    publicOddlingById,
} from '../app/veyrnox/_lib/oddlingsPublic.js';
import { NAV_CATEGORIES, SECONDARY_NAV_CATEGORIES, SITE_PAGES, navHref } from '../app/veyrnox/_lib/tokens.js';
import { AUTO_PRODUCT_INVENTORY } from '../lib/generatedProductInventory.js';
import {
    automaticProductKnowledgeContext,
    productKnowledgeContext,
    publicProductInventory,
    searchAutomaticProductKnowledge,
} from '../lib/productKnowledge.js';

// The public, signed-out Oddlings gallery: /oddlings and /oddlings/<id>.
// It shows the first-party cast only (no moderation needed), sits behind a
// server flag that production leaves out (absent is closed), and links into the studio.

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const ids = ODDLING_ARCHETYPES.map((a) => a.id);

test('only the exact string "true" opens the gallery', () => {
    assert.equal(ODDLINGS_PUBLIC_FLAG, 'ODDLINGS_PUBLIC_ENABLED');
    assert.equal(oddlingsPublicEnabled({ ODDLINGS_PUBLIC_ENABLED: 'true' }), true);
    for (const value of [undefined, '', 'false', 'TRUE', 'True', '1', 'yes', ' true', 'true ', true]) {
        assert.equal(oddlingsPublicEnabled({ ODDLINGS_PUBLIC_ENABLED: value }), false, String(value));
    }
    assert.equal(oddlingsPublicEnabled({}), false);
    assert.equal(oddlingsPublicEnabled(undefined), false);
    assert.equal(oddlingsPublicEnabled(null), false);
});

test('production and staging both name the flag "true"; a missing var stays closed', () => {
    // Production is at the Worker text-binding cap (tests/workerBindingBudget.test.mjs), so opening the gallery
    // replaced an unused false var rather than adding one. The code needs the exact string "true".
    const config = parseJsonc(read('wrangler.jsonc'));
    assert.equal(config.vars.ODDLINGS_PUBLIC_ENABLED, 'true');
    assert.equal(config.env.staging.vars.ODDLINGS_PUBLIC_ENABLED, 'true');
    assert.equal(oddlingsPublicEnabled({}), false, 'a missing var is closed');
});

test('the public roster is exactly the first-party cast', () => {
    const roster = listPublicOddlings();
    assert.ok(roster.length >= 32, 'the gallery lists the whole cast');
    assert.deepEqual(roster.map((o) => o.id), ids);
    assert.equal(new Set(roster.map((o) => o.id)).size, roster.length, 'ids are unique');
    for (const oddling of roster) {
        assert.ok(oddling.name && oddling.hook && oddling.accent, `${oddling.id} has its name, hook and accent`);
        assert.ok(['Human', 'Other being'].includes(oddling.kindLabel), `${oddling.id} kind label`);
        assert.match(oddling.portrait.src, /^\/oddlings\/portraits\/[a-z0-9-]+\.webp$/);
        assert.ok(existsSync(new URL(`../public${oddling.portrait.src}`, import.meta.url)), `${oddling.portrait.src} ships in public/`);
        assert.equal(oddling.path, `/oddlings/${oddling.id}`);
        assert.equal(oddling.studioHref, `/app/oddlings?oddling=${oddling.id}`);
        // The premise text is read from the same picks the character sheet shows.
        assert.ok(oddling.premise.obsession.length > 10, `${oddling.id} obsession`);
        assert.ok(ODDLING_TONES.some(([label]) => label === oddling.premise.voice), `${oddling.id} voice`);
        assert.ok(ODDLING_SHOWS.some(([label]) => label === oddling.premise.show), `${oddling.id} show`);
        assert.ok(oddling.premise.voiceNote && oddling.premise.showNote, `${oddling.id} voice and show notes`);
    }
    assert.ok(Object.isFrozen(roster) && Object.isFrozen(roster[0]), 'callers cannot edit the cast');
});

test('an id is accepted only when it names one of the cast', () => {
    for (const id of ids) assert.equal(publicOddlingById(id)?.id, id, id);
    const refused = [
        '', 'portraits', 'Duchess-Volume', 'duchess_volume', 'duchess volume', '-duchess', 'duchess-', 'duchess--volume',
        'duchess-volume.webp', 'duchess-volume/', '../duchess-volume', 'duchess-volume%2F..', '%2e%2e', 'a/b',
        '__proto__', 'constructor', 'toString', 'hasOwnProperty', 'x'.repeat(65), 'not-a-character',
        undefined, null, 7, {}, [], ['duchess-volume'],
    ];
    for (const id of refused) assert.equal(publicOddlingById(id), null, JSON.stringify(id));
});

test('URLs are built with encodeURIComponent and point at the studio deep link', () => {
    assert.equal(oddlingPath('duchess-volume'), '/oddlings/duchess-volume');
    assert.equal(oddlingStudioHref('duchess-volume'), '/app/oddlings?oddling=duchess-volume');
    assert.equal(oddlingStudioHref('a b&c=d'), '/app/oddlings?oddling=a%20b%26c%3Dd');
    assert.equal(oddlingPath('a/b'), '/oddlings/a%2Fb');
});

test('sitemap paths are the index plus one page per character', () => {
    const paths = oddlingSitemapPaths();
    assert.equal(paths.length, ids.length + 1);
    assert.equal(paths[0], '/oddlings');
    assert.deepEqual(paths.slice(1), ids.map((id) => `/oddlings/${id}`));
    assert.ok(paths.length >= 33, 'the 32 characters and the gallery page');
    assert.ok(!paths.some((p) => p.startsWith('/app')), 'the signed-in studio is never listed');
});

test('each character page has its own title, description, canonical, Open Graph and Twitter card with the portrait', () => {
    const titles = new Set();
    for (const oddling of listPublicOddlings()) {
        const meta = oddlingMetadata(oddling);
        titles.add(meta.title);
        assert.ok(meta.title.includes(oddling.name), 'the title names the character');
        assert.ok(!meta.title.includes('Veyrnox'), 'the root template adds the site name');
        assert.ok(meta.description.includes(oddling.hook), 'the description carries the hook');
        assert.ok(/original fictional/i.test(meta.description));
        assert.ok(meta.description.length <= 200, `${oddling.id} description is ${meta.description.length} characters`);
        assert.equal(meta.alternates.canonical, `/oddlings/${oddling.id}`);
        assert.equal(meta.openGraph.url, `/oddlings/${oddling.id}`);
        assert.equal(meta.openGraph.title, `${meta.title} — Veyrnox.ai`);
        assert.equal(meta.openGraph.description, meta.description);
        assert.deepEqual(meta.openGraph.images, [{
            url: oddling.portrait.src, width: 1024, height: 1536, alt: oddling.portrait.alt,
        }]);
        assert.equal(meta.twitter.card, 'summary');
        assert.equal(meta.twitter.title, meta.openGraph.title);
        assert.equal(meta.twitter.description, meta.description);
        assert.deepEqual(meta.twitter.images, [{ url: oddling.portrait.src, alt: oddling.portrait.alt }]);
        assert.equal(meta.robots, undefined, 'a character page is indexable');
    }
    assert.equal(titles.size, ids.length, 'no two pages share a title');
});

test('the gallery page has its own metadata and falls back to the site card', () => {
    const meta = oddlingsIndexMetadata({ url: '/og.png', width: 1200, height: 630, alt: 'Site card' });
    assert.ok(meta.title && !meta.title.includes('Veyrnox'));
    assert.match(meta.description, /original fictional/i);
    assert.equal(meta.alternates.canonical, '/oddlings');
    assert.equal(meta.openGraph.url, '/oddlings');
    assert.equal(meta.openGraph.title, `${meta.title} — Veyrnox.ai`);
    assert.deepEqual(meta.openGraph.images, [{ url: '/og.png', width: 1200, height: 630, alt: 'Site card' }]);
    assert.equal(meta.twitter.card, 'summary_large_image');
    assert.deepEqual(meta.twitter.images, ['/og.png']);
    assert.equal(meta.robots, undefined);
});

test('neighbours wrap around the cast and never include the character itself', () => {
    for (const id of [ids[0], ids[5], ids.at(-1)]) {
        const near = neighbouringOddlings(id, 4);
        assert.equal(near.length, 4);
        assert.ok(near.every((o) => o.id !== id));
        assert.equal(new Set(near.map((o) => o.id)).size, 4);
    }
    assert.deepEqual(neighbouringOddlings(ids.at(-1), 2).map((o) => o.id), [ids[0], ids[1]]);
    assert.deepEqual(neighbouringOddlings('not-a-character', 4), []);
});

test('the pages read the flag per request, validate the id and import no client-only code', () => {
    const index = read('app/veyrnox/oddlings/page.js');
    const detail = read('app/veyrnox/oddlings/[id]/page.js');
    for (const [name, source] of [['index', index], ['detail', detail]]) {
        assert.match(source, /export const dynamic = 'force-dynamic';/, `${name} reads the flag at request time`);
        assert.match(source, /if \(!oddlingsPublicEnabled\(\)\) notFound\(\);/, `${name} is closed while the flag is off`);
        assert.match(source, /<MarketingNav \/>[\s\S]*<Main[\s>]/, `${name} renders the public nav and the one <main>`);
        assert.doesNotMatch(source, /^['"]use client['"]/m, `${name} is a server component`);
        assert.doesNotMatch(source, /\buse(State|Effect|Ref|Router|Memo|Callback|Layout)\b/, `${name} uses no hooks`);
        assert.doesNotMatch(source, /OddlingStudio|OddlingGalleryPreview|oddlingPuppet|CharacterPanel|WebGL|<canvas|from 'three'/i,
            `${name} pulls in no studio or puppet code`);
        assert.doesNotMatch(source, /dangerouslySetInnerHTML/);
    }
    // force-dynamic makes these two inert, and they imply a router-level 404 that does not happen.
    assert.doesNotMatch(detail, /export (?:async )?(?:function generateStaticParams|const dynamicParams)/);
    assert.match(detail, /publicOddlingById\(id\)/);
    assert.match(detail, /\{ \.\.\.OPEN_GRAPH_BASE, \.\.\.meta\.openGraph(?:, \.\.\.openGraphLocale\(locale\))? \}/, 'the site name and type come from the shared base');
    assert.match(index, /\{ \.\.\.OPEN_GRAPH_BASE, \.\.\.meta\.openGraph(?:, \.\.\.openGraphLocale\(locale\))? \}/);
    // generateMetadata must not describe a page that answers 404.
    assert.match(detail, /robots: \{ index: false \}/);
    // The one client file is the share control; nothing else under the route is.
    const files = readdirSync(new URL('../app/veyrnox/oddlings/', import.meta.url), { recursive: true }).filter((f) => /\.js$/.test(f));
    const clientFiles = files.filter((f) => /^['"]use client['"]/m.test(read(`app/veyrnox/oddlings/${f}`)));
    assert.deepEqual(clientFiles, ['ShareLinkButton.js']);
});

test('the Recreate and Animate buttons link to the studio deep link', () => {
    const index = read('app/veyrnox/oddlings/page.js');
    const detail = read('app/veyrnox/oddlings/[id]/page.js');
    const card = read('app/veyrnox/oddlings/OddlingCard.js');
    // The words are catalog text (ADR-0107); the English catalog holds the originals.
    const english = read('lib/i18n/messages/en.mjs');
    assert.match(english, /'oddlings\.recreate': 'Recreate'/);
    assert.match(english, /'oddlings\.animate': 'Animate'/);
    assert.match(english, /'oddlings\.detail\.animateThis': 'Animate this character'/);
    assert.match(detail, /t\('oddlings\.recreate'\)/);
    assert.match(detail, /t\('oddlings\.detail\.animateThis'\)/);
    assert.match(card, /t\('oddlings\.recreate'\)/);
    assert.match(card, /t\('oddlings\.animate'\)/);
    for (const source of [detail, card]) assert.match(source, /href=\{[a-z.]*studioHref\}/);
    assert.match(index, /OddlingCard/);
    assert.doesNotMatch(`${index}${detail}${card}`, /\/app\/oddlings\?oddling=\$\{/, 'the URL comes from oddlingStudioHref, not a template literal');
});

test('the share control copies a same-origin link and fails soft', () => {
    const source = read('app/veyrnox/oddlings/ShareLinkButton.js');
    assert.match(source, /^'use client';/);
    assert.match(source, /window\.location\.origin/);
    assert.match(source, /navigator\.share/);
    // It offers the share sheet where one exists, so it is not labelled Copy.
    assert.match(source, /label \?\?= t\('oddlings.shareDefault'\)/);
    assert.doesNotMatch(source, /Copy link/);
    assert.match(source, /navigator\.clipboard/);
    assert.match(source, /role="status"/);
    assert.match(source, /try \{/);
    assert.match(source, /catch/);
});

test('copy describes original fictional characters and avoids the influencer framing', () => {
    const files = readdirSync(new URL('../app/veyrnox/oddlings/', import.meta.url), { recursive: true })
        .filter((f) => /\.js$/.test(f)).map((f) => `app/veyrnox/oddlings/${f}`);
    files.push('app/veyrnox/_lib/oddlingsPublic.js');
    assert.ok(files.length >= 5);
    // The page copy lives in the English catalog (ADR-0107): hold it to the same rules.
    const catalogCopy = read('lib/i18n/messages/en.mjs').split('\n').filter((line) => /^\s*'oddlings?\./.test(line)).join('\n');
    const copy = [...files.map(read), catalogCopy].join('\n');
    assert.doesNotMatch(copy, /ai[ -]influencer|influencer/i);
    assert.doesNotMatch(copy, /wallet|multichain|on-?chain|payout|ethereum|solana/i, 'inside the hard wall');
    assert.match(copy, /original/i);
    assert.match(copy, /fictional/i);
    assert.match(copy, /adult/i);
    assert.match(copy, /not a real person/i);
});

test('the More menu and site pages point at the public gallery, and fall back to the studio while it is closed', () => {
    const more = SECONDARY_NAV_CATEGORIES.find((item) => item.label === 'Oddlings');
    const page = SITE_PAGES.find((item) => item.label === 'Oddlings');
    for (const item of [more, page]) {
        assert.equal(item.href, '/oddlings');
        assert.equal(item.studioHref, '/app/oddlings');
        assert.equal(navHref(item, true), '/oddlings');
        assert.equal(navHref(item, false), '/app/oddlings', 'a closed gallery must not leave a dead link in the nav');
    }
    assert.equal(more.featured, undefined, 'Oddlings is not permanently highlighted when another page is active');
    assert.equal(navHref({ href: '/models' }, false), '/models');
    assert.ok(NAV_CATEGORIES.includes(more));
});

test('the flag reaches the nav through the shared layout, not the browser', () => {
    const layout = read('app/veyrnox/layout.js');
    assert.match(layout, /<OddlingsPublicFlagProvider enabled=\{oddlingsPublicEnabled\(\)\}>/);
    // The layout wraps every page, so it reads the flag from the small module and never loads the cast.
    assert.match(layout, /from '\.\/_lib\/oddlingsPublicFlag';/);
    assert.doesNotMatch(layout, /_lib\/oddlingsPublic'/);
    assert.doesNotMatch(read('app/veyrnox/_lib/oddlingsPublicFlag.js'), /^import /m);
    const flag = read('app/veyrnox/_components/OddlingsPublicFlag.js');
    assert.match(flag, /^'use client';/);
    assert.match(flag, /createContext\(false\)/);
    assert.match(flag, /enabled === true/);
    assert.match(read('app/veyrnox/_components/MobileMenu.js'), /navHref\(it, oddlingsPublic\)/);
    assert.match(read('app/veyrnox/_components/SiteSearch.js'), /navHref\(p, oddlingsPublic\)/);
    // The studio tab already carries Oddlings, so its menu must not list it twice.
    assert.match(read('app/veyrnox/_components/NavBar.js'), /!item\.href\.startsWith\('\/app\/'\) && !item\.studioHref/);
});

test('/oddlings is rewritten to the route, leaves portrait files alone and /veyrnox/oddlings is redirected', () => {
    const config = read('next.config.mjs');
    assert.match(config, /\{ source: '\/oddlings', destination: '\/veyrnox\/oddlings' \}/);
    // A bare :id would also capture /oddlings/oddling-cast.webp and hide the
    // static sheets before public/ is consulted. An id never contains a dot.
    assert.match(config, /\{ source: '\/oddlings\/:id\(\[a-z0-9-\]\+\)', destination: '\/veyrnox\/oddlings\/:id' \}/);
    assert.match(config, /\{ source: '\/veyrnox\/oddlings', destination: '\/oddlings', permanent: true \}/);
    assert.match(config, /\{ source: '\/veyrnox\/oddlings\/:id', destination: '\/oddlings\/:id', permanent: true \}/);
    assert.doesNotMatch(config, /source: '\/oddlings\/:path\*'/, 'portraits are served from public/, not rewritten');
});

// Vey is given the discovered pages as grounding. A page that answers not-found
// must not be named to a visitor, so the gallery's two routes are left out
// while the flag is closed and come back when it opens.
const GALLERY_ROUTE = /^\/oddlings(?:\/|$)/;
const GALLERY_QUESTION = 'Meet the Oddlings: browse free, then recreate one as your own or animate it in the studio';

test('the generated inventory holds the gallery routes, and the closed gate hides them from Vey', () => {
    const generated = AUTO_PRODUCT_INVENTORY.filter((entry) => GALLERY_ROUTE.test(entry.route)).map((entry) => entry.route).sort();
    assert.deepEqual(generated, ['/oddlings', '/oddlings/[id]'], 'the sync still records both gallery routes');
    for (const env of [{}, { ODDLINGS_PUBLIC_ENABLED: 'false' }, { ODDLINGS_PUBLIC_ENABLED: 'TRUE' }, undefined]) {
        const visible = publicProductInventory(env);
        assert.ok(!visible.some((entry) => GALLERY_ROUTE.test(entry.route)), JSON.stringify(env));
        assert.equal(visible.length, AUTO_PRODUCT_INVENTORY.length - 2, 'only the gallery routes are removed');
        assert.ok(visible.some((entry) => entry.route === '/app/oddlings'), 'the signed-in studio stays known');
    }
    const open = publicProductInventory({ ODDLINGS_PUBLIC_ENABLED: 'true' });
    assert.equal(open.length, AUTO_PRODUCT_INVENTORY.length);
    assert.ok(open.some((entry) => entry.route === '/oddlings') && open.some((entry) => entry.route === '/oddlings/[id]'));
});

test('Vey does not name /oddlings while the gallery is closed, and does once it is open', () => {
    const closed = searchAutomaticProductKnowledge(GALLERY_QUESTION, '/oddlings', { routes: 60 }, {});
    assert.ok(closed.routes.length > 0, 'the search still finds other pages');
    assert.ok(!closed.routes.some((entry) => GALLERY_ROUTE.test(entry.route)));
    const open = searchAutomaticProductKnowledge(GALLERY_QUESTION, '/oddlings', { routes: 60 }, { ODDLINGS_PUBLIC_ENABLED: 'true' });
    assert.deepEqual(open.routes.map((entry) => entry.route).filter((route) => GALLERY_ROUTE.test(route)).sort(), ['/oddlings', '/oddlings/[id]']);

    const routeLine = /ROUTE: \/oddlings(?:\/|\n|$)/;
    assert.doesNotMatch(automaticProductKnowledgeContext(GALLERY_QUESTION, '/oddlings', {}), routeLine);
    assert.doesNotMatch(productKnowledgeContext(GALLERY_QUESTION, '/oddlings', [], {}), routeLine);
    assert.match(automaticProductKnowledgeContext(GALLERY_QUESTION, '/oddlings', { ODDLINGS_PUBLIC_ENABLED: 'true' }), routeLine);
    // A page where the closed flag does not matter is unchanged: the studio is still described.
    assert.match(productKnowledgeContext('How do I build a reusable Oddling character?', '/app/oddlings', [], {}), /Oddling Studio/);
});

test('with no env passed, Vey reads the Worker env and fails closed when it is absent', () => {
    const previous = process.env.ODDLINGS_PUBLIC_ENABLED;
    try {
        delete process.env.ODDLINGS_PUBLIC_ENABLED;
        assert.ok(!publicProductInventory().some((entry) => GALLERY_ROUTE.test(entry.route)));
        process.env.ODDLINGS_PUBLIC_ENABLED = 'true';
        assert.ok(publicProductInventory().some((entry) => entry.route === '/oddlings'));
    } finally {
        if (previous === undefined) delete process.env.ODDLINGS_PUBLIC_ENABLED;
        else process.env.ODDLINGS_PUBLIC_ENABLED = previous;
    }
});
