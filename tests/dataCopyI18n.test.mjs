import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import * as React from 'react';
import ts from 'typescript';
import { ALL_TEMPLATES } from '../app/veyrnox/_lib/templates.js';
import { CATALOGS, translator, tOr } from '../lib/i18n/translate.mjs';
import { appMessagesFor } from '../lib/i18n/appMessages.mjs';
import { PRESET_STEP_KEYS, presetStep } from '../lib/i18n/presetSteps.mjs';
import { failedCreationCopy } from '../lib/i18n/createCopy.mjs';
import { dataInventory } from '../scripts/lib/data-i18n.mjs';
import { publicFiles, appFiles, candidates } from '../scripts/audit-public-i18n.mjs';
import { legalDocument } from '../lib/i18n/legal/catalogs.mjs';
import { fixture } from './helpers/publicSiteRender.mjs';

const codes = Object.keys(CATALOGS);
const digits = value => (value.match(/\d+(?:[.:–]\d+)*/g) || []).sort();
const tree = (file, source) => ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JSX);

test('all 146 needs and 15 distinct steps have exact English and ten translated display entries', () => {
  const original = JSON.stringify(ALL_TEMPLATES);
  assert.equal(ALL_TEMPLATES.filter(p => p.needs).length, 146);
  assert.equal(Object.keys(PRESET_STEP_KEYS).length, 15);
  for (const code of codes) {
    const t = translator(code);
    for (const preset of ALL_TEMPLATES) {
      if (preset.needs) {
        const value = tOr(t, `presets.needs.${preset.id}`, preset.needs);
        assert.ok(value && value !== `presets.needs.${preset.id}`);
        assert.equal(value === preset.needs, code === 'en', `${code}/${preset.id}`);
        assert.deepEqual(digits(value), digits(preset.needs), `${code}/${preset.id} facts`);
      }
      for (const step of preset.steps || []) {
        assert.ok(PRESET_STEP_KEYS[step], step);
        assert.equal(presetStep(t, step) === step, code === 'en');
        assert.deepEqual(digits(presetStep(t, step)), digits(step), `${code}/${step} duration`);
      }
    }
    assert.equal(presetStep(t, 'User-authored unknown recipe.'), 'User-authored unknown recipe.');
  }
  assert.equal(JSON.stringify(ALL_TEMPLATES), original, 'No display operation mutates prompt/settings/source fields');
});

test('new public area files have no duplicate keys and remain below 500 lines', () => {
  for (const code of codes) {
    const seen = new Set();
    for (const area of ['needs', 'steps']) {
      const file = `lib/i18n/messages/presets/${code}/${area}.mjs`, source = readFileSync(file, 'utf8');
      assert.ok(source.split('\n').length < 500);
      assert.match(source, /const messages =/);
      const declaration = tree(file, source).statements.find(ts.isVariableStatement).declarationList.declarations[0];
      for (const p of declaration.initializer.properties) {
        assert.ok(!seen.has(p.name.text), `${code}/${p.name.text}`); seen.add(p.name.text);
      }
    }
    const root = readFileSync(`lib/i18n/messages/${code}.mjs`, 'utf8');
    for (const key of seen) assert.ok(!root.includes(JSON.stringify(key)) && !root.includes(`'${key}'`), `root duplicate ${key}`);
  }
});

test('data inventory catches objects, local constant arrays, factory arguments and export lists', () => {
  const file = 'lib/exampleData.mjs';
  const samples = [
    `export const rows = [{ hint: 'Prepare your image before continuing.' }];`,
    `const words = ['Prepare your image before continuing.']; export const rows = { words };`,
    `const words = ['Prepare your image before continuing.']; function make() { return { words }; } export const rows = [make()];`,
    `const rows = [{ hint: 'Prepare your image before continuing.' }]; export { rows };`,
    `export const rows = [{ title: 'Prepare Your Image Before Continuing' }];`,
  ];
  for (const source of samples) {
    const rows = dataInventory(tree(file, source), file, {});
    assert.equal(rows.length, 1); assert.equal(rows[0].status, 'unresolved');
  }
  const file2 = 'app/veyrnox/_lib/sourceTemplates.js';
  const source = `export const templates = [{id:'new-template', needs:'a clear starting image', prompt:'Animate the starting image carefully.', steps:['Prepare your image before continuing.'], description:'An untranslated visible description here.'}];`;
  const rows = dataInventory(tree(file2, source), file2, {});
  assert.deepEqual(rows.map(r => [r.field, r.status]), [['needs','unresolved'],['prompt','allowlisted'],['steps','unresolved'],['description','unresolved']]);
  assert.ok(rows.find(r => r.field === 'prompt').reason);
});

test('actual source recipes fail the data audit without the new catalogs; both import graphs reach them', () => {
  for (const files of [publicFiles(), appFiles()]) {
    for (const name of ['sourceTemplates.js','sourceTemplateExpansion4.js','sourceTemplateExpansion5.js']) {
      const file = `app/veyrnox/_lib/${name}`;
      assert.ok(files.includes(file));
      const rows = dataInventory(tree(file, readFileSync(file, 'utf8')), file, {});
      assert.ok(rows.some(r => r.field === 'needs' && r.status === 'unresolved'), file);
      assert.ok(rows.some(r => (r.field === 'steps' || r.owner === 'steps') && r.status === 'unresolved'), file);
    }
  }
  assert.ok(publicFiles().includes('app/s/[slug]/page.js'));
});

test('recipe SSR translates steps but forwards exact prompt and preset data to UseTemplate', () => {
  const preset = ALL_TEMPLATES.find(p => p.id === 'product-hero-360');
  for (const code of ['en','de','ar','ja']) {
    const f = fixture(code, '/presets/product-hero-360', { moduleMocks: {
      './UseTemplate': { UseTemplate: ({ preset: actual, prompt }) => {
        assert.equal(actual, preset); assert.equal(prompt, preset.prompt);
        return React.createElement('div', { 'data-use-template': actual.id });
      } },
    } });
    const html = f.render(React.createElement(f.load('app/veyrnox/_components/TemplateRecipe.js').TemplateRecipe, { preset }));
    const step = presetStep(translator(code), preset.steps[0]);
    assert.ok(html.includes(step));
    assert.equal(html.includes(preset.steps[0]), code === 'en');
    assert.ok(html.includes('data-use-template="product-hero-360"'));
  }
});

test('app data areas preserve keys, placeholders and numeric facts in all languages', async () => {
  for (const area of ['data-guidance','data-errors']) {
    const { default: en } = await import(`../lib/i18n/messages/app/en/${area}.mjs`);
    for (const code of codes) {
      const { default: other } = await import(`../lib/i18n/messages/app/${code}/${area}.mjs`);
      assert.deepEqual(Object.keys(other), Object.keys(en));
      for (const [key, value] of Object.entries(en)) {
        assert.deepEqual(digits(other[key]), digits(value), `${code}/${key}`);
        assert.deepEqual(other[key].match(/\{\w+\}/g), value.match(/\{\w+\}/g));
        if (code !== 'en') assert.notEqual(other[key], value, `${code}/${key}`);
      }
    }
  }
});

test('displayed failure refunds remain pending until the job says refunded', async () => {
  for (const code of codes) {
    const t = translator(code, await appMessagesFor(code));
    for (const refunded of [false, true]) {
      const job = { error_code: 'provider_error', refunded }, before = JSON.stringify(job);
      const english = `The model returned an error. ${refunded ? 'Credits refunded' : 'Your credits are on their way back'}.`;
      const result = failedCreationCopy(t, code, job, english);
      assert.ok(result.includes(t(refunded ? 'app.data.refunded' : 'app.data.refundPending')));
      if (code === 'en') assert.equal(result, english);
      assert.equal(JSON.stringify(job), before);
      const unknown = failedCreationCopy(t, code, { error_code: 'unlisted', refunded }, english);
      assert.ok(unknown.includes(t(refunded ? 'app.data.refunded' : 'app.data.refundPending')));
    }
  }
});

test('legal headings translate in Terms and Refunds without changing section numbers', async () => {
  for (const code of codes.filter(c => c !== 'en')) {
    const { messages: terms } = await legalDocument(code, 'terms');
    const { messages: refund } = await legalDocument(code, 'refund');
    assert.match(terms.b018, /^3A\. /); assert.match(terms.b045, /^7B\. /);
    assert.notEqual(terms.b018, '3A. Credit Subscriptions'); assert.notEqual(refund.b012, 'Credit Subscriptions');
    // The defined product name stays identical to the body text and the app (reviewer finding: heading and body must agree).
    assert.equal(terms.b045, '7B. Cinema Pass'); assert.equal(refund.b021, 'Cinema Pass');
    assert.notEqual(translator(code)('legal.jurisdiction'), 'England & Wales');
  }
});

test('smart-link SSR preserves creator data and translates only chrome and default metadata', async () => {
  const creator = { title: 'My Creator Title', bio: '', theme: 'midnight' };
  const calls = [];
  const moduleMocks = {
    '../../../lib/social/publishFeature.js': { socialSmartLinksEnabled: () => true },
    '../../../packages/db/supabase-client.js': { envConfig: () => ({ supabaseUrl: 'fixture', serviceRoleKey: 'fixture' }), rpc: async (name, args) => {
      calls.push([name, args]);
      return { ok: true, smartlink: creator, items: [{ id: 'item-id', label: 'Creator’s own label' }] };
    } },
  };
  const old = process.env.LOCALES_ENABLED; process.env.LOCALES_ENABLED = 'true';
  try {
    for (const code of codes) {
      const f = fixture(code, '/s/test-slug', { moduleMocks });
      const page = f.load('app/s/[slug]/page.js'), t = translator(code);
      const html = f.render(await page.default({ params: Promise.resolve({ slug: 'test-slug' }) }));
      assert.ok(html.includes(creator.title)); assert.ok(html.includes('Creator’s own label'));
      assert.ok(html.includes('/s/test-slug/go/item-id')); assert.ok(html.includes(t('smartlink.madeWith')));
      const metadata = await page.generateMetadata({ params: Promise.resolve({ slug: 'test-slug' }) });
      assert.equal(metadata.title, 'My Creator Title — Veyrnox'); assert.equal(metadata.description, t('smartlink.description'));
      creator.bio = 'Creator bio stays exact.';
      assert.equal((await page.generateMetadata({ params: Promise.resolve({ slug: 'test-slug' }) })).description, creator.bio);
      creator.bio = '';
    }
    assert.ok(calls.every(([, args]) => JSON.stringify(args) === '{"p_slug":"test-slug"}'));
  } finally { if (old === undefined) delete process.env.LOCALES_ENABLED; else process.env.LOCALES_ENABLED = old; }
});

test('new data areas are loaded only through app catalogs', () => {
  assert.doesNotMatch(readFileSync('lib/i18n/translate.mjs', 'utf8'), /messages\/app/);
  for (const code of codes) assert.doesNotMatch(readFileSync(`lib/i18n/messages/${code}.mjs`, 'utf8'), /from ['"][^'"]*(?:data-guidance|data-errors|\/app\/)/);
  for (const area of readdirSync('lib/i18n/messages/app/en').filter(f => f.startsWith('data-'))) assert.ok(readFileSync(`lib/i18n/messages/app/en/${area}`, 'utf8').split('\n').length < 500);
  for (const file of ['app/veyrnox/_components/TemplateRecipe.js','app/veyrnox/presets/[id]/page.js']) assert.ok(!candidates(file, readFileSync(file,'utf8')).some(r => r.status === 'unresolved'));
});

test('English recipe and detail markup match the reviewed baseline', async () => {
  const { createHash } = await import('node:crypto');
  const baseline = JSON.parse(readFileSync('tests/fixtures/data-copy-english-main.json', 'utf8'));
  const hash = value => createHash('sha256').update(value).digest('hex');
  const old = process.env.LOCALES_ENABLED; process.env.LOCALES_ENABLED = 'true';
  try {
    const f = fixture('en', '/presets/product-hero-360');
    const preset = ALL_TEMPLATES.find(p => p.id === 'product-hero-360');
    assert.equal(hash(f.render(React.createElement(f.load('app/veyrnox/_components/TemplateRecipe.js').TemplateRecipe, { preset }))), baseline.recipe);
    assert.equal(hash(f.render(await f.load('app/veyrnox/presets/[id]/page.js').default({ params: Promise.resolve({ id: preset.id }) }))), baseline.detail);
  } finally { if (old === undefined) delete process.env.LOCALES_ENABLED; else process.env.LOCALES_ENABLED = old; }
});

test('Film acceptance labels translate while checkbox changes retain the original stored values', async () => {
  const { ACCEPTANCE_CHECKS, PROMPT_DETAILS } = await import('../app/veyrnox/_lib/filmStudio.js');
  const messages = await appMessagesFor('de'), t = translator('de', messages);
  const next = new Map(); let stateIndex = 0;
  const values = ['', {}, null, '', 'Original change', 'accepted', [], ''];
  const f = fixture('de', '/app/film-studio', { messages, moduleMocks: {
    react: { ...React, useState: () => { const index = stateIndex++; return [values[index], value => next.set(index, value)]; } },
    '../../../../components/I18nProvider': { useI18n: () => ({ locale: 'de', t }) },
    '../../_lib/filmStudio': { ACCEPTANCE_CHECKS, PROMPT_DETAILS, promptContext: () => 'context' },
    './FilmPromptOutput': { FilmPromptOutput: () => null },
    './FilmMaster': { FilmMaster: () => null },
  } });
  const film = { shots: [{ id: 'shot' }], prompts: [{ shot: 'shot', version: 1, context: 'context', content: 'Canonical prompt' }], attempts: [], stack: { video: 'model', aspect: '16:9' } };
  const node = f.load('app/veyrnox/_components/film/FilmPrompts.js').FilmPrompts({ film, update() {}, models: [] });
  const inputs = [];
  function scan(element) {
    if (!React.isValidElement(element)) return;
    if (element.type === 'input' && element.props.type === 'checkbox') inputs.push(element);
    React.Children.forEach(element.props.children, scan);
  }
  scan(node); assert.equal(inputs.length, 6);
  inputs.forEach((input, index) => {
    input.props.onChange({ target: { checked: true } });
    assert.deepEqual(next.get(6), [ACCEPTANCE_CHECKS[index]]);
  });
  const html = f.render(node);
  assert.ok(html.includes(messages['app.data.film.check.1']));
  assert.ok(!html.includes(ACCEPTANCE_CHECKS[1]));
});

test('Oddling control labels translate without changing selected canonical traits', async () => {
  const { CHARACTER_GROUPS } = await import('../app/veyrnox/_lib/character.js');
  const messages = await appMessagesFor('de');
  const f = fixture('de', '/app/create', { messages });
  const group = CHARACTER_GROUPS.find(g => g.id === 'hair');
  const html = f.render(React.createElement(f.load('app/veyrnox/_components/OddlingCatalogControls.js').TileGroup, { group, picks: {}, value: '', onChange() {}, categoryId: 'hair' }));
  assert.ok(html.includes(messages['app.data.character.hair']));
  assert.ok(!html.includes('Hair / Head Shape'));
});

test('every creation error code has a translated message, so no code falls back to the generic refund wording', async () => {
  const { readFileSync } = await import('node:fs');
  const { appMessagesFor } = await import('../lib/i18n/appMessages.mjs');
  const source = readFileSync(new URL('../app/veyrnox/_lib/createErrors.js', import.meta.url), 'utf8');
  const block = source.slice(source.indexOf('ERROR_COPY'), source.indexOf('export function failedJobCopy'));
  const codes = [...block.matchAll(/^\s*['"]([a-z_]+(?::[a-z_]+)?)['"]\s*:/gm)].map((match) => match[1]);
  assert.ok(codes.length >= 5, 'found the ERROR_COPY codes');
  for (const locale of ['en', 'es', 'zh', 'hi', 'ar', 'fr', 'pt', 'ru', 'ja', 'de', 'ko']) {
    const messages = await appMessagesFor(locale);
    for (const code of codes) assert.equal(typeof messages[`app.create.error.${code}`], 'string', `${locale} lacks app.create.error.${code}`);
  }
});
