import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import * as React from 'react';
import ts from 'typescript';
import { fixture } from './helpers/publicSiteRender.mjs';
import { PRESETS } from '../app/veyrnox/_lib/templates.js';
import { templateContract } from '../lib/templateContract.js';
import { templateModelId, MODELS } from '../app/veyrnox/_lib/tokens.js';
import { templateSourceAspect } from '../lib/templateFraming.js';
import { templateDetail } from '../lib/clientTemplates.js';
import { writeStudioDraft, takeStudioDraft } from '../app/veyrnox/_lib/landingDraft.js';
import { templateArrival } from '../app/veyrnox/_lib/templateDraft.js';
const page = 'app/veyrnox/presets/[id]/page.js';
const recipe = 'app/veyrnox/_components/TemplateRecipe.js';
const framing = 'lib/templateFraming.js';
// Snapshots of the base-commit (aba3757e9) sources, so the comparison needs no git history (CI clones shallow).
const base = path => readFileSync(new URL(`./fixtures/template-base-sources/${path.replaceAll('/', '_')}.txt`, import.meta.url), 'utf8');

test('repository source routing uses the shared route; only catalog readers may resolve legacy labels', () => {
  const allow = new Map([
    ['app/veyrnox/_lib/tokens.js', 'central route fallback and legacy price comparison'],
    ['scripts/audit-template-fidelity.mjs', 'audit determines the original catalog model before binding'],
  ]);
  const displayReaders = new Set([
    'lib/clientTemplates.js', 'app/veyrnox/presets/[id]/page.js',
    'app/veyrnox/_components/TemplateArtwork.js', 'app/veyrnox/_components/film/FilmWorkspace.js',
    'app/veyrnox/_components/PresetGallery.js', 'app/veyrnox/_sections/showcase.js',
    'app/veyrnox/_components/PresetCard.js', 'app/veyrnox/_lib/filmTemplateDraft.js',
    'app/veyrnox/_lib/templates.js',
  ]); // Catalog metadata, display labels, search facets and descriptive Film drafts only.
  // git, not ripgrep: the test must not depend on a tool that is missing from CI or a developer shell.
  const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '--', '*.js', '*.jsx', '*.mjs', '*.ts', '*.tsx'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).trim().split('\n').filter(f => f && !f.startsWith('node_modules/') && !f.includes('/node_modules/'));
  const offenders = [];
  for (const file of files) {
    if (/(^|\/)(tests|__tests__|fixtures)\/|\.(test|spec)\./.test(file) || allow.has(file)) continue;
    const text = readFileSync(file, 'utf8');
    if (!text.includes('modelIdForName') && !/(?:preset|template)\??\.model\b/.test(text)) continue;
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
    const visit = node => {
      if (ts.isPropertyAccessExpression(node) && node.name.text === 'model' && /^(preset|template)$/.test(node.expression.getText(source)) && !displayReaders.has(file)) offenders.push(file);
      if (ts.isCallExpression(node) && /modelIdForName$/.test(node.expression.getText(source)) && node.arguments.some(arg => /(?:\?\.|\.)model\b|\[['"]model['"]\]/.test(arg.getText(source)))) offenders.push(file);
      ts.forEachChild(node, visit);
    }; visit(source);
  }
  assert.deepEqual([...new Set(offenders)], []);
  for (const path of allow.keys()) assert.match(readFileSync(path, 'utf8'), /modelIdForName/);
});

test('Create arrival restores an edited bound-model draft without a model URL parameter', () => {
  const preset = PRESETS.find(p => templateContract(p.id)?.class === 'bound' && p.model === 'Kling 3.0 · I2V');
  const source = readFileSync('app/veyrnox/app/create/page.js', 'utf8');
  const requestedExpression = source.match(/const requested = (.*);/)[1];
  const params = new URLSearchParams({ preset: preset.id });
  const requested = new Function('params', 'preset', 'templateModelId', `return ${requestedExpression}`)(params, preset, templateModelId);
  const values = new Map();
  const storage = { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
  const prompt = 'Edited draft: keep these exact words.  ';
  assert.equal(writeStudioDraft(storage, { prompt, model: 'seedance-2.0-reference', templateId: preset.id }), true);
  const draft = takeStudioDraft(storage, requested, Date.now(), preset.id);
  const arrival = templateArrival(preset, MODELS, params, draft);
  assert.equal(requested, 'seedance-2.0-reference');
  assert.equal(arrival.modelId, requested);
  assert.equal(arrival.draft.prompt, prompt);
});

test('detail runnable verdict and /api/templates detail agree for every bound template', async () => {
  const f = fixture('en', '/presets/on-the-wave', { moduleMocks: { '../../_components/TemplateRecipe': { TemplateRecipe: () => null } } });
  const Page = f.load(page).default;
  for (const preset of PRESETS.filter(p => templateContract(p.id)?.class === 'bound')) {
    const tree = await Page({ params: Promise.resolve({ id: preset.id }) });
    let actual;
    const visit = node => { if (!React.isValidElement(node)) return; if (node.props.preset?.id === preset.id && 'sourcePromptRunnable' in node.props.preset) actual = node.props.preset; React.Children.forEach(node.props.children, visit); };
    visit(tree);
    assert.equal(actual.sourcePromptRunnable, templateDetail(preset.id).sourcePromptRunnable, preset.id);
  }
});

// Compare the static recipe/detail against base with the same interactive controls
// on both sides: picker availability and hints have their own F3/F5 render tests.
const controls = { '../_components/UseTemplate': { UseTemplate: () => null }, './UseTemplate': { UseTemplate: () => null } };
test('all non-bound non-blocked recipe/detail markup is byte-identical to base', async () => {
  const old = fixture('en', '/presets', { sourceOverrides: { [page]: base(page), [recipe]: base(recipe), [framing]: base(framing), 'app/veyrnox/_components/UseTemplate.js': base('app/veyrnox/_components/UseTemplate.js') } });
  const now = fixture('en', '/presets');
  const checked = [];
  for (const preset of PRESETS.filter(p => !['bound', 'blocked-needs-video'].includes(templateContract(p.id)?.class))) {
    assert.equal(now.render(React.createElement(now.load(recipe).TemplateRecipe, { preset })), old.render(React.createElement(old.load(recipe).TemplateRecipe, { preset })), `${preset.id}: recipe`);
    const params = Promise.resolve({ id: preset.id });
    assert.equal(now.render(await now.load(page).default({ params })), old.render(await old.load(page).default({ params })), `${preset.id}: detail`);
    checked.push(preset.id);
  }
  assert.ok(checked.filter(id => templateContract(id)?.class === 'like-for-like-safe').length >= 3);
  writeFileSync('.gstack/a2-round3/nonbound-markup-ids.json', JSON.stringify(checked, null, 2) + '\n');
});
const normalize = html => html.replace(/<a href="\/models\/[^\"]+" class="font-bold underline underline-offset-4">[^<]+<\/a>/g, '<model-link/>');
test('bound detail differs only in model link/name and reviewed crop guidance; lists every changed id', async () => {
  const old = fixture('en', '/presets', { moduleMocks: controls, sourceOverrides: { [page]: base(page), [framing]: base(framing) } });
  const now = fixture('en', '/presets', { moduleMocks: controls });
  const changed = [], cropChanges = [];
  for (const preset of PRESETS.filter(p => templateContract(p.id)?.class === 'bound')) {
    const params = Promise.resolve({ id: preset.id });
    const before = old.render(await old.load(page).default({ params }));
    const after = now.render(await now.load(page).default({ params }));
    if (before !== after) changed.push(preset.id);
    let expected = normalize(before);
    if (!preset.sourceAspect && old.load(framing).templateSourceAspect(preset) && !templateSourceAspect(preset)) {
      cropChanges.push(preset.id);
      expected = expected.replace(/<div class="mt-4 rounded-xl border border-vx-border px-4 py-3 text-\[14px\] text-vx-fg-body"><p>(.*?)<\/p><p class="mt-2 font-bold">[^<]+<\/p><\/div>/s, '<p class="mt-4 rounded-xl border border-vx-border px-4 py-3 text-[14px] text-vx-fg-body">$1</p>');
    }
    assert.equal(normalize(after), expected, preset.id);
    assert.match(after, /href="\/models\/seedance-2.0-reference"[^>]*>Seedance 2.0 · Reference<\/a>/);
  }
  assert.deepEqual(cropChanges, ['curtain-reveal']);
  assert.deepEqual(changed, PRESETS.filter(p => templateContract(p.id)?.class === 'bound' && p.model !== 'Seedance 2.0 · Reference').map(p => p.id));
  writeFileSync('.gstack/a2-round3/bound-markup-changes.json', JSON.stringify({ changed, cropChanges }, null, 2) + '\n');
});
