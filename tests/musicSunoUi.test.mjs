import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import ts from 'typescript';
import { translator, tOr } from '../lib/i18n/translate.mjs';
import en from '../lib/i18n/messages/app/en/music-suno.mjs';
import { createQuoteGate } from '../lib/quoteRevisionGate.js';
import {
  appendSunoStyle, capSunoText, isSunoContract, sunoCustomQuoteRequest, sunoCustomReady,
  preserveSunoDraftText, sunoControlsForModel, sunoDuration, sunoFormatEditsUnavailable,
  sunoLimit, sunoSimpleQuoteRequest,
} from '../app/veyrnox/_components/music/musicSunoForm.js';

const require = createRequire(import.meta.url);
function load(path, imports = {}, suffix = '') {
  const source = readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
  const code = ts.transpileModule(source + suffix, {
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const loaded = { exports: {} };
  new Function('require', 'module', 'exports', code)(id => imports[id]
    ?? (id === 'react/jsx-runtime' ? require(id) : {}), loaded, loaded.exports);
  return loaded.exports;
}

function hookHarness() {
  let cursor = 0;
  let effects = [];
  const slots = [];
  const memo = (make, deps = []) => {
    const i = cursor++, old = slots[i];
    if (!old || deps.some((value, index) => !Object.is(value, old.deps[index]))) slots[i] = { deps, value: make() };
    return slots[i].value;
  };
  const hooks = {
    useState(initial) {
      const i = cursor++;
      if (!(i in slots)) {
        const slot = { value: typeof initial === 'function' ? initial() : initial };
        slot.set = next => { slot.value = typeof next === 'function' ? next(slot.value) : next; };
        slots[i] = slot;
      }
      return [slots[i].value, slots[i].set];
    },
    useRef: value => memo(() => ({ current: value }), []),
    useMemo: memo,
    useCallback: (value, deps) => memo(() => value, deps),
    useEffect: (effect, deps) => memo(() => { effects.push(effect); }, deps),
  };
  return {
    hooks,
    render(call, runEffects = false) {
      cursor = 0; effects = [];
      const result = call();
      if (runEffects) for (const effect of effects) effect();
      return result;
    },
  };
}

const model = {
  id: 'ace-step-1.5', provider_contract: 'crun-suno-v1', available: true,
  generation_modes: ['simple', 'custom'],
  controls: { duration_seconds: { min: 1, max: 135, default: 60 } },
  counters: { prompt: { max: 417 }, title: { max: 79 }, lyrics: { max: 4999 }, styles: { max: 997 }, exclude_styles: { max: 991, applied: 199 } },
};

test('Suno UI limits and duration come only from the entitlement projection', () => {
  assert.equal(isSunoContract(model), true);
  assert.equal(sunoLimit(model, 'prompt'), 417);
  assert.equal(sunoLimit(model, 'lyrics'), 4999);
  assert.equal(sunoDuration(model, null), 60);
  assert.equal(sunoDuration(model, 999), 135);
  assert.equal(sunoDuration({ ...model, controls: {} }, 60), null);
});

test('simple and custom quote wires carry contract and immutable draft identity', () => {
  assert.deepEqual(sunoSimpleQuoteRequest({ model, prompt: '  harbour pop  ', instrumental: true }), {
    mode: 'simple', provider_contract: 'crun-suno-v1', model_id: 'ace-step-1.5',
    prompt: 'harbour pop', instrumental: true, suno_model: 'v6',
  });
  const draft = { id: '92ed2d0d-8276-4fbb-9c4f-39f401a3158b', revision: 9, title: 'Harbour', lyrics: 'Line', styles: 'Indie' };
  const request = sunoCustomQuoteRequest({ model, draft, controls: {
    instrumental: false, rightsConfirmed: true, durationSeconds: 88, sunoModel: 'v6_wild',
    vocalGender: 'female', styleWeight: 0.65, weirdness: 0.25, variety: 4, excludeStyles: ' noise ',
  } });
  assert.equal(request.provider_contract, 'crun-suno-v1');
  assert.equal(request.draft_id, draft.id);
  assert.equal(request.draft_revision, 9);
  assert.equal(request.style_influence, 65);
  assert.equal(request.variety, 100);
  assert.equal(request.exclude_styles, 'noise');
  assert.equal(sunoCustomReady({ model, draft, controls: { instrumental: false, rightsConfirmed: true } }), true);
  assert.equal(sunoCustomReady({ model, draft: { ...draft, lyrics: '' }, controls: { instrumental: false, rightsConfirmed: true } }), false);
  assert.equal(sunoCustomReady({ model, draft: { ...draft, styles: '  ' }, controls: { instrumental: true, rightsConfirmed: false } }), false);
});

test('style picker de-duplicates values and respects the projected cap', () => {
  assert.equal(appendSunoStyle('Jazz', 'jazz', 50), 'Jazz');
  assert.equal(appendSunoStyle('Jazz', 'Electronic', 15), 'Jazz, Electroni');
  assert.equal(capSunoText('🎵'.repeat(6), 5), '🎵'.repeat(5));
});

test('instrumental-only offers, stale drafts and format explanations preserve their invariants', () => {
  const controls = { instrumental: false, variety: 1 };
  assert.deepEqual(sunoControlsForModel({ instrumental_only: true }, controls), { instrumental: true, variety: 1 });
  assert.equal(sunoControlsForModel({}, controls), controls);
  assert.deepEqual(preserveSunoDraftText(
    { id: 'new', provider_contract: 'crun-suno-v1', revision: 1, lyrics: '', styles: '', title: '' },
    { id: 'old', provider_contract: 'fal-ace-v1', lyrics: 'local lyrics', styles: 'local style', title: 'local title' },
  ), { id: 'new', provider_contract: 'crun-suno-v1', revision: 1, lyrics: '', styles: '', title: '' });
  assert.equal(sunoFormatEditsUnavailable({ playback: true, render: false, crop: false }), true);
  assert.equal(sunoFormatEditsUnavailable({ playback: true, render: true, crop: true, stems: false }), false);
  assert.equal(sunoFormatEditsUnavailable({ render: false, crop: false }), false, 'legacy rows do not get a misleading note');
});

test('draft hook refreshes stale identity unchanged and copies previous text only on explicit action', async t => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const timers = [];
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { setTimeout: fn => { timers.push(fn); return timers.length; }, clearTimeout() {} } });
  t.after(() => { if (previous) Object.defineProperty(globalThis, 'window', previous); else delete globalThis.window; });
  const responses = [
    { draft: { id: 'old', provider_contract: 'fal-ace-v1', model_id: 'ace-step-1.5', lyrics: 'server old', styles: 'old style', title: 'old title', revision: 8 } },
    { draft: { id: 'new', provider_contract: 'crun-suno-v1', model_id: 'ace-step-1.5', lyrics: 'server new', styles: 'new style', title: 'new title', revision: 1 } },
  ];
  const harness = hookHarness();
  const { useMusicCustomDraft } = load('app/veyrnox/_components/music/useMusicCustomDraft.js', {
    react: harness.hooks,
    '../../_lib/gateway': { gatewayFetch: async () => responses.shift() },
    './musicSunoForm': { preserveSunoDraftText },
  });
  const render = () => harness.render(() => useMusicCustomDraft({ active: true, defaultModelId: 'ace-step-1.5' }), true);
  let custom = render();
  await timers.shift()();
  custom = render();
  custom.update('lyrics', 'local lyrics'); custom.update('styles', 'local style'); custom.update('title', 'local title');
  custom = render();
  await custom.refresh();
  custom = render();
  assert.deepEqual({ id: custom.draft.id, contract: custom.draft.provider_contract, lyrics: custom.draft.lyrics, styles: custom.draft.styles, title: custom.draft.title }, {
    id: 'new', contract: 'crun-suno-v1', lyrics: 'server new', styles: 'new style', title: 'new title',
  });
  assert.deepEqual(custom.previousText, { lyrics: 'local lyrics', styles: 'local style', title: 'local title' });
  assert.equal(custom.dirty, false);
  assert.equal(custom.needsReview, true);
  assert.equal(custom.notice, 'draft_refreshed');
  custom.copyPreviousText();
  custom = render();
  assert.deepEqual({ lyrics: custom.draft.lyrics, styles: custom.draft.styles, title: custom.draft.title }, {
    lyrics: 'local lyrics', styles: 'local style', title: 'local title',
  });
  assert.equal(custom.dirty, true);
  assert.equal(custom.previousText, null);
});

test('quote hook refreshes stale identity and retries once with the active draft request', async () => {
  const harness = hookHarness();
  const calls = [];
  let quoteAttempt = 0;
  const gatewayFetch = async (path, init) => {
    calls.push([path, init?.method || 'GET']);
    if (path === '/music/generation-quotes' && quoteAttempt++ === 0) throw { code: 'CONTRACT_STALE' };
    if (path === '/music/generation-quotes') return { quote_id: 'fresh', provider_contract: 'crun-suno-v1' };
    if (path === '/music/entitlements') return { available: true, models: [] };
    throw new Error(path);
  };
  const { useMusicServerState } = load('app/veyrnox/_components/music/useMusicServerState.js', {
    react: harness.hooks,
    '../../../../lib/quoteRevisionGate.js': { createQuoteGate },
    '../../_lib/gateway': { gatewayFetch, makeIdempotencyKey: () => 'key', notifyBalanceChanged() {} },
    '../../_lib/useMusicCelebrations': { useMusicCelebrations: () => () => {} },
  });
  const render = () => harness.render(() => useMusicServerState({ active: false }));
  let state = render(), refreshed = 0;
  const quote = await state.reviewQuote({ mode: 'custom', draft_id: 'old' }, undefined, async () => {
    refreshed++;
    return { mode: 'custom', draft_id: 'new' };
  });
  state = render();
  assert.equal(refreshed, 1);
  assert.equal(quote.quote_id, 'fresh');
  assert.equal(state.quote.quote_id, 'fresh');
  assert.deepEqual(calls.map(([path]) => path), ['/music/generation-quotes', '/music/entitlements', '/music/generation-quotes']);
});

function chatHookFixture({ generations = [] } = {}) {
  const harness = hookHarness();
  const requests = [];
  const customDraft = { id: 'draft', revision: 3, provider_contract: 'crun-suno-v1', model_id: 'ace-step-1.5', title: 'Song', lyrics: 'Words', styles: 'Indie' };
  const models = [
    { ...model, id: 'ace-step', generation_modes: ['simple'], instrumental_only: false },
    { ...model, id: 'ace-step-1.5', generation_modes: ['simple', 'custom'] },
  ];
  const server = {
    entitlements: { available: true, concurrency_limit: 2, models }, quote: null, busy: '', error: '', errorCode: '', generations,
    clearQuote() {}, clearGenerations() {}, quoteRevisionNow: () => 0, reload: async () => {},
    reviewQuote: async request => { requests.push(request); return { quote_id: 'quote' }; }, confirmQuote: async () => ({}),
  };
  const custom = { loaded: true, dirty: false, draft: customDraft, update(field, value) { custom.draft = { ...custom.draft, [field]: value }; }, saveNow: async () => custom.draft, refresh: async () => custom.draft };
  const { useChatMusicGeneration } = load('app/veyrnox/_components/chat/useChatMusicGeneration.js', {
    react: harness.hooks,
    '../music/useMusicCustomDraft': { useMusicCustomDraft: () => custom },
    '../music/useMusicServerState': { useMusicServerState: () => server },
    '../music/musicSunoForm': { isSunoContract, SUNO_CONTROL_DEFAULTS: { instrumental: false, rightsConfirmed: false, sunoModel: 'v6', vocalGender: 'auto', styleWeight: 0.5, weirdness: 0.5, durationSeconds: 60, variety: 1, excludeStyles: '' }, sunoCustomQuoteRequest, sunoCustomReady, sunoControlsForModel, sunoLimit, sunoSimpleQuoteRequest },
  });
  const render = prompt => harness.render(() => useChatMusicGeneration({ active: true, prompt }));
  return { render, requests };
}

test('Chat action builds simple and custom requests and gates only the shared slot', async () => {
  const fixture = chatHookFixture();
  let chat = fixture.render('harbour pop');
  assert.equal(await chat.action(), true);
  assert.equal(fixture.requests.at(-1).mode, 'simple');
  chat.setCustom(true);
  chat = fixture.render('harbour pop');
  chat.updateControl('rightsConfirmed', true);
  chat = fixture.render('harbour pop');
  assert.equal(await chat.action(), true);
  assert.equal(fixture.requests.at(-1).mode, 'custom');
  assert.equal(fixture.requests.at(-1).draft_id, 'draft');

  const full = chatHookFixture({ generations: [{ id: 'one', state: 'running' }, { id: 'two', state: 'queued' }] }).render('editable prompt');
  assert.equal(full.generating, true);
  assert.equal(full.hasSharedSlot, false);
  assert.equal(full.canAct, false);
  assert.equal(full.blockReason, 'concurrency_limit');
});

test('Chat composer keeps editing enabled during generation but disables Send without a slot', () => {
  const t = translator('en', en);
  const { ChatSunoComposer } = load('app/veyrnox/_components/chat/MediaComposer.js', {
    react: { useState: initial => [initial, () => {}] },
    '../../../../components/I18nProvider': { useI18n: () => ({ t, locale: 'en' }) },
    '../../../../lib/i18n/translate.mjs': { pluralKey: () => 'app.music.suno.credits.other', tOr },
    '../music/musicSunoForm': { capSunoText, sunoLimit },
  }, '\nexport { ChatSunoComposer };');
  const media = {
    model, availableModels: [model], offerId: model.id, selectOffer() {}, customMode: false, setCustom() {},
    custom: { draft: {}, notice: '' }, controls: { instrumental: false }, updateControl() {}, updateDraft() {},
    quote: null, busy: '', error: '', action() {}, canAct: true, promptMax: 417, loading: false, reload() {},
    generating: true, hasSharedSlot: false, blockReason: 'concurrency_limit',
  };
  const tree = ChatSunoComposer({ media, prompt: 'keep editing', onPrompt() {} });
  const children = [];
  const walk = node => { if (Array.isArray(node)) return node.forEach(walk); if (node?.props) { children.push(node); walk(node.props.children); } };
  walk(tree);
  assert.equal(children.find(node => node.type === 'fieldset').props.disabled, false);
  const send = children.find(node => node.props['data-testid'] === 'chat-music-send');
  assert.equal(send.props.disabled, true);
  assert.equal(send.props['aria-describedby'], 'chat-music-send-hint');
});

test('Suno error codes resolve through the locale catalog instead of rendering raw keys', async () => {
  const de = (await import('../lib/i18n/messages/app/de/music-suno.mjs')).default;
  const t = translator('de', de);
  const copy = tOr(t, 'app.music.suno.err.contract_refresh_failed', 'fallback');
  assert.notEqual(copy, 'fallback');
  assert.doesNotMatch(copy, /app\.music\.suno\.err/);
});

test('Chat switches only the Crun audio contract to Music pair submission', async () => {
  const workspace = await readFile(new URL('../app/veyrnox/_components/chat/ChatWorkspace.js', import.meta.url), 'utf8');
  const hook = await readFile(new URL('../app/veyrnox/_components/chat/useChatMusicGeneration.js', import.meta.url), 'utf8');
  const generic = await readFile(new URL('../app/veyrnox/_components/chat/useChatMediaGeneration.js', import.meta.url), 'utf8');
  const state = await readFile(new URL('../app/veyrnox/_components/music/useMusicServerState.js', import.meta.url), 'utf8');
  assert.match(workspace, /!musicGeneration\.resolved \|\| musicGeneration\.suno/);
  assert.doesNotMatch(workspace, /musicGeneration\.suno \|\| musicGeneration\.error/);
  assert.match(hook, /filter\(isSunoContract\)/);
  assert.match(hook, /sunoControlsForModel\(model, controls\)/);
  assert.match(hook, /instrumental: effectiveControls\.instrumental/);
  assert.match(state, /'\/music\/generation-quotes'/);
  assert.match(state, /'\/music\/generations'/);
  assert.match(generic, /gatewayFetch\('\/generations'/, 'fal and non-Music audio keep the existing path');
  assert.match(hook, /persisted|thread/i, 'document the no-thread-message behavior');
  assert.match(hook, /resolved: entitlements !== null \|\| Boolean\(server\.error\)/);
  const composer = await readFile(new URL('../app/veyrnox/_components/chat/MediaComposer.js', import.meta.url), 'utf8');
  assert.match(composer, /customMode && controlsOpen \? <div/);
  assert.doesNotMatch(composer, /absolute bottom-14/, 'required custom controls are not clipped inside the scrolling row');
});

test('draft saves and pair confirmation carry contract identity and refresh stale state', async () => {
  const draft = await readFile(new URL('../app/veyrnox/_components/music/useMusicCustomDraft.js', import.meta.url), 'utf8');
  const state = await readFile(new URL('../app/veyrnox/_components/music/useMusicServerState.js', import.meta.url), 'utf8');
  assert.match(draft, /provider_contract: draft\.provider_contract/);
  assert.match(draft, /draft_id: draft\.id/);
  assert.match(draft, /contract_stale/);
  assert.match(draft, /draft_stale/);
  assert.match(draft, /setPreviousText/);
  assert.match(draft, /copyPreviousText/);
  assert.match(draft, /await onContractStale\?\.\(\)/);
  assert.match(state, /provider_contract: quote\.provider_contract/);
  assert.match(state, /REQUOTE_ERRORS[\s\S]*contract_stale/);
  assert.match(state, /REQUOTE_ERRORS[\s\S]*draft_stale/);
  assert.match(state, /await loadEntitlements\(\)/);
  assert.match(draft, /needsReview/);
  assert.match(draft, /refresh/);
  const reuse = await readFile(new URL('../app/veyrnox/_components/music/MusicReuseDialog.jsx', import.meta.url), 'utf8');
  assert.match(reuse, /provider_contract: context\.provider_contract/);
  assert.match(reuse, /draft_id: context\.draft_id/);
  assert.match(reuse, /reason\?\.code === 'contract_stale'/);
  const studio = await readFile(new URL('../app/veyrnox/_components/music/MusicServerStudio.jsx', import.meta.url), 'utf8');
  assert.match(studio, /provider_contract: selectedModel\?\.provider_contract/);
  assert.match(studio, /draft_id: saved\.id/);
  assert.match(studio, /provider_contract: model\.provider_contract/);
});

test('song actions consume reader capabilities and explain hidden format edits', async () => {
  const detail = await readFile(new URL('../app/veyrnox/_components/music/MusicServerSongDetail.jsx', import.meta.url), 'utf8');
  const actions = await readFile(new URL('../app/veyrnox/_components/music/MusicSongActions.jsx', import.meta.url), 'utf8');
  assert.match(detail, /capabilities=\{song\.current_version\?\.capabilities\}/);
  assert.match(actions, /sunoFormatEditsUnavailable\(capabilities\)/);
  assert.match(actions, /app\.music\.suno\.editUnavailable/);
});

test('Suno controls name every field and slider, format decimals by locale, and show Style once in the chat composer', () => {
  const source = readFileSync(new URL('../app/veyrnox/_components/music/MusicSunoControls.jsx', import.meta.url), 'utf8');
  assert.match(source, /<textarea value=\{value\}[\s\S]{0,160}aria-label=\{label\}/, 'Style and Exclude textareas carry an accessible name');
  assert.match(source, /<input id=\{id\} type="range"[\s\S]{0,260}aria-label=\{label\}/, 'Style weight and Weirdness sliders carry an accessible name');
  assert.match(source, /<input id="suno-duration" aria-label=/, 'the Duration slider carries an accessible name');
  assert.match(source, /Intl\.NumberFormat\(locale/, 'slider readouts use the locale decimal mark');
  assert.doesNotMatch(source, /toFixed\(2\)/);
  assert.match(source, /\{showTextFields \? <StylePicker label=\{t\('app\.music\.suno\.style'\)\}/, 'the composer shows its own Style box, so the picker hides there');
});

test('the Suno Simple brief box shows the typed text untrimmed, so a trailing space can be typed', () => {
  const source = readFileSync(new URL('../app/veyrnox/_components/music/MusicServerStudio.jsx', import.meta.url), 'utf8');
  assert.match(source, /const sunoField = capSunoText\(description, sunoLimit\(model, 'prompt'\)\);/, 'the field value is the capped raw description');
  assert.match(source, /<SunoSimpleFields[^>]*description=\{sunoField\}/, 'the textarea is fed the untrimmed value');
  assert.doesNotMatch(source, /<SunoSimpleFields[^>]*description=\{sunoPrompt\}/, 'the trimmed quote prompt must not feed the box');
  assert.equal(capSunoText('warm lo-fi ', 500), 'warm lo-fi ', 'capping keeps a trailing space');
});
