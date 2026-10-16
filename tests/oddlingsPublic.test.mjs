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

// The public, signed-out Oddlings gallery: /oddlings and /oddlings/<id>.
// It shows the first-party cast only (no moderation needed), sits behind a
// server flag that ships "false" in production, and links into the studio.

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

test('the flag ships "false" in production and "true" in staging', () => {
    const config = parseJsonc(read('wrangler.jsonc'));
    assert.equal(config.vars.ODDLINGS_PUBLIC_ENABLED, 'false');
    assert.equal(config.env.staging.vars.ODDLINGS_PUBLIC_ENABLED, 'true');
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
    assert.match(detail, /export function generateStaticParams\(\) \{\s*return listPublicOddlings\(\)\.map\(\(o\) => \(\{ id: o\.id \}\)\);\s*\}/);
    assert.match(detail, /export const dynamicParams = false;/);
    assert.match(detail, /publicOddlingById\(id\)/);
    assert.match(detail, /\{ \.\.\.OPEN_GRAPH_BASE, \.\.\.meta\.openGraph \}/, 'the site name and type come from the shared base');
    assert.match(index, /\{ \.\.\.OPEN_GRAPH_BASE, \.\.\.meta\.openGraph \}/);
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
    assert.match(detail, />\s*Recreate\s*</);
    assert.match(detail, />\s*Animate/);
    assert.match(card, />\s*Recreate\s*</);
    assert.match(card, />\s*Animate\s*</);
    for (const source of [detail, card]) assert.match(source, /href=\{[a-z.]*studioHref\}/);
    assert.match(index, /OddlingCard/);
    assert.doesNotMatch(`${index}${detail}${card}`, /\/app\/oddlings\?oddling=\$\{/, 'the URL comes from oddlingStudioHref, not a template literal');
});

test('the share control copies a same-origin link and fails soft', () => {
    const source = read('app/veyrnox/oddlings/ShareLinkButton.js');
    assert.match(source, /^'use client';/);
    assert.match(source, /window\.location\.origin/);
    assert.match(source, /navigator\.share/);
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
    const copy = files.map(read).join('\n');
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
    assert.equal(more.featured, true);
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
