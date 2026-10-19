import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import ts from 'typescript';
import { appMessagesFor } from '../lib/i18n/appMessages.mjs';
import { checkCatalog } from '../lib/i18n/check.mjs';
import { LOCALES, localeTag } from '../lib/i18n/locales.mjs';
import { translator, pluralKey, tOr } from '../lib/i18n/translate.mjs';
import en from '../lib/i18n/messages/app/en.mjs';
import { formatWhen } from '../app/veyrnox/_lib/formatWhen.js';

const catalogs = Object.fromEntries(await Promise.all(LOCALES.map(async ({ code }) => [code, (await import(`../lib/i18n/messages/app/${code}.mjs`)).default])));

test('app catalogs have identical keys, placeholders and exact numeric policy facts', () => {
  const numbers = value => (value.replace(/\{\w+\}/g, '').match(/\d+(?:[.,]\d+)*/g) || []).sort();
  for (const { code } of LOCALES) {
    assert.deepEqual(checkCatalog(en, catalogs[code], code), []);
    for (const [key, value] of Object.entries(en)) assert.deepEqual(numbers(catalogs[code][key]), numbers(value), `${code}: ${key}`);
  }
});

test('all public and app catalog files are free of duplicate keys', () => {
  for (const { code } of LOCALES) {
    const files = [`lib/i18n/messages/${code}.mjs`, ...readdirSync(`lib/i18n/messages/app/${code}`).map(area => `lib/i18n/messages/app/${code}/${area}`)];
    const appKeys = new Set();
    for (const file of files) {
    const source = readFileSync(file, 'utf8');
    const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
    function visit(node) {
      if (ts.isObjectLiteralExpression(node)) {
        const keys = new Set();
        for (const property of node.properties) {
          if (!property.name || !ts.isStringLiteral(property.name)) continue;
          assert.ok(!keys.has(property.name.text), `${file}: duplicate ${property.name.text}`);
          keys.add(property.name.text);
          if (file.includes('/app/')) {
            assert.ok(!appKeys.has(property.name.text), `${code}: key repeated across areas: ${property.name.text}`);
            appKeys.add(property.name.text);
          }
        }
      }
      ts.forEachChild(node, visit);
    }
    visit(tree);
    if (file.includes('/app/')) assert.ok(source.split('\n').length <= 800, `${file}: split this area before it grows further`);
    }
  }
});

test('public translator cannot import app catalogs and dynamic unknowns never become raw keys', async () => {
  const publicSource = readFileSync('lib/i18n/translate.mjs', 'utf8');
  assert.doesNotMatch(publicSource, /appMessages|messages\/app/);
  assert.equal(translator('de').messages['app.library.title'], undefined);
  for (const { code } of LOCALES) {
    const t = translator(code, await appMessagesFor(code));
    assert.equal(t('app.library.title'), catalogs[code]['app.library.title']);
    assert.equal(tOr(t, 'app.library.status.future_state', t('app.library.status.queued')), t('app.library.status.queued'));
    for (const count of [0, 1, 2, 3, 5, 11, 21, 101]) {
      const key = pluralKey(t, code, 'app.library.selected', count);
      assert.ok(catalogs[code][key], `${code} ${count} ${key}`);
      assert.doesNotMatch(t(key, { count, audio: '' }), /app\.library|\{\w+\}/);
    }
  }
});

test('English Intl tags and relative dates keep their original behavior', () => {
  for (const original of [undefined, 'en-US', 'en-GB']) assert.equal(localeTag('en', original), original);
  const original = Date.now;
  try {
    Date.now = () => 100000000;
    for (const [seconds, expected] of [[0, '0s ago'], [12, '12s ago'], [120, '2m ago'], [7200, '2h ago'], [172800, '2d ago']]) {
      assert.equal(formatWhen(Date.now() - seconds * 1000, 'en'), expected);
      for (const locale of ['de', 'ja', 'ar']) assert.notEqual(formatWhen(Date.now() - seconds * 1000, locale), expected);
    }
  } finally { Date.now = original; }
});

test('every app area has the same keys and placeholders in all languages', async () => {
  const areas = readdirSync('lib/i18n/messages/app/en').sort();
  for (const { code } of LOCALES) {
    assert.deepEqual(readdirSync(`lib/i18n/messages/app/${code}`).sort(), areas, code);
    for (const area of areas) {
      const source = (await import(`../lib/i18n/messages/app/en/${area}`)).default;
      const translated = (await import(`../lib/i18n/messages/app/${code}/${area}`)).default;
      assert.deepEqual(checkCatalog(source, translated, `${code}/${area}`), []);
    }
  }
});
