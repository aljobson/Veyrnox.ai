import * as helperDisplay from '../lib/i18n/helperCopy.mjs';
import { appMessagesFor } from '../lib/i18n/appMessages.mjs';
import { translator, tOr, pluralKey } from '../lib/i18n/translate.mjs';
import { localeTag } from '../lib/i18n/locales.mjs';
const t = translator('en', await appMessagesFor('en'));
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const image = { id: 'nano-banana', name: 'Nano Banana', kind: 'image', credits: 2, aspects: ['16:9', '9:16'] };
const audio = { id: 'ace-step', name: 'ACE-Step', kind: 'audio', credits: 1 };
const slow = { id: 'slow-video', name: 'Slow Video', kind: 'video', credits: 9 };

function harness(initialJobs, selected = audio) {
  let jobs = initialJobs, cleared = 0, submitted = 0, cursor = 0;
  const states = [];
  const react = {
    useState(initial) {
      const index = cursor++;
      if (!(index in states)) states[index] = index === 0 ? selected.id : typeof initial === 'function' ? initial() : initial;
      return [states[index], next => { states[index] = typeof next === 'function' ? next(states[index]) : next; }];
    },
    useRef: initial => ({ current: initial }), useEffect() {}, useCallback: fn => fn, useSyncExternalStore: () => false,
  };
  const stubs = {
    '../../../../lib/i18n/helperCopy.mjs': helperDisplay,
    react,
    '../../../../components/I18nProvider': { useI18n: () => ({ t, locale: 'en' }) },
    '../../../../lib/i18n/locales.mjs': { localeTag },
    '../../../../lib/i18n/translate.mjs': { tOr, pluralKey },
    '../../_lib/useCatalog': { useCatalog: () => ({ models: [image, audio, slow], live: true, loading: false }) },
    '../../_lib/useCreateDraftRecovery': { __esModule: true, default: () => ({ restoring: false, blocked: false, failed: false, saved: false, status: '', retry() {}, sourceEdited() {} }) },
    '../../_lib/useFreeAllowance': { useFreeAllowance: () => ({}) },
    '../../_lib/useStudioJobs': { useStudioJobs: () => ({ jobs, generating: jobs.some(job => ['queued', 'running'].includes(job.state)), clearJobs: () => { cleared++; jobs = []; } }) },
    '../../_lib/tokens': { ASPECT_RATIOS: ['16:9', '9:16'], modelAspectRatios: model => model?.aspects || [] },
    '../../_lib/starterModels': { starterModel: () => image, modelsForGoal: models => models },
    '../../_lib/modelTiers': { TIERS: [], filterByTier: models => models },
    '../../_lib/imageBatch': { imageCount: () => 1, totalCost: cost => cost, takesImageCount: () => false, IMAGE_COUNTS: [] },
    '../../_lib/freeAllowance': { freeLeftFor: () => 0 },
    '../../_lib/generationSettings': { audioDurationConfig: () => null, audioDurationIsInvalid: () => false, voiceIsMissing: () => false },
    '../../_lib/promptBox': { promptText: () => 'QA prompt', promptIsMissing: () => false, promptPlaceholderDiagnostic: () => null },
    '../../_lib/modelPricing': { sourceDurationLimit: () => null, generationCostLabel: cost => `${cost} credits`, creditLabel: cost => `${cost} credits` },
    '../../_lib/studioStates': { jobStateUi: job => ({ label: job?.state?.toUpperCase() }), SLOW_MODEL_WAIT: { 'slow-video': 'This submitted video takes longer.' } },
    '../../_lib/gateway': { gatewayFetch: async () => { submitted++; return {}; }, GatewayError: class extends Error {} },
    '../../_lib/createErrors': { ERROR_COPY: {}, failedJobCopy: () => 'Failed' },
  };
  const source = readFileSync(new URL('../app/veyrnox/app/create/page.js', import.meta.url), 'utf8');
  const output = { exports: {} };
  const code = ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS } }).outputText;
  new Function('require', 'module', 'exports', code)(id => {
    if (stubs[id]) return stubs[id];
    if (id === 'react/jsx-runtime') return require(id);
    return new Proxy({}, { get: () => () => null });
  }, output, output.exports);
  return {
    render() { cursor = 0; return output.exports.default(); },
    settle() { jobs = jobs.map(job => ({ ...job, state: 'succeeded' })); },
    cleared: () => cleared, submitted: () => submitted,
  };
}

function find(node, predicate) {
  if (node == null || typeof node !== 'object') return null;
  if (Array.isArray(node)) return node.map(item => find(item, predicate)).find(Boolean) || null;
  return predicate(node) ? node : find(node.props?.children, predicate);
}
function text(node) {
  if (node == null || typeof node === 'boolean') return '';
  if (Array.isArray(node)) return node.map(text).join(' ');
  return typeof node === 'object' ? text(node.props?.children) : String(node);
}
const result = tree => find(tree, node => node.props?.['data-assistant-target'] === 'create.result');
const button = tree => find(tree, node => node.props?.['data-assistant-target'] === 'create.generate');

test('changing the draft goal cannot relabel the running submitted image as audio', () => {
  const page = harness([{ job_id: 'qa-image', model_id: image.id, state: 'running' }]);
  assert.match(text(result(page.render())), /RUNNING\s+·\s+NANO BANANA/);
  assert.doesNotMatch(text(result(page.render())), /ACE-STEP/);
});

test('the submitted model owns its wait hint even after an audio selection', () => {
  const page = harness([{ job_id: 'qa-video', model_id: slow.id, state: 'running' }]);
  assert.match(text(result(page.render())), /This submitted video takes longer/);
});

test('the running result retains its submitted aspect when the draft model changes', () => {
  const page = harness([{ job_id: 'qa-image', model_id: image.id, aspect_ratio: '9:16', state: 'running' }]);
  const canvas = find(result(page.render()), node => node.props?.style?.aspectRatio);
  assert.equal(canvas.props.style.aspectRatio, '9/16');
});

test('a model absent from the refreshed catalog uses the job name, never the draft model', () => {
  const page = harness([{ job_id: 'qa-retired', model_id: 'retired', model_name: 'Submitted model', state: 'running' }]);
  assert.match(text(result(page.render())), /RUNNING\s+·\s+SUBMITTED MODEL/);
});

test('New generation remains a non-billable reset if the job finishes before the click', async () => {
  const page = harness([{ job_id: 'qa-image', model_id: image.id, state: 'running' }]);
  assert.match(text(button(page.render())), /New generation/);
  page.settle();
  const settledButton = button(page.render());
  assert.match(text(settledButton), /New generation/);
  assert.match(text(settledButton), /No charge/);
  assert.equal(settledButton.props.disabled, false, 'reset does not require a priced, valid draft');
  await settledButton.props.onClick();
  assert.equal(page.cleared(), 1);
  assert.equal(page.submitted(), 0);
  assert.doesNotMatch(text(button(page.render())), /New generation/);
});

test('every accepted job snapshots submitted presentation before any upload or request', () => {
  const source = readFileSync(new URL('../app/veyrnox/app/create/page.js', import.meta.url), 'utf8');
  const submit = source.slice(source.indexOf('async function onSubmit()'), source.indexOf('function cancel()'));
  assert.match(submit, /const submittedPresentation = \{\s*model_name: model\.name,\s*duration_seconds: model\.kind === 'video' \? Number\(duration\.replace\('s', ''\)\) : undefined,\s*\.\.\.\(isShort \? \{ aspect_ratio: '9:16' \} : aspectOptions\.length \? \{ aspect_ratio: aspect \} : \{\}\),\s*\};/);
  assert.ok(submit.indexOf('const submittedPresentation') < submit.indexOf('await mediaGenerationSources'));
  assert.match(submit, /model_id: modelId, \.\.\.submittedPresentation/);
});
