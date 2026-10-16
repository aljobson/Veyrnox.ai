import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPageManifest, PAGE_TEMPLATES, sitemapPaths, templateMatches } from '../e2e/page-manifest.mjs';

test('page sweep covers every canonical template and expands all concrete public paths', () => {
  const manifest = buildPageManifest(['/presets/a', '/presets/b', '/legal/privacy']);
  assert.deepEqual([...new Set(manifest.map(({ template }) => template))].sort(), PAGE_TEMPLATES.map(({ route }) => route).sort());
  assert.equal(manifest.filter(({ template }) => template === '/presets/[id]').length, 2);
  assert.ok(manifest.some(({ template, mode }) => template === '/social/review/[token]' && mode === 'negative-path'));
  assert.ok(manifest.some(({ pathname, access }) => pathname === '/app/admin' && access === 'admin-gate'));
});
test('fixtures are validated and never navigate to an external URL', () => {
  assert.throws(() => buildPageManifest([], { '/not-a-page': '/not-a-page' }));
  assert.throws(() => buildPageManifest([], { '/app/projects/[id]': '//evil.test/id' }));
  assert.throws(() => buildPageManifest([], { '/app/projects/[id]': '/wrong/id' }));
  assert.ok(buildPageManifest([], { '/app/projects/[id]': '/app/projects/known-id' }).some(({ pathname, mode }) => pathname === '/app/projects/known-id' && mode === 'render'));
  assert.equal(templateMatches('/models/[id]', '/models/a/other'), false);
});
test('sitemap maps canonical production URLs onto staging paths and rejects other hosts', () => {
  assert.deepEqual(sitemapPaths('<loc>https://veyrnox.ai/about</loc>', 'http://localhost:3100'), ['/about']);
  assert.throws(() => sitemapPaths('<loc>https://evil.test/about</loc>', 'http://localhost:3100'));
});

const reviewRoute = '/app/editor/review';
const project = 'abcdef00-0000-4000-8000-000000000020';
const reviewEntry = (fixtures = {}, sitemap = []) => buildPageManifest(sitemap, fixtures).find(entry => entry.template === reviewRoute);

test('bare Editor Review is negative-path even when the sitemap lists it, without changing route inventory', () => {
  for (const sitemap of [[], [reviewRoute]]) {
    const manifest = buildPageManifest(sitemap);
    assert.equal(reviewEntry({}, sitemap).mode, 'negative-path');
    assert.equal(manifest.length, PAGE_TEMPLATES.length);
    assert.equal(new Set(manifest.map(entry => entry.template)).size, PAGE_TEMPLATES.length);
  }
});

for (const query of ['', `?project=${project}`, '?revision=1', '?project=missing&revision=1',
  `?project=${project}&revision=0`, `?project=${project}&revision=-1`, `?project=${project}&revision=01`,
  `?project=${project}&revision=1.5`, `?project=${project}&revision=1000000000`, `?project=${project}&revision=1%20`,
  `?project=${project}&revision=1&revision=2`, `?project=${project}&project=${project}&revision=1`,
]) {
  test(`Editor Review fixture cannot claim an interior for missing or invalid query ${query}`, () => {
    const entry = reviewEntry({ [reviewRoute]: `${reviewRoute}${query}` });
    assert.equal(entry.mode, 'negative-path');
    assert.equal(entry.access, 'account');
    assert.equal(entry.sensitive, true);
  });
}

test('only an explicit valid saved-version fixture can classify Editor Review as render', () => {
  for (const query of [`?project=${project}&revision=1`, `?revision=999999999&project=${project.toUpperCase()}`, `?project=${project}&revision=%31&view=preview`]) {
    const entry = reviewEntry({ [reviewRoute]: `${reviewRoute}${query}` });
    assert.equal(entry.mode, 'render');
    assert.equal(entry.pathname, `${reviewRoute}${query}`);
    assert.equal(entry.sensitive, true);
  }
});
