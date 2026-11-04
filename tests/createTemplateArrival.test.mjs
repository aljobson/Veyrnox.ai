import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';
import * as templateDraft from '../app/veyrnox/_lib/templateDraft.js';
import * as templateMediaHandoff from '../app/veyrnox/_lib/templateMediaHandoff.js';
import * as landingDraft from '../app/veyrnox/_lib/landingDraft.js';
import * as tokens from '../app/veyrnox/_lib/tokens.js';
import * as generationSettings from '../app/veyrnox/_lib/generationSettings.js';
import * as imageBatch from '../app/veyrnox/_lib/imageBatch.js';
import * as freeAllowance from '../app/veyrnox/_lib/freeAllowance.js';
import * as promptBox from '../app/veyrnox/_lib/promptBox.js';
import * as generateHint from '../app/veyrnox/_lib/generateHint.js';
import * as generationSlots from '../lib/generationSourceSlots.mjs';
import * as aspectShapes from '../lib/aspectShapes.mjs';
import * as templateStart from '../lib/templateStartCheck.js';
import * as promptLimits from '../lib/generationPromptLimits.js';

const require = createRequire(import.meta.url);
const original = { id: 'kling-2.6-pro-kie', name: 'Kling 2.6 Pro', kind: 'video', modality: 'image-to-video', credits: 17, durations: [5, 10], aspects: ['16:9', '9:16'], takesNegative: true };
const other = { ...original, id: 'wan-2.5-kie', name: 'Wan 2.5', credits: 31, aspects: ['1:1', '4:5'] };
const preset = { id: 'exact-template', name: 'Exact template', model: original.name, prompt: 'Exact community prompt with reference images.', sourcePromptOrigin: 'community-source-exact', sourcePromptRunnable: false, aspect: '9:16', durationSeconds: 10, negativePrompt: 'No distortion' };
const source = readFileSync(new URL('../app/veyrnox/app/create/page.js', import.meta.url), 'utf8');
assert.match(source, /takeTemplateMediaHandoff\(window, preset\.id, wanted\)/);
assert.match(source, /previewUrl: URL\.createObjectURL\(file\)/);
const code = ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS } }).outputText;
const HandoffCard = () => null;
const SourcePickers = () => null;
function find(tree, predicate) {
  if (Array.isArray(tree)) return tree.map(node => find(node, predicate)).find(Boolean);
  if (!tree || typeof tree !== 'object') return undefined;
  return predicate(tree) ? tree : find(tree.props?.children, predicate);
}
const control = (tree, name) => find(tree, node => node.props?.assistantTarget === `create.${name}`);
const generate = tree => find(tree, node => node.props?.['data-assistant-target'] === 'create.generate');
const prompt = tree => find(tree, node => node.type === 'textarea');
// The explanation region is always mounted (a polite live region); empty text means there is nothing to fix.
const why = tree => String(find(tree, node => node.props?.id === 'vx-generate-why')?.props.children ?? '');
const card = tree => find(tree, node => node.type === HandoffCard);
const sourcePickers = tree => find(tree, node => node.type === SourcePickers);

// Execute the real page's hooks/effects and event handlers offline. Only I/O
// and unrelated child components are stubbed; recipe and submit logic is real.
function harness(params, { saved, handoff, blocked = false, models = [original, other], loading = false } = {}) {
  const values = new Map();
  const storage = { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
  if (saved) landingDraft.writeStudioDraft(storage, saved);
  const previousWindow = globalThis.window;
  globalThis.window = { location: { search: `?${new URLSearchParams({ preset: preset.id, ...params })}` },
    get sessionStorage() { if (blocked) throw Error('storage blocked'); return storage; },
    addEventListener() {}, removeEventListener() {},
  };
  if (handoff) templateMediaHandoff.writeTemplateMediaHandoff(globalThis.window, { templateId: preset.id, modelId: params.model || original.id, image: handoff });
  const slots = [], effects = [], requests = [];
  let cursor = 0, dirty = true, tree, catalog = { models, loading, live: !loading };
  const changed = (before, after) => !before || !after || before.length !== after.length || before.some((value, index) => !Object.is(value, after[index]));
  const react = {
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial;
      return [slots[index], value => { const next = typeof value === 'function' ? value(slots[index]) : value; if (!Object.is(slots[index], next)) { slots[index] = next; dirty = true; } }];
    },
    useRef(initial) { const index = cursor++; return slots[index] ??= { current: initial }; },
    useEffect(fn, deps) { const index = cursor++; if (changed(slots[index]?.deps, deps)) { effects.push(() => { slots[index]?.cleanup?.(); slots[index] = { deps, cleanup: fn() }; }); } },
    useCallback(fn, deps) { const index = cursor++; if (changed(slots[index]?.deps, deps)) slots[index] = { deps, fn }; return slots[index].fn; },
    useMemo(fn, deps) { const index = cursor++; if (changed(slots[index]?.deps, deps)) slots[index] = { deps, value: fn() }; return slots[index].value; },
    useSyncExternalStore: () => false,
  };
  const stubs = {
    react,
    '../../../../lib/i18n/locales.mjs': { localeTag: () => 'en-GB' },
    '../../../../components/I18nProvider': { useI18n: () => ({ t: (key, values) => values ? `${key}:${JSON.stringify(values)}` : key, locale: 'en' }) },
    '../../../../lib/i18n/translate.mjs': { tOr: (t, key, fallback) => fallback, pluralKey: (t, locale, key) => key },
    '../../../../lib/generationSourceSlots.mjs': generationSlots,
    '../../../../lib/generationPromptLimits.js': promptLimits,
    '../../../../lib/aspectShapes.mjs': aspectShapes,
    '../../../../lib/templateStartCheck': templateStart,
    '../../_lib/templateDraft': templateDraft,
    '../../_lib/templateMediaHandoff': templateMediaHandoff,
    '../../_lib/landingDraft': landingDraft,
    '../../_lib/tokens': tokens,
    '../../_lib/generationSettings': generationSettings,
    '../../_lib/imageBatch': imageBatch,
    '../../_lib/freeAllowance': freeAllowance,
    '../../_lib/promptBox': promptBox,
    '../../_lib/generateHint': generateHint,
    '../../_lib/useCatalog': { useCatalog: () => catalog },
    '../../_lib/useTemplates': { fetchTemplate: async () => preset },
    '../../_lib/useCreateDraftRecovery': { __esModule: true, default: () => ({ restoring: false, blocked: false }) },
    '../../_lib/useFreeAllowance': { useFreeAllowance: () => ({}) },
    '../../_lib/useStudioJobs': { useStudioJobs: () => ({ jobs: [], generating: false, startJobs() {}, addJob() {} }) },
    '../../_lib/starterModels': { starterModel: () => original, modelsForGoal: models => models },
    '../../_lib/modelTiers': { TIERS: [], filterByTier: models => models },
    '../../_lib/gateway': { gatewayFetch: async (path, options) => {
      if (path === '/balance') return { balance: 1000 };
      assert.equal(path, '/generations'); requests.push(JSON.parse(options.body)); return { job_id: 'test-job' };
    }, makeIdempotencyKey: () => 'test-key', notifyBalanceChanged() {}, GatewayError: class extends Error {} },
    '../../_lib/chatMedia': { mediaGenerationSources: async () => ({ references: [], source_keys: [], source_assets: [] }) },
    '../../_lib/veyJourneyStore': { getJourney: () => ({}), trackJourneyJob() {} },
    '../../_components/TemplateHandoffCard': { TemplateHandoffCard: HandoffCard },
    '../../_components/SourcePickers': { SourcePickers },
  };
  const output = { exports: {} };
  new Function('require', 'module', 'exports', code)(id => stubs[id] || (id === 'react/jsx-runtime' ? require(id) : new Proxy({}, { get: () => () => null })), output, output.exports);
  return {
    requests,
    async settle() {
      for (let i = 0; i < 20; i++) {
        if (dirty) { cursor = 0; dirty = false; tree = output.exports.default(); }
        while (effects.length) effects.shift()();
        await new Promise(resolve => setImmediate(resolve));
        if (!dirty && !effects.length) return tree;
      }
      throw Error('Page failed to settle');
    },
    catalogReady() { catalog = { models, live: true, loading: false }; dirty = true; },
    close() { for (const slot of slots) slot?.cleanup?.(); globalThis.window = previousWindow; },
  };
}

test('Create arrival applies URL recipe and submits original-model attribution only on the original model', async () => {
  for (const model of [original, other]) for (const durationSeconds of [5, 10]) for (const blocked of [false, true]) {
    const h = harness({ model: model.id, aspect: '4:5', duration: `${durationSeconds}s` }, {
      blocked, saved: { ...preset, model: original.id, templateId: preset.id, durationSeconds: durationSeconds === 5 ? 10 : 5 },
    });
    try {
      const tree = await h.settle();
      assert.equal(prompt(tree).props.value, preset.prompt);
      assert.equal(control(tree, 'duration').props.value, `${durationSeconds}s`);
      assert.equal(control(tree, 'aspect').props.value, model === original ? '9:16' : '4:5');
      assert.equal(card(tree)?.props.preset ?? null, model === original ? preset : null);
      assert.equal(generate(tree).props.disabled, false);
      await generate(tree).props.onClick();
      assert.equal(h.requests.length, 1);
      assert.deepEqual(h.requests[0].inputs, { prompt: preset.prompt, aspect_ratio: model === original ? '9:16' : '4:5', duration_seconds: durationSeconds, negative_prompt: preset.negativePrompt });
      assert.equal(h.requests[0].model_id, model.id);
      assert.equal(h.requests[0].preset, model === original ? preset.id : undefined);
    } finally { h.close(); }
  }
});

test('Create waits for live catalog validation, rejects gated URL model, and ignores another template draft', async () => {
  for (const requested of ['unknown', other.id]) {
    const h = harness({ model: requested }, { loading: true, models: [original, { ...other, gated: true }], saved: { prompt: 'Unrelated', model: other.id, templateId: 'other-template', aspect: '1:1', durationSeconds: 5 } });
    try {
      await h.settle();
      h.catalogReady();
      const tree = await h.settle();
      assert.equal(prompt(tree).props.value, preset.prompt);
      assert.equal(control(tree, 'duration').props.value, '10s');
      assert.equal(card(tree).props.preset, preset);
      await generate(tree).props.onClick();
      assert.equal(h.requests[0].model_id, original.id);
    } finally { h.close(); }
  }
});

test('changing model inside Create keeps personal edits and never reapplies the arrival recipe', async () => {
  const h = harness({ model: original.id, duration: '10s' });
  try {
    let tree = await h.settle();
    prompt(tree).props.onChange({ target: { value: 'Personal edit after arrival' } });
    control(tree, 'duration').props.onChange('5s');
    find(tree, node => node.props?.id === 'studio-model').props.onChange({ target: { value: other.id } });
    tree = await h.settle();
    assert.equal(prompt(tree).props.value, 'Personal edit after arrival');
    assert.equal(control(tree, 'duration').props.value, '5s');
    assert.equal(card(tree)?.props.preset ?? null, null);
    await generate(tree).props.onClick();
    assert.equal(h.requests[0].preset, undefined);
    assert.equal(h.requests[0].inputs.prompt, 'Personal edit after arrival');
  } finally { h.close(); }
});

test('Create applies matching personal edits on another model and falls back to saved model without URL model', async () => {
  for (const params of [{ model: other.id }, {}]) {
    const h = harness(params, { saved: { prompt: 'Edited community scene', templateId: preset.id, model: other.id, aspect: '1:1', durationSeconds: 5, negativePrompt: 'No blur' } });
    try {
      const tree = await h.settle();
      assert.equal(prompt(tree).props.value, 'Edited community scene');
      assert.equal(control(tree, 'aspect').props.value, '1:1');
      assert.equal(control(tree, 'duration').props.value, '5s');
      await generate(tree).props.onClick();
      assert.equal(h.requests[0].model_id, other.id);
      assert.equal(h.requests[0].inputs.negative_prompt, 'No blur');
      assert.equal(h.requests[0].preset, undefined);
    } finally { h.close(); }
  }
});

test('ordinary Create drafts still arrive before the catalog and do not replay when it settles', async () => {
  const h = harness({ preset: '', model: original.id }, { loading: true, saved: { model: original.id, prompt: 'Ordinary studio draft' } });
  try {
    let tree = await h.settle();
    assert.equal(prompt(tree).props.value, 'Ordinary studio draft');
    prompt(tree).props.onChange({ target: { value: 'My edit while loading' } });
    h.catalogReady();
    tree = await h.settle();
    assert.equal(prompt(tree).props.value, 'My edit while loading');
    assert.equal(card(tree)?.props.preset ?? null, null);
  } finally { h.close(); }
});

test('Create still refuses missing required sources, missing consent and prompts over 30,000', async () => {
  const withMedia = { ...original, media: { image: { kind: 'image', required: true } } };
  for (const saved of [undefined, { prompt: preset.prompt, model: original.id, templateId: preset.id, sources: { image: { assetId: 'test-asset' } }, consent: false }]) {
    const h = harness({ model: original.id }, { models: [withMedia], saved });
    try {
      const tree = await h.settle();
      assert.equal(generate(tree).props.disabled, true);
      // The person is told what is missing instead of facing a silent grey button.
      assert.ok(why(tree), 'a disabled Generate says why');
      // (The harness stubs the error-copy table; generateHint.test.mjs checks each hint maps to real copy.)
      assert.equal(generate(tree).props['aria-describedby'], 'vx-generate-why');
      await generate(tree).props.onClick();
      assert.equal(h.requests.length, 0);
    } finally { h.close(); }
  }
  const h = harness({ model: original.id });
  try {
    prompt(await h.settle()).props.onChange({ target: { value: 'x'.repeat(30001) } });
    const tree = await h.settle();
    assert.equal(generate(tree).props.disabled, true);
    assert.equal(why(tree), '', 'an over-long prompt already has its own message beside the box');
    await generate(tree).props.onClick();
    assert.equal(h.requests.length, 0);
  } finally { h.close(); }
});

test('Create consumes the one-time template photo into the required source slot', async () => {
  const photo = Object.assign(new Blob(['photo'], { type: 'image/jpeg' }), { name: 'portrait.jpg' });
  const withMedia = { ...original, media: { image: { kind: 'image', required: true } } };
  const h = harness({ model: original.id }, { models: [withMedia], handoff: photo });
  try {
    const tree = await h.settle();
    assert.equal(sourcePickers(tree).props.sources.image.file, photo);
    assert.match(sourcePickers(tree).props.sources.image.previewUrl, /^blob:/);
    assert.equal(generate(tree).props.disabled, true, 'the existing rights confirmation still applies');
    assert.equal(templateMediaHandoff.takeTemplateMediaHandoff(globalThis.window, preset.id, original.id), null);
  } finally { h.close(); }
});
