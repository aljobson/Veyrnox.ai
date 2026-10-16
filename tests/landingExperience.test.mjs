import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { FEATURE_CARDS, MODELS, WALL_PRESETS } from '../app/veyrnox/_lib/tokens.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('the landing page samples its exhaustive catalogs', () => {
  const showcase = read('app/veyrnox/_sections/showcase.js');
  assert.match(showcase, /WALL_PRESETS\.slice\(0, LANDING_TEMPLATE_LIMIT\)/);
  assert.match(showcase, /representativeRows/);
  assert.match(showcase, /href="\/presets"/);
  assert.match(showcase, /href="\/models"/);
  assert.ok(WALL_PRESETS.length > 8, 'fixture must prove the wall is being shortened');

  const footer = read('app/veyrnox/_sections/footer.js');
  assert.match(footer, /import \{[^}]*distinctShelfNames[^}]*\} from '\.\.\/_lib\/tokens'/s);
  const forest = footer.slice(footer.indexOf('export function FooterForest'));
  assert.doesNotMatch(forest, /catalog\.map|models\.map/, 'the footer must not duplicate the whole catalog');
});

test('the first featured option fits within the free-credit balance', () => {
  const firstModelId = new URL(FEATURE_CARDS[0].href, 'https://veyrnox.ai').searchParams.get('model');
  const row = MODELS.find((model) => model.id === firstModelId);
  assert.ok(row, 'first feature must point to a catalog model');
  assert.ok(row.credits <= 10, `${row.name} costs more than the 10-credit starter balance`);
  assert.match(FEATURE_CARDS[0].body, new RegExp(`\\b${row.credits} credits?\\b`, 'i'));
});

test('the working hero price slip starts on the shared affordable model', () => {
  const page = read('app/veyrnox/page.js');
  const slip = read('app/veyrnox/_components/PriceSlip.js');
  assert.match(page, /media: m\.capabilities\?\.media \|\| \{\}/);
  assert.match(page, /takesPrompt: !!m\.capabilities\?\.inputs\?\.prompt/);
  assert.match(page, /takesPlan: !!m\.capabilities\?\.inputs\?\.plan_id/);
  assert.match(slip, /affordableStarterModel\(open, AFFORDABLE_START_MODEL_ID, SIGNUP_CREDITS\)/);
  assert.match(slip, /useState\(starter\?\.id/);
});

test('the featured carousel is named and explains horizontal scrolling', () => {
  const hero = read('app/veyrnox/_sections/hero.js');
  assert.match(hero, /<section id="explore" aria-labelledby="featured-title"/);
  assert.match(hero, /<h2 id="featured-title" className="sr-only">/);
  assert.match(hero, /<div role="region" aria-labelledby="featured-title" aria-describedby="featured-scroll-hint"/);
  assert.match(hero, /id="featured-scroll-hint"[^>]*>Scroll horizontally/);
});

test('responsive tiles retain decorative alt text and declare image sizes', () => {
  const tile = read('app/veyrnox/_components/MediaTile.js');
  assert.match(tile, /imageSizes = /);
  assert.match(tile, /<Image[^>]*alt=""[^>]*sizes=\{imageSizes\}/s);
  assert.doesNotMatch(tile, /<Image[^>]*\bunoptimized\b/s, 'local posters should receive a responsive srcset');
});

test('primary mobile controls expose a 44px target', () => {
  for (const file of ['MobileMenu.js', 'ThemeToggle.js', 'SiteSearch.js', 'NavAuthButtons.js']) {
    const src = read(`app/veyrnox/_components/${file}`);
    assert.match(src, /(?:h-11|min-h-11)/, `${file} has no 44px primary target`);
  }
});
