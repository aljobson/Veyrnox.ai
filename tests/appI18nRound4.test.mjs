import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { appMessagesFor } from '../lib/i18n/appMessages.mjs';
import { LOCALES, localeTag } from '../lib/i18n/locales.mjs';
import { translator, pluralKey } from '../lib/i18n/translate.mjs';
import { candidates } from '../scripts/audit-public-i18n.mjs';
import { files, scenarios, renderScenario, visibleText } from './helpers/appI18nRound4.mjs';
process.env.TZ = 'UTC';

test('round 4 completes twelve files without syntax errors, translated machine values or shadowed translators', () => {
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

test('twenty-two English render states remain byte-identical to main', async () => {
  const baseline = JSON.parse(readFileSync('tests/fixtures/app-round4-english-main.json', 'utf8'));
  const messages = await appMessagesFor('en');
  assert.equal(baseline.length, scenarios.length);
  for (const [index, scenario] of scenarios.entries()) assert.equal(visibleText(renderScenario(scenario, 'en', messages)), baseline[index].text, `${index} ${scenario.area}`);
});

for (const locale of ['de', 'ja', 'ar']) test(`round 4 populated component renders use actual ${locale} catalogs`, async () => {
  const messages = await appMessagesFor(locale);
  for (const scenario of scenarios) {
    const html = renderScenario(scenario, locale, messages);
    assert.doesNotMatch(html, /app\.(?:enhance|editor|publish|create|chat)\.[A-Za-z]|\{(?:count|version|date|name|credits)\}/, scenario.area);
    if (scenario.area === 'commerce' && scenario.name === 'CommerceWorkspace') {
      assert.match(html, /User product unchanged/);
      assert.ok(visibleText(html).includes(messages['app.publish.commerce.title']));
    }
    if (scenario.area === 'chat' && scenario.name === 'ChatWorkspace') assert.match(html, /Provider response unchanged/);
    if (scenario.area === 'media') {
      assert.match(html, /User prompt unchanged/);
      assert.match(html, /data-testid="chat-media-generate"/);
      if (scenario.props.media.sources.image) {
        assert.match(html, /lang="en" dir="ltr"/);
        assert.ok(visibleText(html).includes('I own these files or have permission to use every identifiable person, voice, brand, artwork, and recording under the Acceptable Use Policy.'));
      }
    }
    if (scenario.area === 'transcript' && scenario.props.tl.text.length) assert.match(html, />User<\/button>.*>transcript<\/button>.*>unchanged<\/button>/);
    if (scenario.area === 'motion') assert.match(html, /value="stabilize"/);
  }
});

test('round 4 policy statements retain main English and every literal number in all languages', async () => {
  const baseline = JSON.parse(readFileSync('tests/fixtures/app-round4-policy-main.json', 'utf8'));
  assert.equal(Object.keys(baseline).length, 38);
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

test('all new count families provide Arabic and Russian plural forms and preserve English formatting defaults', async () => {
  const families = ['app.publish.commerce.variants', 'app.create.character.starters', 'app.editor.sheet.title', 'app.editor.sheet.job', 'app.chat.settings.credits', 'app.chat.settings.words', 'app.chat.media.images', 'app.editor.pack.selected', 'app.editor.pack.matches', 'app.editor.transcript.selected', 'app.editor.motion.cuts', 'app.editor.motion.lost'];
  for (const { code } of LOCALES) {
    const messages = await appMessagesFor(code), t = translator(code, messages);
    for (const family of families) for (const count of [0, 1, 2, 3, 11, 21, 102]) assert.ok(messages[pluralKey(t, code, family, count)], `${code}/${family}/${count}`);
  }
  for (const original of [undefined, 'en-US', 'en-GB']) assert.equal(localeTag('en', original), original);
});

test('media consent is paired with its translated catalog', () => {
  const source = readFileSync(files.media, 'utf8');
  const legal = candidates(files.media, source, { app: true }).filter(row => row.kind === 'binding');
  assert.equal(legal.length, 1);
  assert.ok(legal.every(row => row.status === 'translated'));
  assert.match(source, /<label lang="en" dir="ltr"/);
  assert.equal(candidates(files.media, '<label lang="en" dir="ltr">Untranslated controls</label>', { app: true })[0].status, 'unresolved');
});

test('unknown RSS refresh errors keep the human-readable baseline fallback', async () => {
  const original = scenarios.find(scenario => scenario.area === 'autolists');
  for (const locale of ['en', 'de', 'ja', 'ar']) {
    const messages = await appMessagesFor(locale);
    const states = structuredClone(original.states);
    Object.assign(states[0][0], { refresh_interval_minutes: 999, last_error: 'unrecognized_feed_failure' });
    const text = visibleText(renderScenario({ ...original, states }, locale, messages));
    assert.doesNotMatch(text, /unrecognized_feed_failure|app\.publish\.autolists\./);
    assert.ok(text.includes('unrecognized feed failure'));
  }
});
