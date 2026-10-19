import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { appMessagesFor } from '../lib/i18n/appMessages.mjs';
import { LOCALES, localeTag } from '../lib/i18n/locales.mjs';
import { translator, pluralKey } from '../lib/i18n/translate.mjs';
import { candidates } from '../scripts/audit-public-i18n.mjs';
import { files, metadataFiles, scenarios, renderScenario, makeFixture, visibleText, labels } from './helpers/appI18nRemainder.mjs';
import { SAVE_ERRORS } from '../app/veyrnox/_lib/filmMasterSave.mjs';
import { emptyFilm, stageIssues, boardIssues, shotIssues } from '../app/veyrnox/_lib/filmStudio.js';
process.env.TZ = 'UTC';

test('all 32 remainder files have no unresolved copy, parse errors or translator shadowing', () => {
  const all = [...Object.values(files), ...metadataFiles];
  assert.equal(all.length, 32);
  for (const file of all) {
    const source = readFileSync(file, 'utf8');
    assert.deepEqual(candidates(file, source, { app: true }).filter(row => row.status === 'unresolved'), [], file);
    const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JSX);
    assert.deepEqual(tree.parseDiagnostics, [], file);
    function scan(node) {
      if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) assert.ok(!node.parameters.some(p => p.name.getText(tree) === 't'), file);
      if (ts.isJsxAttribute(node) && (['value', 'id', 'name', 'key'].includes(node.name.text) || node.name.text.startsWith('data-'))) assert.doesNotMatch(node.getText(tree), /\bt(?:Or)?\(/, file);
      ts.forEachChild(node, scan);
    }
    scan(tree);
    assert.doesNotMatch(source, /\b(?:text-left|ml-|mr-|pl-|pr-)/, file);
  }
});

test('remainder English visible text and accessible copy match origin/main 1675cf4d', async () => {
  const baseline = JSON.parse(readFileSync('tests/fixtures/app-remainder-english-main.json', 'utf8'));
  const messages = await appMessagesFor('en');
  assert.equal(baseline.length, scenarios.length);
  for (const [index, scenario] of scenarios.entries()) {
    const html = renderScenario(scenario, 'en', messages);
    assert.equal(visibleText(html), baseline[index].text, `${index} ${scenario.area}`);
    assert.deepEqual(labels(html), baseline[index].labels, `${index} ${scenario.area}`);
  }
});

for (const locale of ['de', 'ja', 'ar']) test(`remainder ${locale} renders preserve values without raw keys or placeholders`, async () => {
  const messages = await appMessagesFor(locale);
  for (const [index, scenario] of scenarios.entries()) {
    const html = renderScenario(scenario, locale, messages);
    assert.doesNotMatch(html, /app\.(?:create|oddlings|editor|credits|account|chat|film|publish|library)\.[\w.]|\{(?:count|stem|name|seconds|max|needs|label|range)\}/, `${index} ${scenario.area}`);
  }
  for (const area of ['download', 'stems']) {
    const html = renderScenario(scenarios.find(s => s.area === area), locale, messages);
    assert.match(html, /value="vocals"/);
    assert.ok(html.includes(messages['app.editor.stem.vocals']));
  }
  const topups = renderScenario(scenarios.find(s => s.area === 'topups' && s.states[0]?.length), locale, messages);
  assert.ok(topups.includes(new Intl.NumberFormat(localeTag(locale, 'en-US')).format(1200)));
  assert.ok(topups.includes(new Date('2026-10-18T10:00:00Z').toLocaleDateString(localeTag(locale, 'en-GB'), { day: 'numeric', month: 'short', year: 'numeric' })));
  assert.doesNotMatch(topups, /future_status/);
});

test('policy and billing numbers are extracted from the English source and identical in every catalog', async () => {
  const { facts, commit } = JSON.parse(readFileSync('tests/fixtures/app-remainder-policy-main.json', 'utf8'));
  assert.equal(commit, '1675cf4d1061bd822bc2f6738ac512abe5dc043f');
  const numbers = text => (text.match(/\d+(?:[.,]\d+)*/g) || []).sort();
  assert.equal(facts.length, 13);
  const en = await appMessagesFor('en');
  for (const { code } of LOCALES) {
    const messages = await appMessagesFor(code);
    for (const { key, english } of facts) {
      assert.equal(en[key], english, key);
      assert.deepEqual(numbers(messages[key]), numbers(english), `${code}/${key}`);
    }
  }
});

test('version-bound source rights stay exact English and keep the existing checkbox contract', async () => {
  for (const { code } of LOCALES) {
    const html = renderScenario(scenarios.find(s => s.area === 'rights'), code, await appMessagesFor(code));
    assert.match(html, /lang="en" dir="ltr"/);
    assert.match(html, /I own this file, or I have the permission of everyone identifiable in it\./);
    assert.match(html, /This statement is recorded against the generation and your account\./);
    assert.match(html, /href="\/legal\/aup"/);
    assert.match(html, /data-testid="create-source-rights"/);
  }
});

test('metadata preserves English titles, descriptions and noindex while translating other locales', async () => {
  process.env.LOCALES_ENABLED = 'true';
  const expected = [ ['Video editor', 'Cut, arrange and export a video in your browser.'], ['Review saved edit'], ['Film Studio', 'Plan a film in seven stages, from your story to consistent, generation-ready shot prompts.'] ];
  for (const locale of ['en', 'de', 'ja', 'ar']) {
    const f = makeFixture(locale, await appMessagesFor(locale));
    for (const [i, file] of metadataFiles.entries()) {
      const metadata = await f.load(file).generateMetadata();
      assert.deepEqual(metadata.robots, { index: false, follow: false });
      if (locale === 'en') assert.deepEqual([metadata.title, ...(metadata.description ? [metadata.description] : [])], expected[i]);
      else assert.notEqual(metadata.title, expected[i][0]);
    }
  }
});

test('plural families use Intl categories while keeping the original English wording', async () => {
  for (const { code } of LOCALES) {
    const messages = await appMessagesFor(code), t = translator(code, messages);
    for (const family of ['app.account.referral.joined', 'app.oddlings.explore.count', 'app.chat.price', 'app.film.issues.more', 'app.publish.activity.count']) {
      for (const count of [0, 1, 2, 3, 5, 11, 21, 102]) assert.ok(messages[pluralKey(t, code, family, count)]);
    }
  }
});

test('Film save errors and progress translate known messages and keep safe unknown fallbacks', async () => {
  for (const locale of ['en', 'de', 'ja', 'ar']) {
    const messages = await appMessagesFor(locale), t = translator(locale, messages);
    const f = makeFixture(locale, messages);
    // The helper is exported for direct coverage of every error-code branch.
    const { saveError } = f.load(files.save);
    for (const [code, english] of Object.entries(SAVE_ERRORS)) {
      assert.equal(saveError(t, { code }), locale === 'en' ? english : messages[`app.film.save.error.${code}`]);
    }
    for (const error of [{ code: 'future_error' }, { message: 'future_error' }, {}]) assert.equal(saveError(t, error), messages['app.film.save.failed']);
    assert.equal(saveError(t, { message: 'Provider diagnostic unchanged.' }), 'Provider diagnostic unchanged.');
    const message = 'Library masters must be no larger than 25 MiB. You can still download this file.';
    assert.equal(saveError(t, { message }), messages['app.film.save.size']);
    const html = renderScenario(scenarios.find(s => s.area === 'save' && s.states?.[1]), locale, messages);
    assert.ok(html.includes(messages['app.film.save.checking']));
  }
});

test('Film helper diagnostics translate complete templates and preserve asset and shot names', async () => {
  const film = { ...emptyFilm(), shots: [{ id: 'User shot', location: '@room:v1', characters: '@actor:v1', props: 'none' }] };
  const issues = [...Array.from({ length: 7 }, (_, stage) => stageIssues(film, stage)).flat(), ...boardIssues({ name: '@room:v1', type: 'location', references: [{ source: '', caption: '', kind: 'reference' }], decision: 'revise' }), ...shotIssues({})];
  for (const locale of ['en', 'de', 'ja', 'ar']) {
    const messages = await appMessagesFor(locale), t = translator(locale, messages), { filmIssue } = makeFixture(locale, messages).load(files.fields);
    for (const issue of issues) {
      const result = filmIssue(t, locale, issue);
      if (locale === 'en') assert.equal(result, issue);
      else assert.notEqual(result, issue, issue);
      assert.doesNotMatch(result, /app\.film\.|\{(?:label|name|range|type)\}/);
      for (const name of ['User shot', '@room:v1', '@actor:v1']) if (issue.includes(name)) assert.ok(result.includes(name));
    }
    assert.equal(filmIssue(t, locale, 'Provider diagnostic: User content'), 'Provider diagnostic: User content');
  }
});

test('Publish activity localizes known actions and load errors while preserving unknown prose and IDs', async () => {
  const { activityLabel, activityLoadError } = await import('../app/veyrnox/_lib/publishPresentation.js');
  for (const locale of ['en', 'de', 'ja', 'ar']) {
    const messages = await appMessagesFor(locale), t = translator(locale, messages);
    const actionKeys = Object.keys(messages).filter(key => key.startsWith('app.publish.activity.action.'));
    assert.equal(actionKeys.length, 58);
    if (locale === 'en') for (const key of actionKeys) assert.equal(messages[key], activityLabel(key.split('.').at(-1)));
    const f = makeFixture(locale, messages), { activityNotice } = f.load(files.activity);
    assert.equal(activityNotice(t, locale, 'Provider notice unchanged'), 'Provider notice unchanged');
    assert.equal(activityNotice(t, locale, 'Showing the latest 50 entries. Older history will be available after the activity history upgrade.'), t('app.publish.activity.limited', { count: locale === 'en' ? 50 : (50).toLocaleString(localeTag(locale)) }));
    for (const status of [402, 403, 500]) {
      const error = activityLoadError({ status });
      const key = `app.publish.activity.error.${error.message}`;
      assert.ok(messages[key]);
      if (locale === 'en') assert.equal(messages[key], error.message);
    }
    const scenario = scenarios.find(s => s.area === 'activity' && s.states?.[0]?.length);
    const unknown = { ...scenario, states: [[{ ...scenario.states[0][0], action: 'future_action' }], null, null, false, ''] };
    const html = renderScenario(unknown, locale, messages);
    assert.ok(html.includes(locale === 'en' ? 'Future action' : messages['app.publish.activity.unknown']));
    assert.match(html, /user@example\.test/);
  }
});

test('known Library and stem failures retain English helper text and have translations', async () => {
  const { assetErrorMessage } = await import('../app/veyrnox/_lib/assetRefresh.js');
  for (const { code } of LOCALES) {
    const messages = await appMessagesFor(code);
    for (const status of [401, 404, 429, 'default']) {
      const key = `app.library.assetError.${status}`;
      assert.ok(messages[key]);
      if (code === 'en') assert.equal(messages[key], assetErrorMessage({ status }));
    }
    for (const text of ['Choose a supported audio stem.', 'That file is not available.', 'Could not load that file. Try again.', 'That file is too large for the editor.']) {
      assert.ok(messages[`app.editor.stem.error.${text}`]);
      if (code === 'en') assert.equal(messages[`app.editor.stem.error.${text}`], text);
    }
  }
});
