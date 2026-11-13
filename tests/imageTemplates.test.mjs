import test from 'node:test';
import { ornament, ornamentModel } from './helpers/imageTemplatePhoto.mjs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';
import * as React from 'react';
import { fixture } from './helpers/publicSiteRender.mjs';
import { IMAGE_TEMPLATES, imageTemplatesEnabled } from '../app/veyrnox/_lib/imageTemplates.js';
import { IMAGE_SOURCE_PROMPT_RECORDS } from '../app/veyrnox/_lib/imageSourcePromptRecords.js';
import { IMAGE_TEMPLATE_MODELS } from '../app/veyrnox/_lib/imageTemplateModels.js';
import { ALL_TEMPLATES, PRESETS, galleryTemplates, galleryCategories, templateById, templatesIn, hasTemplateVideo } from '../app/veyrnox/_lib/templates.js';
import { SOURCE_TEMPLATES } from '../app/veyrnox/_lib/sourceTemplates.js';
import { templateCards, templateDetail, searchTemplateIds } from '../lib/clientTemplates.js';
import { toPublicPresets } from '../lib/publicPresets.js';
import { templateModelId, presetCredits } from '../app/veyrnox/_lib/tokens.js';
import { draftForTemplate, templateArrival } from '../app/veyrnox/_lib/templateDraft.js';
import { templateContract } from '../lib/templateClientContract.js';
import { templateInputs, submitTemplate, templateRun } from '../app/veyrnox/_lib/templateGenerate.js';
import { fromFallback } from '../app/veyrnox/_lib/useCatalog.js';
import { templateRecipe } from '../app/veyrnox/_lib/templateRecipe.js';
import { isUnknownStaticPage } from '../lib/unknownStaticPage.js';

register('data:text/javascript,' + encodeURIComponent(`export async function resolve(s,c,next) { return next(s === 'next/server' ? 'next/server.js' : s,c); }`));
const list = await import('../app/api/templates/route.js');
const one = await import('../app/api/templates/[id]/route.js');
const ids = new Set(IMAGE_TEMPLATES.map(p => p.id));
const models = fromFallback().filter(model => IMAGE_TEMPLATE_MODELS.includes(model.id)).map(model => ({ ...model, modality: 'text-to-image', credits: 37 }));
models.push(ornamentModel);
const nodes = tree => Array.isArray(tree) ? tree.flatMap(nodes) : tree && typeof tree === 'object' ? [tree, ...nodes(tree.props?.children)] : [];
async function withFlag(value, fn) {
  const previous = process.env.IMAGE_TEMPLATES_ENABLED;
  if (value === undefined) delete process.env.IMAGE_TEMPLATES_ENABLED;
  else process.env.IMAGE_TEMPLATES_ENABLED = value;
  try { return await fn(); } finally {
    if (previous === undefined) delete process.env.IMAGE_TEMPLATES_ENABLED;
    else process.env.IMAGE_TEMPLATES_ENABLED = previous;
  }
}

test('fifty image records, forty-eight authored and two hash-locked captures', () => {
  assert.equal(IMAGE_TEMPLATES.length, 50);
  assert.equal(ids.size, 50);
  assert.equal(IMAGE_TEMPLATES.filter(p => p.promptOrigin === 'original').length, 48);
  for (const p of IMAGE_TEMPLATES) {
    assert.equal(p.kind, 'image');
    assert.equal(p.category, 'CHRISTMAS');
    assert.ok(IMAGE_TEMPLATE_MODELS.includes(p.model));
    assert.ok(p.prompt.length > 100);
    assert.match(p.previewImage, /^\/showcase\/christmas\/[a-z-]+\.webp$/);
    assert.match(p.bg, /gradient/);
    for (const key of ['clipKey', 'durationSeconds', 'credits', 'needs']) assert.equal(key in p, false, `${p.id}: ${key}`);
    assert.equal(hasTemplateVideo(p), false);
    assert.equal(SOURCE_TEMPLATES.some(t => t.id === p.id), false);
    assert.equal(ALL_TEMPLATES.some(t => t.id === p.id), false);
    assert.equal(PRESETS.some(t => t.id === p.id), false);
    assert.doesNotMatch(p.prompt, /@image|uploaded|reference photo|Disney|Pixar|Marvel|Coca-Cola|Taylor Swift/i);
  }
  const captured = IMAGE_SOURCE_PROMPT_RECORDS['flying-elf'];
  const hash = '8adc8eaedc6089dd5703d4a5a99b104c568436299b1d8388aa78c9a53e8c20ab';
  assert.equal(captured.promptSha256, hash);
  assert.equal(createHash('sha256').update(captured.prompt, 'utf8').digest('hex'), hash);
  assert.equal(IMAGE_TEMPLATES[0].prompt, captured.prompt);
  assert.equal(captured.sourceRecordId, '01a011a9-b028-7328-8f39-4eca02bd4ec4');
  assert.equal(captured.sourceModel, 'banana2');
});

test('all 50 image recipes have unique public ids and names, supported aspects and no duration', async () => {
  const { assertAvailablePublicIds } = await import('../scripts/lib/template-public-id.mjs');
  assert.equal(IMAGE_TEMPLATES.length, 50);
  assert.equal(new Set(IMAGE_TEMPLATES.map(p => p.name)).size, 50);
  // Exclude only these image records from reservations; retain videos and public renames.
  assert.doesNotThrow(() => assertAvailablePublicIds([...ids], [...ids]));
  for (const template of IMAGE_TEMPLATES) {
    assert.equal(template.name, template.name.toUpperCase());
    const model = models.find(model => model.id === templateModelId(template));
    assert.equal(model.kind, 'image', template.id);
    assert.ok(model.aspects?.includes(template.aspect), `${template.id}: supported aspect`);
    if (template.photo) assert.deepEqual(model.media, { image: { required: true, maxFiles: 1 } });
    else assert.deepEqual(model.media, {}, `${template.id}: no reference media`);
    const draft = draftForTemplate(template, model.id);
    assert.equal('durationSeconds' in draft, false, template.id);
    assert.equal('durationSeconds' in template, false, template.id);
  }
});

test('publication gate controls list, search, detail, categories and hard 404 in the same process', async () => {
  for (const flag of [undefined, 'false', 'TRUE', '1', 'true', 'false']) await withFlag(flag, async () => {
    const enabled = flag === 'true';
    assert.equal(imageTemplatesEnabled(), enabled);
    const response = await list.GET(new Request('https://example.test/api/templates'));
    const body = await response.json();
    assert.equal(body.templates.filter(t => ids.has(t.id)).length, enabled ? 50 : 0);
    assert.equal(body.categories.includes('CHRISTMAS'), enabled);
    const search = await list.GET(new Request('https://example.test/api/templates?q=CHRISTMAS'));
    assert.equal((await search.json()).ids.filter(id => ids.has(id)).length, enabled ? 50 : 0);
    for (const p of IMAGE_TEMPLATES) {
      assert.equal(Boolean(templateById(p.id)), enabled);
      assert.equal(Boolean(templateDetail(p.id)), enabled);
      assert.equal(searchTemplateIds(p.id.replaceAll('-', ' ')).includes(p.id), enabled);
      const res = await one.GET(null, { params: Promise.resolve({ id: p.id }) });
      assert.equal(res.status, enabled ? 200 : 404);
      assert.equal(isUnknownStaticPage(`/presets/${p.id}`), !enabled);
      assert.equal(isUnknownStaticPage(`/veyrnox/presets/${p.id}`), !enabled);
    }
    for (const category of galleryCategories().filter(c => !['ALL', 'NEW'].includes(c))) assert.ok(templatesIn(category).length >= 10, category);
    assert.equal(toPublicPresets(models, galleryTemplates()).some(p => ids.has(p.id)), false);
    assert.deepEqual(toPublicPresets(models, IMAGE_TEMPLATES), []);
  });
  // Production turns the gate on (owner, 2026-11-13): the line exists only as the exact string "true".
  assert.match(readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8'), /^\s*"IMAGE_TEMPLATES_ENABLED": "true",$/m);
});

test('image cards are additive, have no video key and price only from the catalog', async () => withFlag('true', () => {
  for (const p of IMAGE_TEMPLATES) {
    const card = templateCards().find(c => c.id === p.id);
    assert.equal(card.kind, 'image');
    assert.equal(card.previewImage, p.previewImage);
    assert.deepEqual(card.photo, p.photo);
    assert.equal(card.durationSeconds, null);
    assert.equal('clipKey' in card, false);
    assert.equal('prompt' in card, false);
    assert.equal(presetCredits(card, models, 10), 37);
    assert.equal(presetCredits(card, []), null);
    assert.equal(templateDetail(p.id).modelId, p.model);
    assert.equal('fidelity' in templateDetail(p.id), false);
  }
}));

test('image drafts and generation stay in image modality without routing or duration', async () => {
  for (const p of IMAGE_TEMPLATES) {
    const model = models.find(m => m.id === p.model);
    assert.equal(templateModelId(p), p.model);
    assert.equal(templateModelId({ ...p, model: 'Seedance 2.0' }), null);
    assert.equal(templateContract(p), null);
    const draft = draftForTemplate(p, p.model);
    assert.equal(draft.prompt, p.prompt);
    assert.equal(draft.aspect, p.aspect);
    assert.equal('durationSeconds' in draft, false);
    const arrival = templateArrival(p, [...models, { id: 'video', modality: 'text-to-video', kind: 'video' }], new URLSearchParams('model=video&duration=10s'), { templateId: p.id, durationSeconds: 10 });
    assert.equal(arrival.modelId, p.model);
    assert.equal('durationSeconds' in arrival.draft, false);
    const inputs = templateInputs(p, model, { prompt: p.prompt, aspect: p.aspect, aspectOptions: model.aspects, durationSeconds: 10, withPhoto: Boolean(p.photo) });
    let sent;
    await submitTemplate({ run: templateRun(null, p.id, 37, () => 'test-key'), quote: { ceilings: [37] }, model, preset: p, inputs, makeKey: () => 'test-key', deps: {
      sources: p.photo ? async () => ({ references: [{ slot: 'image', origin: 'upload', key: 'test-photo' }] }) : null,
      gatewayFetch: async (_, options) => { sent = JSON.parse(options.body); return { job_id: 'fake' }; }, onJob() {},
    } });
    assert.equal(sent.model_id, p.model);
    assert.equal('duration_seconds' in sent.inputs, false);
    assert.equal('durationSeconds' in sent.inputs, false);
    assert.equal(sent.inputs.prompt, p.prompt);
    assert.equal(sent.template_id, undefined);
    assert.equal(sent.preset, undefined);
    assert.equal(sent.references.length, p.photo ? 1 : 0);
  }
});

function pageFixture(onConnection = () => {}) {
  return fixture('en', '/presets/flying-elf', { moduleMocks: {
    'next/server': { connection: async () => onConnection() },
    'next/navigation': { notFound() { throw Error('NOT_FOUND'); }, permanentRedirect() { throw Error('REDIRECT'); } },
    '../../_components/TemplateRecipe': { TemplateRecipe: () => null },
    '../../_components/TemplateImage': { TemplateImage: () => null },
    '../lib/publicCatalog.js': { readPublicCatalog: async () => [] },
    './veyrnox/_lib/modelPages': { listModelsForDetails: async () => [], shelfModels: () => [] },
  } });
}

test('actual detail static params, notFound and sitemap follow both gate states', async () => {
  const f = pageFixture();
  const page = f.load('app/veyrnox/presets/[id]/page.js');
  const sitemapModule = f.load('app/sitemap.js');
  assert.equal(sitemapModule.dynamic, 'force-dynamic');
  const sitemap = sitemapModule.default;
  for (const flag of ['false', 'true', 'false']) await withFlag(flag, async () => {
    const enabled = flag === 'true';
    const params = page.generateStaticParams();
    const urls = (await sitemap()).map(row => row.url);
    assert.deepEqual(urls.filter(url => PRESETS.some(p => url.endsWith(`/presets/${p.id}`))).map(url => url.split('/').pop()).sort(), PRESETS.map(p => p.id).sort());
    for (const p of IMAGE_TEMPLATES) {
      assert.equal(params.some(row => row.id === p.id), false, 'images are request-only in both gate states');
      assert.equal(urls.some(url => url.endsWith(`/presets/${p.id}`)), enabled);
      if (!enabled) await assert.rejects(page.default({ params: Promise.resolve({ id: p.id }) }), /NOT_FOUND/);
    }
  });
});

test('only image detail lookup crosses the explicit request boundary; video static params remain intact', async () => {
  let requests = 0;
  const f = pageFixture(() => { requests++; });
  const page = f.load('app/veyrnox/presets/[id]/page.js');
  assert.equal(page.dynamic, undefined);
  assert.deepEqual(page.generateStaticParams(), ALL_TEMPLATES.map(p => ({ id: p.id })));
  await page.generateMetadata({ params: Promise.resolve({ id: PRESETS[0].id }) });
  assert.equal(requests, 0);
  for (const flag of ['true', undefined, 'true']) await withFlag(flag, async () => {
    const params = Promise.resolve({ id: IMAGE_TEMPLATES[0].id });
    if (flag === 'true') await page.default({ params });
    else await assert.rejects(page.default({ params }), /NOT_FOUND/);
  });
  assert.equal(requests, 3);
});

test('actual detail recipes render original provenance and the exact Flying Elf audit', async () => withFlag('true', async () => {
  const f = pageFixture();
  const page = f.load('app/veyrnox/presets/[id]/page.js');
  const recipeFixture = fixture('en', '/', { moduleMocks: {
    './UseTemplate': { UseTemplate: () => null },
    '../_lib/useTemplateClipAvailable': { useTemplateClipAvailable: () => null },
    '../_lib/useSwapSceneAvailable': { useSwapSceneAvailable: () => false },
  } });
  const { TemplateRecipe } = recipeFixture.load('app/veyrnox/_components/TemplateRecipe.js');
  for (const p of IMAGE_TEMPLATES.slice(0, 2)) {
    const tree = await page.default({ params: Promise.resolve({ id: p.id }) });
    const recipe = nodes(tree).find(node => node.props && 'generatedPreview' in node.props)?.props.preset;
    assert.deepEqual(recipe, templateRecipe(p));
    const html = recipeFixture.render(React.createElement(TemplateRecipe, { preset: recipe }));
    assert.doesNotMatch(html, /data-source-prompt-status="adaptation-only"|Veyrnox adaptation of an uncaptured source/);
    if (p.promptOrigin === 'original') {
      assert.equal(recipe.promptOrigin, 'original');
      assert.equal('sourcePromptStatus' in recipe, false);
      assert.doesNotMatch(html, /Exact community prompt/i);
    } else {
      assert.equal(recipe.sourcePrompt, p.prompt);
      assert.equal(recipe.sourcePromptRunnable, true);
      assert.match(html, /Exact community prompt/i);
    }
  }
}));

test('missing preview art keeps the gradient and removes the broken image', () => {
  let failed = null;
  const f = fixture('en', '/', { moduleMocks: { '../../../components/I18nProvider.jsx': { useI18n: () => ({ t: key => key }) }, react: { ...React, useState: () => [failed, value => { failed = value; }] } } });
  const { TemplateImage } = f.load('app/veyrnox/_components/TemplateImage.js');
  const preset = IMAGE_TEMPLATES[0];
  let tree = TemplateImage({ preset });
  assert.equal(tree.props.style.background, preset.bg);
  nodes(tree).find(node => node.type === 'img').props.onError();
  tree = TemplateImage({ preset });
  assert.equal(nodes(tree).some(node => node.type === 'img'), false);
  assert.equal(tree.props.style.background, preset.bg);
});

test('the rendered image card and picker use the real resolver and catalog price', () => {
  const chosen = IMAGE_TEMPLATES[1];
  let picked;
  const f = fixture('en', '/', { moduleMocks: {
    react: { ...React, useState: initial => [initial, () => {}], useMemo: fn => fn(), useRef: initial => ({ current: initial }) },
    '../../../components/I18nProvider.jsx': { useI18n: () => ({ t: key => key }) },
    '../../../components/I18nProvider': { useI18n: () => ({ t: key => key }) },
    '../_lib/useTemplates': { useTemplateCards: () => ({ templates: IMAGE_TEMPLATES }), useTemplateSearch: rows => rows },
  } });
  const { TemplatePicker } = f.load('app/veyrnox/_components/TemplatePicker.js');
  const tree = TemplatePicker({ models, goal: 'image', onPick: p => { picked = p; }, onClose() {} });
  const choices = nodes(tree).filter(node => node.props?.['data-testid']?.startsWith('create-template-') && node.type === 'button');
  assert.equal(choices.length, 50);
  choices.find(node => node.props['data-testid'] === `create-template-${chosen.id}`).props.onClick();
  assert.equal(picked.id, chosen.id);
  const { PresetCard } = f.load('app/veyrnox/_components/PresetCard.js');
  const card = PresetCard({ preset: chosen, catalog: models });
  assert.match(JSON.stringify(card.props.footer), /37/);
  assert.ok(nodes(card).some(node => node.props?.preset?.id === chosen.id));
});

test('image resolution and contracts never invoke video routing or fidelity lookup', () => {
  const forbidden = () => { throw Error('image entered video routing/fidelity'); };
  const f = fixture('en', '/', { moduleMocks: {
    '../../../lib/templateRoute.js': { templateRoute: forbidden },
    './templateRoute.js': { templateRouteContract: forbidden },
    './templateClientContractRuntime.js': { clientContractFor: forbidden },
  } });
  const tokens = f.load('app/veyrnox/_lib/tokens.js');
  const contracts = f.load('lib/templateClientContract.js');
  for (const p of IMAGE_TEMPLATES) {
    assert.equal(tokens.templateModelId(p), p.model);
    assert.equal(contracts.templateContract(p), null);
  }
});


test('video import collision checks reserve every image id even with publication off', async () => withFlag(undefined, async () => {
  const { assertAvailablePublicIds } = await import('../scripts/lib/template-public-id.mjs');
  for (const template of IMAGE_TEMPLATES) {
    assert.throws(() => assertAvailablePublicIds([template.id], []), /collision with another catalog or placement/, template.id);
  }
  assert.doesNotThrow(() => assertAvailablePublicIds(['unused-christmas-test-id'], []));
}));


test('ornament exact bytes, metadata, photo requirement and fallback absence are pinned independently', () => {
  const hash = '1082539cb0da501164497e48479807657804cd60042ed6902e00127ac4750129';
  const record = IMAGE_SOURCE_PROMPT_RECORDS['christmas-tree-ornament'];
  assert.equal(createHash('sha256').update(ornament.prompt, 'utf8').digest('hex'), hash);
  assert.equal(record.promptSha256, hash);
  assert.equal(ornament.prompt, record.prompt);
  assert.equal(record.sourceRecordId, '01a1cb5f-c1b3-7030-b572-c82fbba8b92c');
  assert.equal(record.sourceModel, 'banana');
  assert.equal(record.sourceGenerationSettings.model_type, 'banana-2.1');
  assert.equal(record.sourceAspect, '3:4');
  assert.deepEqual(ornament.photo, { required: true, count: 1 });
  assert.equal(ornament.model, 'nano-banana-pro-edit-grsai');
  assert.deepEqual(IMAGE_TEMPLATES.filter(p => p.promptOrigin === 'community-source-exact').map(p => p.id).sort(), ['christmas-tree-ornament', 'flying-elf']);
  assert.equal(IMAGE_TEMPLATES.some(p => p.id === 'pet-in-a-santa-hat'), false);
  assert.equal(fromFallback().some(m => m.id === ornament.model), false);
  assert.equal(presetCredits(ornament, fromFallback()), null);
});

test('photo artwork renders the requirement without any preview image', () => {
  const f = fixture('en', '/');
  const { TemplateImage } = f.load('app/veyrnox/_components/TemplateImage.js');
  const html = f.render(React.createElement(TemplateImage, { preset: ornament }));
  assert.match(html, /This template needs your photo/);
  assert.doesNotMatch(html, /<img/);
});
