import test from 'node:test';
import assert from 'node:assert/strict';
import { CATALOGS } from '../lib/i18n/catalogs.mjs';
import { publicMessagesFor } from '../lib/i18n/publicMessages.mjs';
import { appMessagesFor } from '../lib/i18n/appMessages.mjs';
import { translator } from '../lib/i18n/translate.mjs';
import { checkCatalog } from '../lib/i18n/check.mjs';
const keys = Object.keys(CATALOGS.en).filter(k => k.startsWith('presets.swap.'));
test('all swap strings resolve through public and nested Create translate paths in all eleven locales', async () => {
  assert.ok(keys.length > 40);
  for (const locale of Object.keys(CATALOGS)) {
    assert.deepEqual(checkCatalog(CATALOGS.en, CATALOGS[locale], locale), []);
    const publicMessages = await publicMessagesFor(locale);
    // I18nProvider inherits root publicMessages, then overlays appMessages.
    for (const messages of [publicMessages, { ...publicMessages, ...await appMessagesFor(locale) }]) {
      const t = translator(locale, messages);
      for (const key of keys) {
        assert.equal(t(key), CATALOGS[locale][key], `${locale}:${key}`);
        assert.notEqual(t(key), key);
        if (locale !== 'en') assert.notEqual(t(key), CATALOGS.en[key], `${locale} must translate ${key}`);
      }
    }
  }
});
