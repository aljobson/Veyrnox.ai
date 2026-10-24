import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { appMessagesFor } from '../lib/i18n/appMessages.mjs';
import { LOCALES, localeTag } from '../lib/i18n/locales.mjs';
import { translator, pluralKey, tOr } from '../lib/i18n/translate.mjs';
import { candidates } from '../scripts/audit-public-i18n.mjs';
import { files, scenarios, renderScenario, visibleText } from './helpers/appI18nRound3.mjs';
process.env.TZ = 'UTC';

test('round 3 completes nine files; parsing, stable machine values and translator bindings remain valid', () => {
  for (const file of Object.values(files)) {
    const source = readFileSync(file, 'utf8');
    assert.deepEqual(candidates(file, source, { app: true }).filter(row => row.status === 'unresolved'), [], file);
    const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JSX);
    assert.deepEqual(tree.parseDiagnostics, [], file);
    function scan(node) {
      if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) assert.ok(!node.parameters.some(parameter => parameter.name.getText(tree) === 't'), `${file}: translator shadowed`);
      if (ts.isJsxAttribute(node) && (['value', 'id', 'key', 'name'].includes(node.name.text) || node.name.text.startsWith('data-'))) assert.doesNotMatch(node.getText(tree), /\bt(?:Or)?\(/, `${file}: translated machine value`);
      ts.forEachChild(node, scan);
    }
    scan(tree);
  }
});

test('eighteen English render states match main including raw Ads network labels', async () => {
  const baseline = JSON.parse(readFileSync('tests/fixtures/app-round3-english-main.json', 'utf8'));
  const messages = await appMessagesFor('en');
  assert.equal(baseline.length, scenarios.length);
  for (const [index, scenario] of scenarios.entries()) {
    const expected = baseline[index].text;
    assert.equal(visibleText(renderScenario(scenario, 'en', messages)), expected, `${index} ${scenario.area}`);
  }
});

for (const locale of ['de', 'ja', 'ar']) test(`round 3 populated component renders use actual ${locale} catalogs`, async () => {
  const messages = await appMessagesFor(locale);
  for (const scenario of scenarios) {
    const html = renderScenario(scenario, locale, messages);
    assert.doesNotMatch(html, /app\.(?:editor|projects|publish|credits|videoAgent)\.[A-Za-z]|\{(?:count|version|date|name|credits)\}/, scenario.area);
    if (scenario.area === 'media' && scenario.name === 'AdvancedMediaBin') {
      assert.match(html, /value="video"/); assert.match(html, /User media unchanged/);
      assert.ok(html.includes(messages['app.editor.media.search']));
    }
    if (scenario.area === 'person') { assert.match(html, /value="person-reframe"/); assert.ok(visibleText(html).includes(messages['app.editor.person.policy'])); }
    if (scenario.area === 'ads') { assert.match(html, /value="tiktok"/); assert.match(html, /TikTok/); assert.match(html, /User campaign unchanged/); }
    if (scenario.area === 'video' && scenario.states) { assert.match(html, /Provider summary unchanged/); assert.match(html, /User narration unchanged/); }
    if (scenario.area === 'billing' && scenario.states[1] === null) {
      assert.match(html, /lang="en" dir="ltr"/);
      assert.ok(visibleText(html).includes('I agree to Starter at $10 plus applicable tax every month until I cancel. I receive 1200 Credits after each confirmed monthly payment; unused cycle Credits expire without rollover.'));
    }
  }
});

test('round 3 policy copy retains main English and every literal number across all languages', async () => {
  const baseline = JSON.parse(readFileSync('tests/fixtures/app-round3-policy-main.json', 'utf8'));
  const en = await appMessagesFor('en');
  const numbers = text => (text.match(/\d+(?:[.,]\d+)*/g) || []).sort();
  for (const { code } of LOCALES) {
    const messages = await appMessagesFor(code);
    for (const [key, english] of Object.entries(baseline)) {
      assert.equal(en[key], english, key);
      assert.deepEqual(numbers(messages[key]), numbers(english), `${code} ${key}`);
    }
  }
});

test('counts cover Arabic and Russian forms; unknown billing errors never expose a code or key', async () => {
  const families = ['app.editor.media.matches', 'app.editor.person.detected', 'app.editor.person.reshaped', 'app.editor.person.missing', 'app.projects.count', 'app.editor.project.missing', 'app.editor.project.clips', 'app.editor.project.sounds', 'app.editor.project.texts', 'app.publish.reports.days', 'app.publish.reports.recipients', 'app.credits.subscription.cycle', 'app.videoAgent.seconds', 'app.videoAgent.moreCredits'];
  for (const { code } of LOCALES) {
    const messages = await appMessagesFor(code), t = translator(code, messages);
    for (const family of families) for (const count of [0, 1, 2, 3, 11, 21, 102]) assert.ok(messages[pluralKey(t, code, family, count)], `${code}/${family}/${count}`);
    assert.equal(tOr(t, 'app.credits.subscription.error.future_code', t('app.credits.subscription.errorFallback')), messages['app.credits.subscription.errorFallback']);
  }
  for (const original of [undefined, 'en-US', 'en-GB']) assert.equal(localeTag('en', original), original);
});

test('subscription consent is paired with its translated catalog', () => {
  const source = readFileSync(files.billing, 'utf8');
  const legal = candidates(files.billing, source, { app: true }).filter(row => row.kind === 'binding');
  assert.equal(legal.length, 2, 'the monthly and the yearly checkout sentences');
  assert.ok(legal.every(row => row.status === 'translated'));
  assert.match(source, /<label lang="en" dir="ltr"/);
  assert.match(source, /catalog\.consent_version_yearly : catalog\.consent_version/);
  assert.equal(candidates(files.billing, '<label lang="en" dir="ltr">Untranslated controls</label>', { app: true })[0].status, 'unresolved');
});

test('report manual delivery is translated and unknown delivery errors retain their baseline code fallback', async () => {
  const original = scenarios.find(scenario => scenario.area === 'reports');
  for (const locale of ['en', 'de', 'ja', 'ar']) {
    const messages = await appMessagesFor(locale);
    for (const delivery_cadence of ['manual', 'weekly']) {
      const states = structuredClone(original.states);
      Object.assign(states[1][0], { delivery_cadence, last_delivery_error: 'unrecognized_delivery_failure' });
      const html = visibleText(renderScenario({ ...original, states }, locale, messages));
      assert.ok(html.includes(messages[`app.publish.reports.${delivery_cadence}`]));
      assert.doesNotMatch(html, /app\.publish\.reports\./);
      if (delivery_cadence === 'weekly') assert.ok(html.includes('unrecognized_delivery_failure'));
    }
  }
});
