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
