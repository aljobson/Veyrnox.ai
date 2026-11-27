import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { VEO_TEMPLATE_RECIPES } from '../app/veyrnox/_lib/veoTemplateRecipes.js';
import { readyTemplateCatalog } from '../app/veyrnox/_lib/templateCatalogReady.js';
import { templateCatalogCredits } from '../app/veyrnox/_lib/templateCatalogPrice.js';
import { MUSIC_DISCOVER_BEATS } from '../lib/musicDiscover.js';
import { studioMenuItems, studioSidebarSections } from '../app/veyrnox/_lib/studioNavigation.js';
import { SECONDARY_NAV_CATEGORIES } from '../app/veyrnox/_lib/tokens.js';
import appEnglish from '../lib/i18n/messages/app/en.mjs';

const component = await readFile(new URL('../app/veyrnox/_components/TemplateCatalog.js', import.meta.url), 'utf8');
const navigation = await readFile(new URL('../app/veyrnox/_lib/studioNavigation.js', import.meta.url), 'utf8');
const page = await readFile(new URL('../app/veyrnox/app/templates/page.js', import.meta.url), 'utf8');
const home = await readFile(new URL('../app/veyrnox/app/page.js', import.meta.url), 'utf8');
const homeCatalog = await readFile(new URL('../app/veyrnox/_components/HomeTemplateCatalog.js', import.meta.url), 'utf8');
const readyCatalog = await readFile(new URL('../app/veyrnox/_lib/templateCatalogReady.js', import.meta.url), 'utf8');
const readyRoute = await readFile(new URL('../app/api/template-catalog/ready/route.js', import.meta.url), 'utf8');

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
  assert.match(page, /readyTemplateCatalog\(\)/);
});

test('Home and Templates render the same unified catalogue data and component', () => {
  assert.match(home, /<HomeTemplateCatalog\s*\/>/);
  assert.doesNotMatch(home, /<ExploreTemplates\b/);
  assert.match(homeCatalog, /fetch\('\/api\/template-catalog\/ready'\)/);
  assert.match(homeCatalog, /return <TemplateCatalog \{\.\.\.catalog\} \/>/);
  assert.match(readyRoute, /readyTemplateCatalog\(\)/);
  assert.match(page, /const catalog = readyTemplateCatalog\(\)/);
  assert.match(page, /<TemplateCatalog \{\.\.\.catalog\} \/>/);
});

test('ready cards use their routed model and duration-aware live price', () => {
  const catalog = readyTemplateCatalog();
  const truck = catalog.kling.find(item => item.id === 'community-truck-window-confrontation');
  assert.deepEqual([truck.modelId, truck.model, templateCatalogCredits(truck, { [truck.modelId]: 32 })], ['kling-3.0-i2v', 'Kling 3.0 · I2V', 64]);
  assert.equal(templateCatalogCredits({ modelId: 'seedance-2.0-fast', credits: 58, durationSeconds: 5 }, { 'seedance-2.0-fast': 19 }), 19);
  assert.equal(templateCatalogCredits({ modelId: 'seedance-2.0-photo-kie', credits: 58, durationSeconds: 10 }, { 'seedance-2.0-photo-kie': 58 }), 116);
});

test('Veo recipes are Veyrnox-owned runnable handoffs and SUNO exposes all 100 music starts', () => {
  assert.ok(VEO_TEMPLATE_RECIPES.length >= 10);
  assert.ok(VEO_TEMPLATE_RECIPES.every(item => item.model === 'veo-3.1-fast-kie' && item.prompt.length > 80));
  assert.equal(MUSIC_DISCOVER_BEATS.length, 100);
  assert.match(component, /writeStudioDraft\(window\.sessionStorage, item\)/);
  assert.match(component, /\/app\/music\/create\?sample=/);
  assert.match(component, /scheduleMusicSamplePreview\(item/);
  assert.match(readyCatalog, /root: beat\.root/);
});

test('every catalog family has an in-card preview surface', () => {
  assert.match(readyCatalog, /video: card\.clip\?\.video/);
  assert.match(component, /<video src=\{item\.video\}/);
  assert.match(component, /<video src=\{item\.previewUrl\}.*autoPlay/);
  assert.match(component, /item\.previewKind === 'image'/);
  assert.match(component, /<video src=\{item\.previewUrl\}.*referrerPolicy="no-referrer"/);
  assert.match(component, /stillPreview \? <img.*referrerPolicy="no-referrer"/);
  assert.match(component, /conceptPreviewLabel/);
  assert.match(component, /listenPreview/);
});

test('every catalog family shows a fail-closed Veyrnox Credit price', () => {
  assert.match(readyCatalog, /credits: card\.credits/);
  assert.match(readyCatalog, /model: 'ace-step'/);
  assert.match(readyCatalog, /credits: 4/);
  assert.ok(VEO_TEMPLATE_RECIPES.every(item => item.credits === 9));
  assert.match(component, /fetch\('\/api\/catalog'\)/);
  assert.match(component, /function ReadyCard\(\{ item, badge, credits, t \}\)/);
  assert.match(component, /function VeoCard\(\{ item, credits, onUse, t \}\)/);
  assert.match(component, /function SunoCard\(\{ item, credits, playing, progress, onToggle, t \}\)/);
  assert.match(component, /price \? <p[^>]*>\{t\('app\.templates\.customerCredits',[\s\S]*: <p[^>]*>\{t\('app\.templates\.priceUnavailable'\)\}<\/p>/);
  assert.match(component, /price \? <CatalogTemplateRun[\s\S]*: <button type="button" disabled[^>]*>\{t\('app\.templates\.useTemplate'\)\}<\/button>/);
  assert.match(component, /app\.templates\.priceUnavailable/);
  assert.equal(appEnglish['app.templates.priceUnavailable'], 'Price unavailable');
});

test('provider effects show customer prices and a runnable generation action', () => {
  assert.match(component, /app\.templates\.liveHelp/);
  assert.match(appEnglish['app.templates.liveHelp'], /generate it directly/);
  assert.match(component, /app\.templates\.customerCredits/);
  assert.match(component, /model_id: 'catalog-template'/);
  assert.match(component, /confirmed_credits: credits/);
});

test('the catalog requests and displays the combined template count without supplier language', () => {
  assert.match(component, /\/api\/template-catalog\?summary=1/);
  assert.match(component, /data-testid="crun-template-count"/);
  assert.equal(appEnglish['app.templates.crunSummary'], '{count} templates across Kling, Seedance and Vidu');
  for (const key of ['app.templates.intro', 'app.templates.crunSummary', 'app.templates.provider.viduDetail', 'app.templates.liveHelp']) {
    assert.doesNotMatch(appEnglish[key], /CRUN/i, key);
  }
});
