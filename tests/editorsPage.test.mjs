import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('the public editors page is routed, discoverable and indexed', () => {
  const config = read('next.config.mjs');
  const tokens = read('app/veyrnox/_lib/tokens.js');
  const sitemap = read('app/sitemap.js');

  assert.match(config, /source: '\/editors', destination: '\/veyrnox\/editors'/);
  assert.match(tokens, /PRIMARY_NAV_CATEGORIES = \[[\s\S]*href: '\/editors',\s+label: 'Editors'/);
  assert.match(tokens, /href: '\/editors',\s+label:\s+'Editors',\s+description:/);
  assert.match(sitemap, /page\('\/editors'/);
});

test('the page documents real editor boundaries and launches the existing tools', () => {
  const page = read('app/veyrnox/editors/page.js');
  const copy = read('lib/i18n/editorsEnglish.mjs');

  for (const heading of ['Video Editor', 'Audio Editor', 'Smart Cut']) assert.match(copy, new RegExp(heading));
  assert.match(copy, /up to 10 clips and 60 seconds/);
  assert.match(copy, /deterministic local preview/);
  assert.match(copy, /does not claim to detect mistakes, repeated lines, picture quality, or the best performance/);
  assert.match(page, /href: '\/app\/library#smart-cut'/);
  assert.match(page, /href: '\/app\/music'/);
  assert.match(copy, /exact credit price/);
  assert.match(page, /<Main>/);
  assert.match(page, /<FooterForest locale=\{locale\} t=\{t\} flush \/>/);
});

test('Vey documents the editor choice and telemetry recognizes the public route', () => {
  const knowledge = read('lib/productKnowledge.js');
  const migration = read('packages/db/schema/supabase/0603_editors_route_telemetry.sql');

  assert.match(knowledge, /id: 'editor-suite'.*routes: \['\/editors'\]/);
  assert.match(knowledge, /default Smart Cut is a deterministic local preview/);
  assert.match(migration, /SELECT p_path = '\/editors'/);
});
