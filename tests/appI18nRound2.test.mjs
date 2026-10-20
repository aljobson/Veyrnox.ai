import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { appMessagesFor } from '../lib/i18n/appMessages.mjs';
import { localeTag, LOCALES } from '../lib/i18n/locales.mjs';
import { translator, pluralKey } from '../lib/i18n/translate.mjs';
import { candidates } from '../scripts/audit-public-i18n.mjs';
import { files, scenarios, renderScenario, visibleText } from './helpers/appI18nRound2.mjs';
const escape = value => String(value).replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll("'", '&#x27;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

test('round 2 completes all seven files without exemptions for UI copy', () => {
  for (const file of Object.values(files)) {
    const source = readFileSync(file, 'utf8');
    assert.deepEqual(candidates(file, source, { app: true }).filter(row => row.status === 'unresolved'), [], file);
    const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JSX);
    function scan(node) {
      if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) assert.ok(!node.parameters.some(parameter => parameter.name.getText(tree) === 't'), `${file}: shadowed translator`);
      if (ts.isCallExpression(node) && ['t', 'tOr'].includes(node.expression.getText(tree)) && ts.isJsxExpression(node.parent) && ts.isJsxAttribute(node.parent.parent)) assert.ok(!['value', 'id', 'key', 'name'].includes(node.parent.parent.name.text) && !node.parent.parent.name.text.startsWith('data-'), `${file}: translated machine value`);
      ts.forEachChild(node, scan);
    }
    scan(tree);
  }
});

test('English rendered text stays byte-identical to origin/main in thirteen populated and empty states', async () => {
  const baseline = JSON.parse(readFileSync('tests/fixtures/app-round2-english-main.json', 'utf8'));
  const messages = await appMessagesFor('en');
  for (const [index, scenario] of scenarios.entries()) {
    assert.equal(visibleText(renderScenario(scenario, 'en', messages)), baseline[index].text, `${scenario.area}/${scenario.name}`);
  }
});

for (const locale of ['de', 'ja', 'ar']) {
  test(`round 2 actual components render translated controls, numbers and user content: ${locale}`, async () => {
    const messages = await appMessagesFor(locale);
    for (const scenario of scenarios) {
      const html = renderScenario(scenario, locale, messages);
      assert.doesNotMatch(html, /app\.(?:publish|create|editor|oddlings)\.[a-zA-Z]|\{(?:count|name|credits|timezone)\}/, `${scenario.area}/${scenario.name}`);
      if (scenario.key && !/\{/.test(messages[scenario.key] || '')) assert.ok(html.includes(escape(messages[scenario.key])), scenario.key);
      if (scenario.name === 'Conversation') { assert.ok(html.includes('User message unchanged')); assert.ok(html.includes('Instagram')); }
      if (scenario.name === 'PostCard') { assert.ok(html.includes('User caption unchanged')); assert.ok(html.includes('TikTok')); }
      if (scenario.name === 'ApiKeys') { assert.ok(html.includes('value="90"')); assert.ok(html.includes('posts:read')); }
    }
    const t = translator(locale, messages);
    for (const family of ['app.editor.generation.credits', 'app.publish.calendar.showing', 'app.oddlings.traits', 'app.oddlings.humans', 'app.oddlings.beings', 'app.create.credits', 'app.create.moreCredits', 'app.create.generateImagesFree', 'app.create.generateImagesPaid', 'app.create.freeLeft']) {
      for (const count of [0, 1, 2, 3, 11, 21, 102]) assert.ok(messages[pluralKey(t, locale, family, count)], `${locale} ${family} ${count}`);
    }
  });
}

test('round 2 policy numbers survive translations and remain the original English facts', async () => {
  const baseline = JSON.parse(readFileSync('tests/fixtures/app-round2-policy-main.json', 'utf8'));
  const en = await appMessagesFor('en');
  for (const { code } of LOCALES) {
    const messages = await appMessagesFor(code);
    for (const [key, english] of Object.entries(baseline)) {
      assert.equal(en[key], english, key);
      assert.deepEqual((messages[key].match(/\d+(?:[.,]\d+)*/g) || []).sort(), (english.match(/\d+(?:[.,]\d+)*/g) || []).sort(), `${code} ${key}`);
    }
  }
});

test('generation rights consent stays English and exactly scoped in the audit', () => {
  const source = readFileSync(files.generation, 'utf8');
  assert.match(source, /<label lang="en" dir="ltr"[^>]*><input type="checkbox" checked=\{consent\}/);
  const legal = candidates(files.generation, source, { app: true }).filter(row => row.kind === 'binding');
  assert.equal(legal.length, 1);
  assert.ok(legal.every(row => row.status === 'translated'));
  assert.equal(candidates(files.generation, '<label lang="en" dir="ltr">Untranslated controls</label>', { app: true })[0].status, 'unresolved');
  assert.match(readFileSync('app/api/v1/generations/route.js', 'utf8'), /p_version: RIGHTS_ATTESTATION_VERSION/);
});

// These are additional behavior checks, not changes to the origin/main snapshots.
test('Create keeps model ids stable and formats live credit labels in all four render locales', async () => {
  const catalog = [{ id: 'flux-2-pro', name: 'Flux 2 Pro', kind: 'image', credits: 1234, media: {}, takesPrompt: true, durations: [5], aspects: ['16:9'] }];
  for (const locale of ['en', 'de', 'ja', 'ar']) {
    const messages = await appMessagesFor(locale);
    const html = renderScenario({ area: 'create', name: 'default', catalog }, locale, messages);
    assert.ok(html.includes('data-model-kind="image"'));
    assert.ok(html.includes('value="flux-2-pro"'));
    assert.ok(html.includes(locale === 'en' ? '1234' : (1234).toLocaleString(localeTag(locale))));
    assert.doesNotMatch(html, /app\.create\.|NaN|\{count\}/);
  }
});

test('webhook retry ceiling remains eight attempts in each language', async () => {
  const eight = { en: 'up to eight times', es: 'hasta ocho veces', zh: '最多重试八次', hi: 'अधिकतम आठ बार', ar: 'حتى ثماني مرات', fr: 'jusqu’à huit fois', pt: 'até oito vezes', ru: 'до восьми раз', ja: '最大八回', de: 'bis zu achtmal', ko: '최대 여덟 번' };
  for (const [code, phrase] of Object.entries(eight)) assert.ok((await appMessagesFor(code))['app.publish.developer.webhooksIntro'].includes(phrase), code);
});


test('new Library references follow the established public glossary', async () => {
  const areas = ['publish-developer', 'publish-inbox', 'editor-generation', 'publish-calendar', 'oddlings', 'editor-legacy', 'create-studio'];
  for (const { code } of LOCALES.filter(item => item.code !== 'en')) {
    const publicMessages = (await import(`../lib/i18n/messages/${code}.mjs`)).default;
    for (const area of areas) {
      const messages = (await import(`../lib/i18n/messages/app/${code}/${area}.mjs`)).default;
      for (const value of Object.values(messages)) assert.ok(!value.includes('Library') || publicMessages['label.Library'] === 'Library', `${code}/${area}`);
    }
  }
});
