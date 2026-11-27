import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import ts from 'typescript';
import { translator, tOr } from '../lib/i18n/translate.mjs';
import en from '../lib/i18n/messages/app/en/music-suno.mjs';
import { en as cancelEn } from '../lib/i18n/musicCandidateCancelTranslations.mjs';
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

function elementList(tree) {
  const found = [];
  const visit = node => {
    if (Array.isArray(node)) return node.forEach(visit);
    if (!node?.props) return;
    found.push(node);
    visit(node.props.children);
  };
  visit(tree);
  return found;
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

test('web candidate cancel re-probes 429 and false states, then ignores a late GET after one POST', async t => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const timers = [];
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {
    setTimeout(fn, ms) { const row = { fn, ms, cleared: false }; timers.push(row); return row; },
    clearTimeout(row) { if (row) row.cleared = true; },
  } });
  t.after(() => { if (previous) Object.defineProperty(globalThis, 'window', previous); else delete globalThis.window; });
  let gets = 0, posts = 0, finishLate;
  const gatewayFetch = async (_path, init = {}) => {
    if (init.method === 'POST') { posts++; return { cancelled: true, replayed: false, credits: 5 }; }
    gets++;
    if (gets === 1) throw { code: 'rate_limited', retryAfter: 18 };
    if (gets === 2) return { cancellable: false, credits: 5 };
    if (gets === 3) return { cancellable: true, credits: 5 };
    return new Promise(resolve => { finishLate = resolve; });
  };
  const harness = hookHarness(), cancelled = [];
  const messages = { ...en, ...cancelEn }, translate = translator('en', messages);
  const { MusicCandidateCancel } = load('app/veyrnox/_components/music/MusicCandidateCancel.jsx', {
    react: harness.hooks,
    '../../../../components/I18nProvider': { useI18n: () => ({ t: translate, locale: 'en' }) },
    '../../../../lib/i18n/translate.mjs': { pluralKey: (_t, _locale, key, count) => `${key}.${count === 1 ? 'one' : 'other'}` },
    '../../_lib/gateway': { gatewayFetch },
  });
  const candidate = { state: 'queued', job_id: 'job/1' };
  const render = effects => harness.render(() => MusicCandidateCancel({ candidate, onCancelled: value => cancelled.push(value) }), effects);
  let tree = render(true); await Promise.resolve(); await Promise.resolve();
  assert.equal(gets, 1); assert.equal(timers.at(-1).ms, 18_000);
  await timers.at(-1).fn(); tree = render(); assert.equal(gets, 2); assert.equal(timers.at(-1).ms, 15_000);
  await timers.at(-1).fn(); tree = render(); assert.equal(gets, 3);
  let nodes = elementList(tree);
  nodes.find(node => node.type === 'button' && node.props.children === 'Cancel queued version').props.onClick();
  tree = render(); nodes = elementList(tree);
  assert.ok(nodes.some(node => node.props.role === 'group' && node.props['aria-label'] === 'Cancel this version?'));
  assert.ok(nodes.some(node => typeof node.props.children === 'string' && node.props.children.includes('5 Credits')));
  void timers.at(-1).fn(); await Promise.resolve();
  const confirm = nodes.find(node => node.type === 'button' && node.props.children === 'Cancel version');
  await Promise.all([confirm.props.onClick(), confirm.props.onClick()]);
  finishLate({ cancellable: true, credits: 5 }); await Promise.resolve(); await Promise.resolve();
  tree = render(); nodes = elementList(tree);
  assert.equal(posts, 1); assert.equal(cancelled.length, 1);
  assert.equal(nodes.some(node => node.type === 'button' && node.props.children === 'Cancel queued version'), false);
  assert.ok(nodes.some(node => node.props.role === 'status' && String(node.props.children).includes('5 Credits')));
});

test('web candidate cancel re-probes a transient GET and a claimed-then-deferred refusal', async t => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const timers = [];
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {
    setTimeout(fn, ms) { const row = { fn, ms, cleared: false }; timers.push(row); return row; },
    clearTimeout(row) { if (row) row.cleared = true; },
  } });
  t.after(() => { if (previous) Object.defineProperty(globalThis, 'window', previous); else delete globalThis.window; });
  let gets = 0;
  const gatewayFetch = async (_path, init = {}) => {
    if (init.method === 'POST') throw { code: 'job_started' };
    gets++;
    if (gets === 1) throw { code: 'network_error' };
    return { cancellable: true, credits: 5 };
  };
  const harness = hookHarness();
  const messages = { ...en, ...cancelEn }, translate = translator('en', messages);
  const { MusicCandidateCancel } = load('app/veyrnox/_components/music/MusicCandidateCancel.jsx', {
    react: harness.hooks,
    '../../../../components/I18nProvider': { useI18n: () => ({ t: translate, locale: 'en' }) },
    '../../../../lib/i18n/translate.mjs': { pluralKey: (_t, _locale, key, count) => `${key}.${count === 1 ? 'one' : 'other'}` },
    '../../_lib/gateway': { gatewayFetch },
  });
  const candidate = { state: 'queued', job_id: 'job' };
  const render = effects => harness.render(() => MusicCandidateCancel({ candidate }), effects);
  let tree = render(true); await Promise.resolve(); await Promise.resolve();
  assert.equal(timers.at(-1).ms, 15_000);
  await timers.at(-1).fn(); tree = render();
  let nodes = elementList(tree);
  nodes.find(node => node.type === 'button' && node.props.children === 'Cancel queued version').props.onClick();
  tree = render(); nodes = elementList(tree);
  await nodes.find(node => node.type === 'button' && node.props.children === 'Cancel version').props.onClick();
  tree = render(); nodes = elementList(tree);
  assert.ok(nodes.some(node => node.props.role === 'status' && node.props.children === 'This version has already started, so it will finish normally.'));
  await timers.at(-1).fn(); tree = render(); nodes = elementList(tree);
  assert.ok(nodes.some(node => node.type === 'button' && node.props.children === 'Cancel queued version'));
  assert.equal(nodes.some(node => node.props.role === 'status'), false);
});

test('web generation refresh sequence rejects older responses in both completion orders', async () => {
  const harness = hookHarness(), pending = [], notifications = [];
  let generationReads = false, rejectNext = false, entitlementReads = 0;
  const gatewayFetch = async (path) => {
    if (path === '/music/generation-quotes') return { quote_id: 'quote', model_id: 'model', total_credits: 10 };
    if (path === '/music/generations') return { generation_id: 'generation', state: 'debited', candidates: [], balance_after: 90 };
    if (path === '/music/entitlements') { entitlementReads++; return { balance: 90 }; }
    if (path === '/music/generations/generation' && generationReads) {
      if (rejectNext) { rejectNext = false; throw new Error('temporary read failure'); }
      return new Promise(resolve => pending.push(resolve));
    }
    throw new Error(path);
  };
  const { useMusicServerState } = load('app/veyrnox/_components/music/useMusicServerState.js', {
    react: harness.hooks,
    '../../../../lib/quoteRevisionGate.js': { createQuoteGate },
    '../../_lib/gateway': { gatewayFetch, makeIdempotencyKey: () => 'key', notifyBalanceChanged: () => notifications.push(true) },
    '../../_lib/useMusicCelebrations': { useMusicCelebrations: () => () => {} },
  });
  const render = () => harness.render(() => useMusicServerState({ active: false }));
  let state = render(); await state.reviewQuote({ mode: 'simple' }); state = render();
  await state.confirmQuote({ title: 'Song' }); state = render(); generationReads = true;
  const oldFirst = state.refreshGeneration('generation'), newFirst = state.refreshGeneration('generation');
  pending[1]({ id: 'generation', state: 'refunded', title: 'Song', candidates: [] }); await newFirst;
  state = render(); assert.equal(state.generations[0].state, 'refunded');
  pending[0]({ id: 'generation', state: 'queued', title: 'Song', candidates: [] }); await oldFirst;
  state = render(); assert.equal(state.generations[0].state, 'refunded');
  const oldSecond = state.refreshGeneration('generation'), newSecond = state.refreshGeneration('generation');
  pending[2]({ id: 'generation', state: 'running', title: 'Song', candidates: [] }); await oldSecond;
  state = render(); assert.equal(state.generations[0].state, 'refunded');
  pending[3]({ id: 'generation', state: 'partial', title: 'Song', candidates: [] }); await newSecond;
  state = render(); assert.equal(state.generations[0].state, 'partial');
  assert.ok(notifications.length >= 3);
  assert.ok(entitlementReads >= 4, 'every refresh re-reads entitlements even when its generation result loses');
  const beforeFailure = entitlementReads;
  rejectNext = true;
  await assert.rejects(state.refreshGeneration('generation'), /temporary read failure/);
  assert.equal(entitlementReads, beforeFailure + 1, 'a failed generation read cannot suppress the entitlement refresh');
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

test('queued candidate cancellation is wired through Studio, chat, iOS queue and iOS actions', async () => {
  const cancel = await readFile(new URL('../app/veyrnox/_components/music/MusicCandidateCancel.jsx', import.meta.url), 'utf8');
  const candidate = await readFile(new URL('../app/veyrnox/_components/music/MusicServerCandidate.jsx', import.meta.url), 'utf8');
  const studio = await readFile(new URL('../app/veyrnox/_components/music/MusicServerStudio.jsx', import.meta.url), 'utf8');
  const chat = await readFile(new URL('../app/veyrnox/_components/chat/MediaCanvas.js', import.meta.url), 'utf8');
  const queue = await readFile(new URL('../apps/mobile/src/components/music/MusicQueue.tsx', import.meta.url), 'utf8');
  const action = await readFile(new URL('../apps/mobile/src/components/music/MusicGenerationActionBody.tsx', import.meta.url), 'utf8');
  assert.match(cancel, /candidate\?\.state === 'queued'/);
  assert.match(cancel, /PROBE_INTERVAL_MS = 15_000/);
  assert.match(cancel, /Math\.max\(PROBE_INTERVAL_MS, delay\)/);
  assert.match(cancel, /busy\.current \|\| !status\?\.cancellable/);
  assert.match(cancel, /await Promise\.resolve\(onCancelled\?\./);
  assert.match(candidate, /error_code === 'user_cancelled'/);
  assert.match(candidate, /role=\{userCancelled \? 'status'/);
  assert.match(candidate, /candidate\.credits > 0[\s\S]*candidate\.credits === 0/);
  assert.match(studio, /onCancelled=\{\(\) => refreshGeneration\(generation\.id\)\}/);
  assert.match(chat, /onCancelled=\{\(\) => media\.refreshGeneration\(latest\.id\)\}/);
  assert.match(queue, /afterCancel/);
  assert.match(action, /afterCancel: flow\.refreshBalance/);
  const create = await readFile(new URL('../apps/mobile/src/app/(app)/music/create.tsx', import.meta.url), 'utf8');
  assert.match(create, /afterCancel=\{flow\.refreshEntitlements\}/);
});

test('every Music locale carries cancellation copy instead of falling back to English', async () => {
  const locales = ['ar', 'de', 'en', 'es', 'fr', 'hi', 'ja', 'ko', 'pt', 'ru', 'zh'];
  const keys = ['action', 'confirmTitle', 'confirmPaid', 'confirmFree', 'keep', 'confirm', 'cancelling',
    'cancelledPaid', 'cancelledFree', 'cancelled', 'started', 'finished', 'frozen', 'rateLimited',
    'unavailable', 'unsure', 'state'];
  for (const locale of locales) {
    const messages = (await import(`../lib/i18n/messages/app/${locale}/music-suno.mjs`)).default;
    for (const key of keys) assert.equal(typeof messages[`app.music.suno.cancel.${key}`], 'string', `${locale} ${key}`);
    if (locale !== 'en') assert.notEqual(messages['app.music.suno.cancel.confirmTitle'], en['app.music.suno.cancel.confirmTitle']);
    const app = (await import(`../lib/i18n/messages/app/${locale}.mjs`)).default;
    for (const key of ['confirmPaidFormatted', 'cancelledPaidFormatted']) {
      assert.equal(typeof app[`app.music.suno.cancel.${key}`], 'string', `${locale} ${key}`);
      assert.match(app[`app.music.suno.cancel.${key}`], /\{credits\}/, `${locale} ${key} credit slot`);
    }
    for (const key of ['candidateRefundedPaid', 'candidateRefundedFree']) {
      assert.equal(typeof app[`app.music.suno.${key}`], 'string', `${locale} ${key}`);
    }
  }
});

test('Suno controls name every field and slider, format decimals by locale, and show Style once in the chat composer', () => {
  const source = readFileSync(new URL('../app/veyrnox/_components/music/MusicSunoControls.jsx', import.meta.url), 'utf8');
  assert.match(source, /<textarea value=\{value\}[\s\S]{0,160}aria-label=\{label\}/, 'Style and Exclude textareas carry an accessible name');
  assert.match(source, /<input id=\{id\} type="range"[\s\S]{0,260}aria-label=\{label\}/, 'Style weight and Weirdness sliders carry an accessible name');
  assert.match(source, /<input id="suno-duration" aria-label=/, 'the Duration slider carries an accessible name');
  assert.match(source, /Intl\.NumberFormat\(locale/, 'slider readouts use the locale decimal mark');
  assert.doesNotMatch(source, /toFixed\(2\)/);
  assert.match(source, /\{showTextFields \? <StylePicker label=\{t\('app\.music\.suno\.style'\)\}/, 'the composer shows its own Style box, so the picker hides there');
  assert.match(source, /suno_model_labels\?\.\[value\] \|\| value/, 'the label is projected while the option value stays on the wire token');
});

test('core Web music creation renders Veyrnox-facing model copy, never implementation names', () => {
  const studio = readFileSync(new URL('../app/veyrnox/_components/music/MusicServerStudio.jsx', import.meta.url), 'utf8');
  const controls = readFileSync(new URL('../app/veyrnox/_components/music/MusicSunoControls.jsx', import.meta.url), 'utf8');
  assert.doesNotMatch(studio, /ACE-Step/);
  assert.match(studio, /\{model\.name\}/);
  assert.doesNotMatch(controls, />\{value\}<\/option>/);
});

test('the Suno Simple brief box shows the typed text untrimmed, so a trailing space can be typed', () => {
  const source = readFileSync(new URL('../app/veyrnox/_components/music/MusicServerStudio.jsx', import.meta.url), 'utf8');
  assert.match(source, /const sunoField = capSunoText\(description, sunoLimit\(model, 'prompt'\)\);/, 'the field value is the capped raw description');
  assert.match(source, /<SunoSimpleFields[^>]*description=\{sunoField\}/, 'the textarea is fed the untrimmed value');
  assert.doesNotMatch(source, /<SunoSimpleFields[^>]*description=\{sunoPrompt\}/, 'the trimmed quote prompt must not feed the box');
  assert.equal(capSunoText('warm lo-fi ', 500), 'warm lo-fi ', 'capping keeps a trailing space');
});

test('an invalid brief or title shows a specific message, not "temporarily unavailable"', () => {
  const source = readFileSync(new URL('../app/veyrnox/_components/music/useMusicServerState.js', import.meta.url), 'utf8');
  assert.match(source, /prompt_invalid: '[^']*brief[^']*'/, 'prompt_invalid has its own message');
  assert.match(source, /title_invalid: '[^']*title[^']*'/, 'title_invalid has its own message');
  assert.doesNotMatch(source.match(/prompt_invalid: '([^']*)'/)[1], /temporarily unavailable/);
});
