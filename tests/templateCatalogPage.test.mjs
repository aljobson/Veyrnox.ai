import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { VEO_TEMPLATE_RECIPES } from '../app/veyrnox/_lib/veoTemplateRecipes.js';
import { MUSIC_DISCOVER_BEATS } from '../lib/musicDiscover.js';
import appEnglish from '../lib/i18n/messages/app/en.mjs';

const component = await readFile(new URL('../app/veyrnox/_components/TemplateCatalog.js', import.meta.url), 'utf8');
const navigation = await readFile(new URL('../app/veyrnox/_lib/studioNavigation.js', import.meta.url), 'utf8');
const page = await readFile(new URL('../app/veyrnox/app/templates/page.js', import.meta.url), 'utf8');

test('the signed-in catalog is visible in navigation and covers all five requested engines', () => {
  assert.match(navigation, /key: 'templates', href: '\/app\/templates'/);
  for (const provider of ['kling', 'seedance', 'vidu', 'veo', 'suno']) assert.match(component, new RegExp(`id: '${provider}'`));
  assert.match(page, /TemplateCatalog/);
  assert.match(page, /seedance=\{\[\]\}/);
});

test('Veo recipes are Veyrnox-owned runnable handoffs and SUNO exposes all 100 music starts', () => {
  assert.ok(VEO_TEMPLATE_RECIPES.length >= 10);
  assert.ok(VEO_TEMPLATE_RECIPES.every(item => item.model === 'veo-3.1-fast-kie' && item.prompt.length > 80));
  assert.equal(MUSIC_DISCOVER_BEATS.length, 100);
  assert.match(component, /writeStudioDraft\(window\.sessionStorage, item\)/);
  assert.match(component, /\/app\/music\/create\?sample=/);
  assert.match(component, /scheduleMusicSamplePreview\(item/);
  assert.match(page, /root: beat\.root/);
});

test('every catalog family has an in-card preview surface', () => {
  assert.match(page, /video: card\.clip\?\.video/);
  assert.match(component, /<video src=\{item\.video\}/);
  assert.match(component, /<video src=\{item\.previewUrl\}.*autoPlay/);
  assert.match(component, /item\.previewKind === 'image'/);
  assert.match(component, /conceptPreviewLabel/);
  assert.match(component, /listenPreview/);
});

test('provider effects are catalog-only until pricing and paid proof exist', () => {
  assert.match(component, /app\.templates\.liveHelp/);
  assert.match(appEnglish['app.templates.liveHelp'], /Generation stays disabled until each effect has Veyrnox pricing and a paid proof/);
  assert.doesNotMatch(component, /CreateTask/);
});
