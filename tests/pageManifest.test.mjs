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
