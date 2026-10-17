import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { checkCatalog } from '../lib/i18n/check.mjs';
import { TOOL_TASKS } from '../app/veyrnox/_lib/tools.js';
import { GUIDES } from '../app/veyrnox/_lib/guides.js';
import en from '../lib/i18n/messages/en.mjs';
import { CATALOGS, messagesFor, translator, richParts } from '../lib/i18n/translate.mjs';
import {
  LOCALES, LOCALIZED_PATHS, localesEnabled, splitLocalePath, isLocalizedPath, localizedHref, languageAlternates, localeInfo, switchLanguageHref,
} from '../lib/i18n/locales.mjs';

test('every language has a catalog that matches English key for key', () => {
  for (const l of LOCALES) {
    assert.ok(CATALOGS[l.code], `${l.code} has a catalog`);
    assert.deepEqual(checkCatalog(en, CATALOGS[l.code], l.code), []);
  }
});

test('ten languages besides English, Arabic runs right to left', () => {
  assert.equal(LOCALES.filter((l) => l.code !== 'en').length, 10);
  assert.equal(localeInfo('ar').dir, 'rtl');
  assert.equal(localeInfo('pt').hreflang, 'pt-BR');
  assert.equal(localeInfo('xx').code, 'en');
});

test('numbers and units that are policy survive translation', () => {
  for (const l of LOCALES) {
    const m = messagesFor(l.code);
    assert.match(m['home.faq.8.a'], /429/, l.code);
    assert.match(m['home.faq.8.a'], /Retry-After/, l.code);
    assert.match(m['home.faq.3.a'], /10/, l.code);
    assert.match(m['home.faq.9.a'], /90/, l.code);
  }
});

test('language prefix routing', () => {
  assert.deepEqual(splitLocalePath('/es'), { locale: 'es', rest: '/' });
  assert.deepEqual(splitLocalePath('/fr/pricing'), { locale: 'fr', rest: '/pricing' });
  assert.equal(splitLocalePath('/en').locale, null, 'English has no prefix');
  assert.equal(splitLocalePath('/app/create').locale, null);
  assert.equal(splitLocalePath('/m').locale, null);
});

test('only translated pages take the prefix', () => {
  assert.ok(LOCALIZED_PATHS.has('/'));
  assert.equal(localizedHref('es', '/'), '/es');
  assert.equal(localizedHref('es', '/#faq'), '/es#faq');
  assert.equal(localizedHref('es', '/pricing'), '/es/pricing');
  assert.equal(localizedHref('es', '/oddlings'), '/oddlings');
  assert.ok(LOCALIZED_PATHS.has('/pricing'));
  assert.equal(localizedHref('es', 'mailto:legal@veyrnox.com'), 'mailto:legal@veyrnox.com');
  assert.equal(localizedHref('en', '/'), '/');
  assert.equal(localizedHref('zz', '/'), '/');
});

test('alternates name every language and x-default', () => {
  const alt = languageAlternates('/');
  assert.equal(alt.en, '/');
  assert.equal(alt['zh-Hans'], '/zh');
  assert.equal(alt['pt-BR'], '/pt');
  assert.equal(alt['x-default'], '/');
  assert.equal(Object.keys(alt).length, LOCALES.length + 1);
});

test('translator falls back to English, then to the key', () => {
  const t = translator('es');
  assert.equal(t('nope.key'), 'nope.key');
  assert.equal(t.label('Not a listed label'), 'Not a listed label');
  assert.equal(translator('en')('home.cards.looks', { n: 3 }), '3 looks');
  assert.equal(richParts('a {x} b').length, 3);
});

test('languages are off unless the var is exactly "true"', () => {
  assert.equal(localesEnabled({}), false);
  assert.equal(localesEnabled({ LOCALES_ENABLED: 'false' }), false);
  assert.equal(localesEnabled({ LOCALES_ENABLED: 'true' }), true);
  const config = JSON.parse(readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8').replace(/^\s*\/\/.*$/gm, '').replace(/,(\s*[}\]])/g, '$1'));
  assert.equal(config.vars.LOCALES_ENABLED, 'true');
  assert.equal(config.env.staging.vars.LOCALES_ENABLED, 'true');
});

test('every language has a flag and a name for the picker', () => {
  for (const l of LOCALES) {
    assert.match(l.flag, /^\p{Regional_Indicator}{2}$/u, l.code);
    assert.ok(l.name.length > 0, l.code);
  }
});

test('the picker keeps a translated page and falls back to home for the rest', () => {
  assert.equal(switchLanguageHref('fr', '/'), '/fr');
  assert.equal(switchLanguageHref('fr', '/es'), '/fr');
  assert.equal(switchLanguageHref('en', '/ja'), '/');
  assert.equal(switchLanguageHref('de', '/pricing'), '/de/pricing', 'pricing is translated');
  assert.equal(switchLanguageHref('de', '/oddlings'), '/de', 'no German Oddlings page yet: home');
  assert.equal(switchLanguageHref('en', '/es/pricing'), '/pricing');
  assert.equal(switchLanguageHref('en', '/oddlings'), '/oddlings', 'English on an English page stays put');
});

test('every tool group on /tools has translated words, and every MCP tool a description', () => {
  for (const task of [...TOOL_TASKS, { key: 'other' }]) {
    assert.ok(en[`tools.t.${task.key}.label`], `${task.key} label`);
    assert.ok(en[`tools.t.${task.key}.blurb`], `${task.key} blurb`);
  }
  for (const name of ['list_models', 'estimate_generation', 'get_generation', 'list_generations', 'get_balance']) {
    assert.ok(en[`mcp.tool.${name}`], name);
  }
});

test('every guide, step and link has catalog words in English, and the English matches the data', () => {
  for (const g of GUIDES) {
    assert.equal(en[`guide.${g.id}.title`], g.title);
    assert.equal(en[`guide.${g.id}.summary`], g.summary);
    g.steps.forEach((step, i) => {
      assert.equal(en[`guide.${g.id}.s${i + 1}.title`], step.title, `${g.id} step ${i + 1}`);
      assert.equal(en[`guide.${g.id}.s${i + 1}.body`], step.body, `${g.id} step ${i + 1} body`);
    });
    g.links.forEach((link, i) => assert.equal(en[`guide.${g.id}.l${i + 1}`], link.label, `${g.id} link ${i + 1}`));
  }
});

test('guide pages take a prefix, the bare prefix path does not', () => {
  assert.equal(isLocalizedPath('/guides/credits'), true);
  assert.equal(isLocalizedPath('/guides'), true);
  assert.equal(isLocalizedPath('/guides/'), true);
  assert.equal(localizedHref('fr', '/guides/credits'), '/fr/guides/credits');
  assert.equal(switchLanguageHref('de', '/fr/guides/library'), '/de/guides/library');
  assert.equal(isLocalizedPath('/presets/abc'), false, 'template detail pages are not translated yet');
  assert.equal(isLocalizedPath('/presets'), true);
});
