import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { appMessagesFor } from '../lib/i18n/appMessages.mjs';
import { LOCALES, localeTag } from '../lib/i18n/locales.mjs';
import { translator, pluralKey } from '../lib/i18n/translate.mjs';
import { candidates } from '../scripts/audit-public-i18n.mjs';
import { files, scenarios, renderScenario, visibleText } from './helpers/appI18nRound5.mjs';
process.env.TZ = 'UTC';

test('round 5 finishes seventeen files with no syntax errors, literal residue or translated machine values', () => {
  for (const file of Object.values(files)) {
    const source = readFileSync(file, 'utf8');
    assert.deepEqual(candidates(file, source, { app: true }).filter(row => row.status === 'unresolved'), [], file);
    const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JSX);
    assert.deepEqual(tree.parseDiagnostics, [], file);
    function scan(node) {
      if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) assert.ok(!node.parameters.some(parameter => parameter.name.getText(tree) === 't'), `${file}: translator shadowed`);
      if (ts.isJsxAttribute(node) && (['value','id','key','name'].includes(node.name.text) || node.name.text.startsWith('data-'))) assert.doesNotMatch(node.getText(tree), /\bt(?:Or)?\(/, `${file}: translated machine value`);
      ts.forEachChild(node, scan);
    }
    scan(tree);
  }
});

test('thirty populated English render states remain byte-identical to main', async () => {
  const baseline = JSON.parse(readFileSync('tests/fixtures/app-round5-english-main.json', 'utf8'));
  const messages = await appMessagesFor('en');
  assert.equal(baseline.length, scenarios.length);
  for (const [index, scenario] of scenarios.entries()) assert.equal(visibleText(renderScenario(scenario, 'en', messages)), baseline[index].text, `${index} ${scenario.area}`);
});

for (const locale of ['de','ja','ar']) test(`round 5 actual ${locale} catalogs render all thirty states without raw keys`, async () => {
  const messages = await appMessagesFor(locale);
  for (const [index, scenario] of scenarios.entries()) {
    const html = renderScenario(scenario, locale, messages);
    assert.doesNotMatch(html, /app\.(?:editor|publish|chat|account|credits|film)\.[A-Za-z]|\{(?:count|number|seconds|frame|stage|hour|date|start|end|name|price)\}/, `${index} ${scenario.area}`);
    if (scenario.area === 'threads') assert.match(html, /User folder unchanged/);
    if (scenario.area === 'team') assert.match(html, /User brand unchanged/);
    if (scenario.area === 'contacts') assert.match(html, /User contact unchanged/);
    if (scenario.area === 'packs' && scenario.name === 'TopUpPacks') {
      assert.match(html, /<span lang="en" dir="ltr">I want my credits added to my account straight away\./);
      assert.match(html, /data-credit-pack="pack"/);
      assert.ok(html.includes(messages['app.credits.packs.choose']));
    }
    if (scenario.area === 'catalog' && scenario.props.panel === 'Effects' && !scenario.states) assert.match(html, /role="tab" aria-selected="true"/);
  }
});

test('round 5 policy statements retain main English and every policy number in all eleven catalogs', async () => {
  const source = JSON.parse(readFileSync('tests/fixtures/app-round5-policy-main.json', 'utf8'));
  assert.ok(Object.keys(source).length >= 7);
  const en = await appMessagesFor('en');
  const numbers = text => (text.match(/\d+(?:[.,]\d+)*/g) || []).sort();
  for (const {code} of LOCALES) {
    const messages = await appMessagesFor(code);
    for (const [key, english] of Object.entries(source)) {
      assert.equal(en[key], english, key);
      assert.deepEqual(numbers(messages[key]), numbers(english), `${code}/${key}`);
    }
  }
});

test('new count families supply all plural forms and retain original English Intl defaults', async () => {
  const families = ['app.editor.speech.created','app.publish.contacts.conversations','app.publish.contacts.messages','app.publish.contacts.unread','app.credits.packs.credited','app.credits.packs.price','app.credits.packs.videos','app.credits.packs.images','app.publish.queues.slots','app.publish.insights.slot','app.publish.insights.cell','app.publish.insights.insufficient','app.publish.workflows.suggestions'];
  for (const {code} of LOCALES) {
    const messages = await appMessagesFor(code), t = translator(code, messages);
    for (const family of families) {
      for (const form of ['zero','one','two','few','many','other']) assert.ok(messages[`${family}.${form}`], `${code}/${family}/${form}`);
      for (const count of [0,1,2,3,11,21,102]) assert.ok(messages[pluralKey(t,code,family,count)]);
    }
  }
  for (const original of [undefined,'en-US','en-GB',[]]) assert.equal(localeTag('en',original),original);
});

test('the audit exempts only exact version-bound supply consent and validated CSS palette syntax', () => {
  const consent = candidates(files.packs,readFileSync(files.packs,'utf8'),{app:true}).filter(row=>row.reason?.includes('version-bound'));
  assert.equal(consent.length,1);
  assert.equal(candidates(files.packs,'<span lang="en" dir="ltr">Untranslated controls</span>',{app:true})[0].status,'unresolved');
  const css = "const backgrounds = { Basic: 'from-slate-900 via-slate-600 to-slate-950' }; const preview = <span className={`block ${backgrounds[item.category]}`} />;";
  assert.deepEqual(candidates(files.catalog,css,{app:true}),[]);
  assert.ok(candidates(files.catalog,css.replace('from-slate-900 via-slate-600 to-slate-950','Untranslated controls'),{app:true}).some(row=>row.status==='unresolved'));
});

test('unknown server roles and workflow kinds use safe fallbacks without catalog keys', async () => {
  const original = scenarios.find(scenario=>scenario.area==='workflows');
  const states=structuredClone(original.states);
  states[1][0].kind='future_kind'; states[1][0].match_mode='future_mode';
  for (const locale of ['en','de','ja','ar']) {
    const text=visibleText(renderScenario({...original,states},locale,await appMessagesFor(locale)));
    assert.match(text,/future_kind/); assert.match(text,/future_mode/); assert.doesNotMatch(text,/app\.publish\./);
  }
});
