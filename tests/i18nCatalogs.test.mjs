import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { checkCatalog } from '../lib/i18n/check.mjs';
import en from '../lib/i18n/messages/en.mjs';
import { CATALOGS, messagesFor, translator, richParts } from '../lib/i18n/translate.mjs';
import {
  LOCALES, LOCALIZED_PATHS, localesEnabled, splitLocalePath, localizedHref, languageAlternates, localeInfo,
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
  assert.equal(localizedHref('es', '/pricing'), '/pricing');
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
  assert.equal(config.vars.LOCALES_ENABLED, undefined, 'production omits it');
  assert.equal(config.env.staging.vars.LOCALES_ENABLED, 'true');
});
