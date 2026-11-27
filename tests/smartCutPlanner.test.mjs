import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import React from 'react';
import ts from 'typescript';

const require = createRequire(import.meta.url);

function load(path, mocks) {
  const source = readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS } }).outputText;
  const loaded = { exports: {} };
  new Function('require', 'module', 'exports', code)(id => mocks[id] ?? (id === './SmartCutFeedback' ? { SmartCutFeedback: () => null } : require(id)), loaded, loaded.exports);
  return loaded.exports;
}

function hooks() {
  const values = [], dependencies = [], cleanups = [];
  let cursor = 0, effects = [];
  const react = {
    ...React,
    useMemo: factory => factory(),
    useState(initial) {
      const index = cursor++;
      if (!(index in values)) values[index] = typeof initial === 'function' ? initial() : initial;
      return [values[index], value => { values[index] = typeof value === 'function' ? value(values[index]) : value; }];
    },
    useRef(initial) {
      const index = cursor++;
      return values[index] ??= { current: initial };
    },
    useEffect(effect, next) {
      const index = cursor++;
      if (!next || !dependencies[index] || next.some((value, at) => value !== dependencies[index][at])) {
        dependencies[index] = next;
        effects.push(() => { cleanups[index]?.(); cleanups[index] = effect(); });
      }
    },
  };
  return {
    react,
    render(factory) { cursor = 0; return factory(); },
    flush() { const pending = effects; effects = []; pending.forEach(effect => effect()); },
  };
}

function nodes(tree) {
  if (!tree || typeof tree !== 'object') return [];
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  return [tree, ...nodes(tree.props?.children)];
}

test('web speech mode keeps the script visible and renders analysed alternate takes', () => {
  const state = hooks();
  let receivedScript = null;
  let receivedLanguage = null;
  const speechPlan = {
    mode: 'transcript-silence', pacing: 'speech', totalDuration: 1, silenceRemoved: 0,
    warnings: [], warningDetails: [],
    takes: [
      { id: 'take-a', assetId: 'take-a', name: 'Take A', duration: 4, rangeStart: 0, rangeEnd: 4 },
      { id: 'take-b', assetId: 'take-b', name: 'Take B', duration: 4, rangeStart: 0, rangeEnd: 4 },
    ],
    segments: [{
      id: 'speech-1', label: 'hello', takeId: 'take-a', start: 0, end: 1, outputOffset: 0, plannedLength: 1,
      matchStatus: 'matched', matchCode: 'script_line_matched', matchParameters: { line: 1, confidence: 1 },
      reason: 'best', reasonCode: 'best_take_score', reasonParameters: {}, alternates: ['take-b'], alternateCandidates: [],
    }],
  };
  const { SmartCutPlanner } = load('app/veyrnox/_components/SmartCutPlanner.js', {
    react: state.react,
    '../../../components/I18nProvider': { useI18n: () => ({ t: key => key, locale: 'en' }) },
    '../../../lib/i18n/locales.mjs': { localeTag: () => 'en' },
    '../../lib/authClient': { getStoredUserId: () => 'person', onSessionChange: () => () => {} },
    '../_lib/useAssetUrl': { useAssetUrl: () => ({ url: '', onError() {}, onLoad() {} }) },
    '../_lib/smartCutSetupDraft.mjs': {
      readSmartCutSetupDraft: () => null, removeSmartCutSetupDraft() {}, smartCutSetupHasWork: () => false, writeSmartCutSetupDraft() {},
    },
    '../_lib/smartCutFillers': { smartCutFillerRanges: () => [] },
    '../_lib/smartCutAnalysis': {
      SPEECH_CUT_LANGUAGES: ['en', 'es'],
      parseSmartCutAnalysis: value => ({ ok: true, analysis: value }),
      SmartCutPlanError: class SmartCutPlanError extends Error {},
      buildSpeechAwareCutPlan(input) { receivedScript = input.script; receivedLanguage = input.languageOverride; return speechPlan; },
    },
    '../_lib/smartCut': {
      SMART_CUT_PACING: { balanced: { labelKey: 'balanced' } },
      buildSmartCutPlan: () => speechPlan,
      smartCutPlanUsesAvailableTakes: () => true,
      smartCutPlanWithinLimits: () => true,
      swapSmartCutTake: plan => plan,
    },
  });
  const clips = [
    { job_id: 'take-a', name: 'Take A', duration: 4 },
    { job_id: 'take-b', name: 'Take B', duration: 4 },
  ];
  const analyses = new Map(clips.map(clip => [clip.job_id, { assetId: clip.job_id, chunks: [] }]));
  const render = () => state.render(() => SmartCutPlanner({ clips, analyses, startOpen: true }));

  let tree = render();
  const script = nodes(tree).find(node => node.type === 'textarea' && node.props.placeholder === 'app.smartCut.scriptPlaceholder');
  assert.ok(script, 'the intended script stays editable after every take has speech analysis');
  script.props.onChange({ target: { value: 'hello' } });
  const language = nodes(tree).find(node => node.type === 'select' && node.props['aria-label'] === 'app.smartCut.language.label');
  assert.ok(language, 'speech mode exposes automatic detection and a manual matching language');
  language.props.onChange({ target: { value: 'es' } });

  tree = render();
  const create = nodes(tree).find(node => node.type === 'button' && node.props.children === 'app.smartCut.action.removePauses');
  assert.ok(create);
  create.props.onClick();

  tree = render();
  assert.equal(receivedScript, 'hello');
  assert.equal(receivedLanguage, 'es');
  const picker = nodes(tree).find(node => node.type === 'select' && node.props['aria-label'] === 'app.smartCut.takeForSection');
  assert.ok(picker, 'an analysed alternate is reachable from the cut review');
  assert.deepEqual(nodes(picker).filter(node => node.type === 'option').map(node => node.props.value), ['take-a', 'take-b']);
});

test('applying Smart Cut does not recreate the setup draft after the clip list changes', async (t) => {
  const previousWindow = globalThis.window;
  globalThis.window = {};
  Object.defineProperty(globalThis.window, 'localStorage', { get() { throw new Error('blocked'); } });
  t.after(() => {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  });
  const state = hooks();
  let writes = 0;
  let removes = 0;
  let clips = [{ job_id: 'take-a', uid: 'take-a', name: 'Take A', duration: 4, in_s: 0, out_s: 4 }];
  const plan = {
    mode: 'local-preview', pacing: 'balanced', totalDuration: 1, warnings: [], warningDetails: [],
    takes: [{ id: 'take-a', assetId: 'take-a', name: 'Take A', duration: 4, rangeStart: 0, rangeEnd: 4 }],
    segments: [{ id: 'cut-1', label: 'Cut 1', takeId: 'take-a', start: 0, end: 1, outputOffset: 0, plannedLength: 1, alternates: [] }],
  };
  const { SmartCutPlanner } = load('app/veyrnox/_components/SmartCutPlanner.js', {
    react: state.react,
    '../../../components/I18nProvider': { useI18n: () => ({ t: key => key, locale: 'en' }) },
    '../../../lib/i18n/locales.mjs': { localeTag: () => 'en' },
    '../../lib/authClient': { getStoredUserId: () => 'person', onSessionChange: () => () => {} },
    '../_lib/useAssetUrl': { useAssetUrl: () => ({ url: '', onError() {}, onLoad() {} }) },
    '../_lib/smartCutSetupDraft.mjs': {
      readSmartCutSetupDraft: () => null,
      removeSmartCutSetupDraft() { removes += 1; },
      smartCutSetupHasWork: setup => Boolean(setup.script),
      writeSmartCutSetupDraft() { writes += 1; },
    },
    '../_lib/smartCutFillers': { smartCutFillerRanges: () => [] },
    '../_lib/smartCutAnalysis': {
      SPEECH_CUT_LANGUAGES: ['en'], parseSmartCutAnalysis: () => ({ ok: false }),
      SmartCutPlanError: class SmartCutPlanError extends Error {}, buildSpeechAwareCutPlan: () => plan,
    },
    '../_lib/smartCut': {
      SMART_CUT_PACING: { balanced: { labelKey: 'balanced' } }, buildSmartCutPlan: () => plan,
      smartCutPlanUsesAvailableTakes: () => true, smartCutPlanWithinLimits: () => true, swapSmartCutTake: value => value,
    },
  });
  const render = () => state.render(() => SmartCutPlanner({
    clips,
    startOpen: true,
    onApply(nextClips) { clips = nextClips; return true; },
  }));

  render();
  state.flush();
  let tree = render();
  nodes(tree).find(node => node.type === 'textarea').props.onChange({ target: { value: 'Keep this setup safe' } });
  tree = render();
  nodes(tree).find(node => node.type === 'button' && node.props.children === 'app.smartCut.action.createPreview').props.onClick();
  tree = render();
  nodes(tree).find(node => node.type === 'button' && node.props.children === 'app.smartCut.action.apply').props.onClick();

  render();
  state.flush();
  render();
  state.flush();
  await new Promise(resolve => setTimeout(resolve, 600));
  assert.equal(writes, 0, 'the post-apply clip identity change must not schedule another draft write');
  assert.ok(removes > 0, 'a successful apply clears the prior setup draft');
});
