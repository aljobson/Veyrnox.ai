import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { publicTemplateClip, isTemplateClipModel } from '../app/veyrnox/_lib/templateClips.js';
import { publicCapabilities, capabilityFor } from '../lib/modelCapabilities.js';
import { submitTemplate, templateRun } from '../app/veyrnox/_lib/templateGenerate.js';
import { allocationSnapshot } from '../app/veyrnox/_lib/imageBatch.js';
import { presetHref } from '../app/veyrnox/_lib/tokens.js';
import { catalog, kieCatalog, kieSource, manifest, id } from './fixtures/templateClips.mjs';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
function load(path, imports = {}) {
  const compiled = { exports: {} };
  const result = ts.transpileModule(read(path), { fileName: path, compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX }, reportDiagnostics: true });
  assert.deepEqual(result.diagnostics.filter(d => d.category === ts.DiagnosticCategory.Error), []);
  new Function('require', 'module', 'exports', result.outputText)(name => imports[name] ?? {}, compiled, compiled.exports);
  return compiled.exports;
}
const clip = { id, model: catalog[0].id, credits: 85, durationSeconds: 5 };
const photo = { slot: 'image', origin: 'asset', asset_id: '11111111-1111-4111-8111-111111111111' };
for (const selected of [clip, { ...clip, model: kieCatalog.id, credits: 70 }]) test(`web submits ${selected.model}` + ' one photo with template identity and catalog quote; ordinary body stays unchanged', async () => {
  const sent = [], makeKey = () => 'template-client-proof';
  const run = templateRun(null, 'identity', 85, makeKey);
  const quote = allocationSnapshot(run, 85, 0);
  const deps = { sources: async () => ({ references: [photo] }), gatewayFetch: async (_url, init) => { sent.push(JSON.parse(init.body)); return { job_id: 'job' }; }, onJob() {} };
  const base = { run, quote, model: { id: clip.model }, preset: { id }, inputs: { duration_seconds: 5 }, makeKey, deps };
  assert.equal((await submitTemplate({ ...base, templateClip: selected })).error, null);
  assert.equal(sent[0].template_clip, id); assert.equal(sent[0].model_id, selected.model);
  assert.deepEqual(sent[0].references, [photo]); assert.equal(sent[0].consent, true); assert.equal(sent[0].max_charge_credits, 85);
  await submitTemplate({ ...base, run: templateRun(null, 'ordinary', 85, makeKey) });
  assert.equal(Object.hasOwn(sent[1], 'template_clip'), false);
  assert.doesNotMatch(presetHref({ id }, 5, { templateClip: clip }), /\/create/);
});

for (const clip of [{ id, model: catalog[0].id, credits: 85, durationSeconds: 5 }, { id, model: kieCatalog.id, credits: 70, durationSeconds: 5 }]) test(`mobile request carries ${clip.model}`,  async () => {
  const { templateClipModel } = load('apps/mobile/src/lib/templateClips.ts');
  const model = templateClipModel({ ...catalog[0], credits: 1, durations: [5, 10], capabilities: publicCapabilities(capabilityFor(catalog[0].provider_endpoint)) }, clip);
  assert.deepEqual(model.durations, [5]); assert.equal(model.credits, clip.credits);
  assert.deepEqual(Object.keys(model.capabilities.media), ['image']); assert.equal(model.capabilities.media.image.maxFiles, 1);
  const { templateRequest } = load('apps/mobile/src/lib/templateGenerate.ts');
  const request = templateRequest({ id }, model, { prompt: 'community text', templateClip: id, references: [photo] });
  assert.equal(request.templateClip, id); assert.equal(request.modelId, clip.model); assert.equal(request.durationSeconds, 5); assert.equal(request.prompt, '');
  let wire;
  const { mediaApi } = load('apps/mobile/src/lib/media.ts', {
    './network': { ensureOnline: async () => {} }, './aiConsentStore': { aiConsent: { ensure: async () => {}, hasAgreed: async () => true } },
    './celebrate': { noteLocalSubmission() {} }, './generationProgress': { noteJobStarted() {} }, './analytics/generations': { noteGenerationSubmitted: async () => {} },
  });
  await mediaApi({ request: async (_path, init) => { wire = JSON.parse(init.body); return { job_id: 'job' }; } }).createGeneration({ ...request, idempotencyKey: 'mobile-proof' });
  assert.equal(wire.model_id, clip.model); assert.equal(wire.template_clip, id); assert.deepEqual(wire.references, [photo]); assert.equal(wire.consent, true);
  assert.equal(wire.inputs.duration_seconds, 5);
});

test('availability failures and unregistered IDs keep mobile in the original mode', async t => {
  const { fetchTemplateClip } = load('apps/mobile/src/lib/templateClips.ts', { '../../../../app/veyrnox/_lib/templateClips.js': { publicTemplateClip, isTemplateClipModel }, './api': { API_BASE: 'https://fixture.test' } });
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => { calls++; return Response.json({ error: 'template_clip_not_found' }, { status: 404 }); });
  assert.equal(await fetchTemplateClip('unregistered'), null); assert.equal(calls, 0);
  assert.equal(await fetchTemplateClip(id), null); assert.equal(calls, 1);
});

test('both pages hide unsupported Create handoffs in clip mode and preserve warning and exact prompt', () => {
  const web = read('app/veyrnox/_components/UseTemplate.js'), mobile = read('apps/mobile/src/app/(app)/templates/[id].tsx');
  assert.match(web, /!templateClip && <button[\s\S]*onClick=\{use\}/);
  // Film handoff requires a video recipe as well as the absence of clip mode.
  assert.match(web, /!templateClip && isVideo && <div[\s\S]*onClick=\{buildFilm\}/);
  assert.match(mobile, /!templateClip && <Button[^>]*editBeforeGenerating/);
  for (const source of [web, mobile]) assert.match(source, /app\.create\.referenceLikenessNotice/);
  for (const source of [read('app/veyrnox/_components/TemplateRecipe.js'), mobile]) assert.match(source, /public\.TemplateRecipe\.exactCommunityPrompt/);
  const submit = load('apps/mobile/src/lib/generationSubmit.ts');
  assert.notEqual(submit.generationSignature({ templateClip: id }, 1), submit.generationSignature({ templateClip: 'changed' }, 1));
});

for (const row of [catalog[0], kieCatalog]) test(`public catalog, help, MCP, Create and mobile hide ${row.provider} video`, async () => {
  const { toPublicModels } = await import('../lib/publicCatalog.js');
  const { liveCatalogContext } = await import('../lib/helpAssistant.js');
  const { modelListing } = await import('../lib/mcpListings.js');
  const { startMcpVideo } = await import('../lib/mcpVideo.js');
  const { planAttachments, attachCapacity } = await import('../lib/createAttach.mjs');
  const [model] = toPublicModels([row]);
  assert.deepEqual(Object.keys(model.capabilities.media), ['image']);
  assert.doesNotMatch(JSON.stringify(model), /video_urls|serverOnly|Template clip/);
  assert.match(liveCatalogContext([model]), /SOURCE MEDIA: image/);
  assert.doesNotMatch(liveCatalogContext([model]), /SOURCE MEDIA:.*video/);
  assert.deepEqual(modelListing(model).source_slots, ['image']);
  const uiModel = { ...model, media: model.capabilities.media };
  assert.equal(attachCapacity(uiModel).video, 0);
  assert.equal(planAttachments([uiModel], uiModel, [{ type: 'video/mp4', name: 'clip.mp4' }]), null);
  const { slotsFor } = load('apps/mobile/src/lib/sources.ts', { './i18n': { t: key => key } });
  assert.deepEqual(slotsFor(model).map(slot => slot.slot), ['image']);
  const refused = await startMcpVideo({ model_id: model.id, consent: true, source_assets: [{ slot: 'video', asset_id: photo.asset_id }] }, {
    findModel: async () => model, createGeneration: () => assert.fail('private slot reached generation'),
  });
  assert.equal(refused.status, 400);
});

test('registered-only web availability silently handles a flag-off 404', async t => {
  const effects = [], states = []; let calls = 0;
  const { useTemplateClipAvailable } = load('app/veyrnox/_lib/useTemplateClipAvailable.js', {
    react: { useState: () => [null, value => states.push(value)], useEffect: effect => effects.push(effect) },
    './templateClips.js': { publicTemplateClip, isTemplateClipModel },
  });
  const logged = []; // Node's own warnings (e.g. typeless package) also reach console.error in CI, so only a 404 report counts
  t.mock.method(console, 'error', (...args) => { logged.push(args.map(String).join(' ')); });
  t.mock.method(globalThis, 'fetch', async () => { calls++; return Response.json({ error: 'template_clip_not_found' }, { status: 404 }); });
  assert.equal(useTemplateClipAvailable('unregistered'), null); effects.shift()(); assert.equal(calls, 0);
  assert.equal(useTemplateClipAvailable(id), null); effects.shift()();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls, 1); assert.deepEqual(states, [null]);
  assert.deepEqual(logged.filter(line => /template_clip|404|catalog/.test(line)), []);
});

test('clip prompts remain exact and read-only beside existing help and the clip explanation', () => {
  const web = read('app/veyrnox/_components/TemplateRecipe.js'), mobile = read('apps/mobile/src/app/(app)/templates/[id].tsx');
  assert.match(web, /value=\{displayPrompt\} readOnly=\{templateClip \? true : undefined\}/);
  assert.match(mobile, /value=\{displayPrompt\} editable=\{templateClip \? false : undefined\}/);
  for (const source of [web, mobile]) {
    assert.match(source, /displayPrompt = templateClip[\s\S]*hasExactSourcePrompt \? preset.sourcePrompt/);
    assert.match(source, /exactCommunityPromptHelp[\s\S]*templateClipUsed/);
    assert.doesNotMatch(source, /!templateClip[^\n]*exactCommunityPromptHelp/);
  }
});

test('web and mobile readers accept kie-only availability and reject unknown models', async t => {
  const effects = [], states = [];
  const shared = { publicTemplateClip, isTemplateClipModel };
  const web = load('app/veyrnox/_lib/useTemplateClipAvailable.js', {
    react: { useState: () => [null, value => states.push(value)], useEffect: effect => effects.push(effect) }, './templateClips.js': shared,
  });
  const mobile = load('apps/mobile/src/lib/templateClips.ts', {
    '../../../../app/veyrnox/_lib/templateClips.js': shared, './api': { API_BASE: 'https://fixture.test' },
  });
  for (const model of [kieCatalog.id, 'untrusted']) {
    const response = { id, model, credits: 70, durationSeconds: 5 };
    t.mock.method(globalThis, 'fetch', async () => Response.json(response));
    web.useTemplateClipAvailable(id); effects.shift()(); await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(states.at(-1), model === kieCatalog.id ? response : null);
    assert.deepEqual(await mobile.fetchTemplateClip(id), model === kieCatalog.id ? response : null);
  }
});

test('fal-era kie manifest keeps web and mobile clip UI off; complete metadata enables their projection', async t => {
  const { loadTemplateClip } = await import('../lib/templateClipGate.js');
  for (const source of [manifest[id], kieSource]) {
    const projection = await loadTemplateClip(id, {}, { env: { TEMPLATE_CLIP_ENABLED: 'true' }, manifest: { [id]: source }, read: async () => [kieCatalog] });
    t.mock.method(globalThis, 'fetch', async () => projection
      ? Response.json(projection.template) : Response.json({ error: 'template_clip_not_found' }, { status: 404 }));
    for (const path of ['app/veyrnox/_lib/useTemplateClipAvailable.js', 'apps/mobile/src/lib/templateClips.ts']) {
      let state = null;
      const effects = [], shared = { publicTemplateClip, isTemplateClipModel };
      const client = load(path, { react: { useState: () => [state, value => { state = value; }], useEffect: effect => effects.push(effect) },
        './templateClips.js': shared, '../../../../app/veyrnox/_lib/templateClips.js': shared, './api': { API_BASE: 'https://fixture.test' } });
      assert.equal(client.useTemplateClipAvailable(id), null);
      effects.shift()(); await new Promise(resolve => setImmediate(resolve));
      assert.deepEqual(client.useTemplateClipAvailable(id), source === kieSource ? projection.template : null);
    }
  }
});
