import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { breadcrumbLd, howToLd } from '../lib/jsonLd.js';

const llms = readFileSync(new URL('../public/llms.txt', import.meta.url), 'utf8');
const sitemapSource = readFileSync(new URL('../app/sitemap.js', import.meta.url), 'utf8');

test('llms.txt starts with the site name and a one-paragraph summary', () => {
    assert.match(llms, /^# Veyrnox\.ai\n\n> /);
});

test('llms.txt links only to veyrnox.ai and quotes no price', () => {
    const urls = [...llms.matchAll(/\]\((https?:[^)]+)\)/g)].map((m) => m[1]);
    assert.ok(urls.length > 10);
    for (const url of urls) assert.ok(url.startsWith('https://veyrnox.ai/'), `${url} is off-site`);
    assert.doesNotMatch(llms, /[$£€]\s?\d|\b\d+\s?credits?\b/i, 'prices belong to the catalog, not to a static file');
});

test('every guide in the guide list is linked from llms.txt', () => {
    const guides = readFileSync(new URL('../app/veyrnox/_lib/guides.js', import.meta.url), 'utf8');
    for (const [, id] of guides.matchAll(/^\s{4}id: '([a-z-]+)',/gm)) {
        assert.ok(llms.includes(`/guides/${id})`), `guide ${id} is missing from llms.txt`);
    }
    assert.ok(sitemapSource.includes('/guides'));
});

test('breadcrumbLd numbers items from 1 and makes every address absolute', () => {
    const ld = breadcrumbLd([{ name: 'Home', href: '/' }, { name: 'Guides', href: '/guides' }]);
    assert.equal(ld['@type'], 'BreadcrumbList');
    assert.deepEqual(ld.itemListElement.map((i) => [i.position, i.item]), [[1, 'https://veyrnox.ai'], [2, 'https://veyrnox.ai/guides']]);
});

test('howToLd carries every step in order', () => {
    const ld = howToLd({ name: 'N', description: 'D', href: '/guides/x', steps: [{ name: 'a', text: 'A' }, { name: 'b', text: 'B' }] });
    assert.equal(ld['@type'], 'HowTo');
    assert.equal(ld.url, 'https://veyrnox.ai/guides/x');
    assert.deepEqual(ld.step.map((s) => s.position), [1, 2]);
});

test('modelServiceLd prices from the pack range in dollars and omits the offer without one', async () => {
    const { modelServiceLd } = await import('../lib/jsonLd.js');
    const base = { name: 'M', description: 'D', href: '/models/m' };
    const priced = modelServiceLd({ ...base, range: { minCents: 8, maxCents: 15 } });
    assert.equal(priced.offers.priceCurrency, 'USD');
    assert.equal(priced.offers.lowPrice, '0.08');
    assert.equal(priced.offers.highPrice, '0.15');
    assert.equal('offers' in modelServiceLd({ ...base, range: null }), false);
});

test('the credits guide is an Article, not a HowTo', async () => {
    const guides = readFileSync(new URL('../app/veyrnox/_lib/guides.js', import.meta.url), 'utf8');
    assert.match(guides, /id: 'credits',\n(?:.*\n)*?\s+explainer: true,/);
    const { articleLd } = await import('../lib/jsonLd.js');
    assert.equal(articleLd({ name: 'N', description: 'D', href: '/guides/credits' })['@type'], 'Article');
});

test('every guide leads with a short answer of two sentences or fewer', async () => {
    const { GUIDES } = await import('../app/veyrnox/_lib/guides.js');
    for (const g of GUIDES) {
        assert.ok(typeof g.answer === 'string' && g.answer.length > 40, `${g.id} has no answer`);
        const sentences = g.answer.split(/(?<=[.!?])\s+/).length;
        assert.ok(sentences <= 2, `${g.id} answer runs to ${sentences} sentences`);
    }
});

test('comparison slugs: one canonical address per pair, same modality, prompt-only generators', async () => {
    const { parsePair, pairSlug, comparisonSlugs } = await import('../lib/comparePairs.js');
    assert.equal(pairSlug('wan-2.5-kie', 'kling-2.6'), 'kling-2.6-vs-wan-2.5-kie');
    assert.deepEqual(parsePair('kling-2.6-vs-wan-2.5-kie'), ['kling-2.6', 'wan-2.5-kie']);
    for (const bad of ['', 'a', 'a-vs-', '-vs-b', 'a-vs-a', 'A-vs-b', 'a/b-vs-c', undefined]) assert.equal(parsePair(bad), null, String(bad));
    const gen = (id, modality, media = {}) => ({ id, modality, capabilities: { inputs: { prompt: {} }, media } });
    const models = [
        gen('i1', 'text-to-image'), gen('i2', 'text-to-image'), gen('v1', 'text-to-video'), gen('v2', 'text-to-video'),
        gen('a1', 'text-to-audio'),
        gen('edit', 'text-to-image', { image: { required: true } }),
        { id: 'tool', modality: 'text-to-image', capabilities: { inputs: {}, media: {} } },
    ];
    assert.deepEqual(comparisonSlugs(models), ['i1-vs-i2', 'v1-vs-v2']);
    assert.equal(comparisonSlugs(Array.from({ length: 9 }, (_, n) => gen(`m${n}`, 'text-to-video'))).length, 6);
});

test('every guide carries a valid update date and the schema helpers pass it on', async () => {
    const { GUIDES } = await import('../app/veyrnox/_lib/guides.js');
    for (const g of GUIDES) assert.match(g.updated, /^\d{4}-\d{2}-\d{2}$/, g.id);
    const { howToLd, articleLd, itemListLd } = await import('../lib/jsonLd.js');
    assert.equal(howToLd({ name: 'N', description: 'D', href: '/guides/x', steps: [], dateModified: '2026-11-01' }).dateModified, '2026-11-01');
    assert.equal('dateModified' in articleLd({ name: 'N', description: 'D', href: '/guides/x' }), false);
    const list = itemListLd([{ name: 'A', href: '/a' }, { name: 'B', href: '/b' }]);
    assert.deepEqual([list.numberOfItems, list.itemListElement[1].position, list.itemListElement[1].url], [2, 2, 'https://veyrnox.ai/b']);
});
