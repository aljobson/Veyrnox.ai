import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { GALLERY_PRESETS, PRESETS } from '../app/veyrnox/_lib/templates.js';
import { VIDEO_GALLERY_TEMPLATE_IDS } from '../app/veyrnox/_lib/videoTemplateGallery.js';
import { VIDEO_TEMPLATE_THEMES, VIDEO_THEME_IDS, videoTemplateTheme } from '../app/veyrnox/_lib/videoTemplateThemes.js';
import { QUICK_PRESET_CATEGORIES } from '../app/veyrnox/_lib/tokens.js';
import { templateCards, templateCategories } from '../lib/clientTemplates.js';

const LOCALES = readdirSync(new URL('../lib/i18n/messages/', import.meta.url))
  .filter((name) => /^[a-z]{2}\.mjs$/.test(name)).map((name) => name.slice(0, 2));

test('every listed video template is filed under exactly one theme', () => {
  const filed = VIDEO_TEMPLATE_THEMES.flatMap((theme) => theme.templateIds);
  assert.equal(new Set(filed).size, filed.length, 'a template sits in two themes');
  for (const id of VIDEO_GALLERY_TEMPLATE_IDS) assert.ok(videoTemplateTheme(id), `${id} is listed but has no theme`);
});

test('a theme names only real templates, and never reuses a style category id', () => {
  const known = new Set(PRESETS.map((p) => p.id));
  for (const id of VIDEO_TEMPLATE_THEMES.flatMap((theme) => theme.templateIds)) assert.ok(known.has(id), id);
  const styles = new Set(PRESETS.map((p) => p.category));
  for (const theme of VIDEO_THEME_IDS) assert.equal(styles.has(theme), false, theme);
});

test('the gallery cards and filters are the themes, in order, with every chip shown by default', () => {
  const video = templateCards().filter((card) => card.kind !== 'image');
  assert.equal(video.length, GALLERY_PRESETS.length);
  for (const card of video) assert.equal(card.category, videoTemplateTheme(card.id), card.id);
  const ranks = video.map((card) => VIDEO_THEME_IDS.indexOf(card.category));
  assert.deepEqual(ranks, [...ranks].sort((a, b) => a - b), 'video cards are grouped in theme order');
  const categories = templateCategories();
  assert.deepEqual(categories.slice(0, 2), ['ALL', 'NEW']);
  const themes = categories.filter((c) => VIDEO_THEME_IDS.includes(c));
  assert.deepEqual(themes, VIDEO_THEME_IDS.filter((theme) => video.some((card) => card.category === theme)));
  for (const theme of VIDEO_THEME_IDS) assert.ok(QUICK_PRESET_CATEGORIES.includes(theme), theme);
});

test('every theme has a label in every locale', async () => {
  for (const locale of LOCALES) {
    const messages = (await import(`../lib/i18n/messages/${locale}.mjs`)).default;
    for (const theme of VIDEO_THEME_IDS) assert.ok(messages[`presets.cat.${theme}`], `${locale}: presets.cat.${theme}`);
  }
});

test('tidy 2026-11-21: all three supercar refuels are hidden but still filed, and no theme holds a lone card', () => {
  for (const id of ['community-supercar-midnight-refuel', 'community-midnight-supercar-refuel', 'community-supercar-night-fueling']) {
    assert.equal(VIDEO_GALLERY_TEMPLATE_IDS.includes(id), false, `${id} is hidden`);
    assert.ok(PRESETS.some((p) => p.id === id), `${id} keeps its data and link`);
    assert.equal(videoTemplateTheme(id), 'CARS', `${id} keeps its theme so re-listing needs only its id`);
  }
  assert.equal(VIDEO_THEME_IDS.includes('PROPERTY'), false);
  assert.equal(videoTemplateTheme('community-modern-listing-dolly'), 'FILM');
});
