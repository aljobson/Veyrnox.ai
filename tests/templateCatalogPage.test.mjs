import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { VEO_TEMPLATE_RECIPES } from '../app/veyrnox/_lib/veoTemplateRecipes.js';
import { MUSIC_DISCOVER_BEATS } from '../lib/musicDiscover.js';
import { studioMenuItems, studioSidebarSections } from '../app/veyrnox/_lib/studioNavigation.js';
import { SECONDARY_NAV_CATEGORIES } from '../app/veyrnox/_lib/tokens.js';
import appEnglish from '../lib/i18n/messages/app/en.mjs';

const component = await readFile(new URL('../app/veyrnox/_components/TemplateCatalog.js', import.meta.url), 'utf8');
const navigation = await readFile(new URL('../app/veyrnox/_lib/studioNavigation.js', import.meta.url), 'utf8');
const page = await readFile(new URL('../app/veyrnox/app/templates/page.js', import.meta.url), 'utf8');

test('the signed-in catalog is visible in navigation and covers all five requested engines', () => {
  assert.match(navigation, /key: 'templates', href: '\/app\/templates'/);
  const t = Object.assign((key) => appEnglish[key] ?? key, { label: (label) => label });
  const flags = { projects: true, publish: true, editor: true };
  const menuTemplates = studioMenuItems(t, flags).filter((item) => item.label === 'Templates');
  const sidebarTemplates = studioSidebarSections(t, flags).flatMap((section) => section.items).filter((item) => item.label === 'Templates');
  assert.deepEqual(menuTemplates.map((item) => item.href), ['/app/templates']);
  assert.deepEqual(sidebarTemplates.map((item) => item.href), ['/app/templates']);
  assert.equal(SECONDARY_NAV_CATEGORIES.find((item) => item.label === 'Templates')?.href, '/app/templates');
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
  assert.match(component, /<video src=\{item\.previewUrl\}.*referrerPolicy="no-referrer"/);
  assert.match(component, /stillPreview \? <img.*referrerPolicy="no-referrer"/);
  assert.match(component, /conceptPreviewLabel/);
  assert.match(component, /listenPreview/);
});

test('provider effects are catalog-only until pricing and paid proof exist', () => {
  assert.match(component, /app\.templates\.liveHelp/);
  assert.match(appEnglish['app.templates.liveHelp'], /Generation stays disabled until each effect has Veyrnox pricing and a paid proof/);
  assert.doesNotMatch(component, /CreateTask/);
});

test('the catalog requests and displays the combined template count without supplier language', () => {
  assert.match(component, /\/api\/template-catalog\?summary=1/);
  assert.match(component, /data-testid="crun-template-count"/);
  assert.equal(appEnglish['app.templates.crunSummary'], '{count} templates across Kling, Seedance and Vidu');
  for (const key of ['app.templates.intro', 'app.templates.crunSummary', 'app.templates.provider.viduDetail', 'app.templates.liveHelp']) {
    assert.doesNotMatch(appEnglish[key], /CRUN/i, key);
  }
});
