import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';
import { musicDailyChallengeAt } from '../lib/musicDailyChallenge.js';
import * as templates from '../lib/licensedTrackTemplates.js';

const require = createRequire(import.meta.url);
function load(relative, imports = {}) {
  const source = readFileSync(new URL(`../${relative}`, import.meta.url), 'utf8');
  const code = ts.transpileModule(source, {
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const loaded = { exports: {} };
  new Function('require', 'module', 'exports', code)(id => imports[id]
    ?? (id === 'react' || id === 'react/jsx-runtime' ? require(id) : {}), loaded, loaded.exports);
  return loaded.exports;
}

function Link({ href, children, ...props }) {
  const value = typeof href === 'string' ? href : `${href.pathname}?${new URLSearchParams(href.query).toString()}`;
  return React.createElement('a', { ...props, href: value }, children);
}

const discover = load('app/veyrnox/_components/music/MusicDiscover.jsx', {
  react: React,
  'next/image': { __esModule: true, default: props => React.createElement('img', { alt: props.alt || '' }) },
  'next/link': { __esModule: true, default: Link },
  '../../../../lib/musicDiscover.js': {
    MUSIC_DISCOVER_BEATS: [], MUSIC_DISCOVER_LISTED_BEATS: [], MUSIC_DISCOVER_MOODS: ['All'],
    MUSIC_DISCOVER_SECTIONS: [], normalizeMusicSampleMix: value => value,
  },
  '../../../lib/authClient.js': { getStoredUserId: () => null },
  '../../_lib/music/savedMixes.js': { MUSIC_SAVED_MIXES_CHANGED: 'changed', saveMusicSavedMix: () => null },
  './LicensedMusicLibrary.jsx': { LicensedMusicLibrary: () => null },
  './MusicBestOf': { MusicBestOf: () => null },
  '../../../../components/I18nProvider': { useI18n: () => ({ t: key => key }) },
  '../../../../lib/i18n/translate.mjs': { tOr: (t, key, fallback) => key || fallback },
});

test('Discover renders no challenge while off and an exact editable handoff while on', () => {
  const off = renderToStaticMarkup(React.createElement(discover.MusicDiscover));
  assert.doesNotMatch(off, /music-daily-challenge/);
  const challenge = musicDailyChallengeAt('2026-11-24T12:00:00.000Z');
  const on = renderToStaticMarkup(React.createElement(discover.MusicDiscover, { dailyChallenge: challenge }));
  assert.match(on, /data-testid="music-daily-challenge"/);
  assert.match(on, new RegExp(challenge.title_key.replaceAll('.', '\\.')));
  assert.match(on, new RegExp(`challenge=${encodeURIComponent(challenge.id)}`));
  assert.match(on, /music\.dailyChallenge\.noReward/);
});

let challengeFlag = false;
const createPage = load('app/veyrnox/app/music/create/page.js', {
  '../../../_components/music/MusicCreateStudio': { MusicCreateStudio: () => null },
  '../../../../../lib/i18n/server': { getT: async () => ({ t: key => key }) },
  '../../../../../lib/musicBackend.js': { musicUiEnabled: () => true, musicSourcesEnabled: () => true },
  '../../../../../lib/musicDiscover.js': {
    getMusicDiscoverSeed: id => id === 'sample-one' ? { id } : null,
    normalizeMusicSampleMix: value => value,
  },
  '../../../../../lib/licensedTrackTemplates.js': { licensedTemplateFor: id => id === 'template-one' ? { id, direction: 'template' } : null },
  '../../../../../lib/musicRuntime.js': { musicRuntimeFlag: name => name === 'dailyChallenge' && challengeFlag },
  '../../../../../lib/musicDailyChallenge.js': await import('../lib/musicDailyChallenge.js'),
});

test('Create ignores flag-off and stale challenge links and preserves sample/template precedence', async () => {
  const current = musicDailyChallengeAt();
  const stale = musicDailyChallengeAt(Date.now() - 86400000);
  challengeFlag = false;
  assert.equal((await createPage.default({ searchParams: { challenge: current.id } })).props.challengeSeed, null);
  challengeFlag = true;
  assert.equal((await createPage.default({ searchParams: { challenge: stale.id } })).props.challengeSeed, null);
  assert.equal((await createPage.default({ searchParams: { challenge: current.id } })).props.challengeSeed.id, current.id);
  assert.equal((await createPage.default({ searchParams: { challenge: current.id, sample: 'sample-one' } })).props.challengeSeed, null);
  assert.equal((await createPage.default({ searchParams: { challenge: current.id, template: 'template-one' } })).props.challengeSeed, null);
});

function* elements(node) {
  if (Array.isArray(node)) { for (const child of node) yield* elements(child); }
  else if (node?.props) { yield node; yield* elements(node.props.children); }
}

function studioHarness(challengeSeed) {
  let cursor = 0, dirty = false, effects = [];
  const slots = [], timers = [], store = new Map([['veyrnox.music.public-draft.v1', JSON.stringify({ prompt: 'stored public prompt' })]]);
  const memo = (make, deps) => {
    const index = cursor++, old = slots[index];
    if (!old || deps.some((value, at) => !Object.is(value, old.deps[at]))) slots[index] = { deps, value: make() };
    return slots[index].value;
  };
  const hooks = {
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) {
        const slot = { value: typeof initial === 'function' ? initial() : initial };
        slot.set = next => { next = typeof next === 'function' ? next(slot.value) : next; if (!Object.is(next, slot.value)) { slot.value = next; dirty = true; } };
        slots[index] = slot;
      }
      return [slots[index].value, slots[index].set];
    },
    useMemo: memo,
    useRef: value => memo(() => ({ current: value }), []),
    useEffect: (effect, deps) => memo(() => { effects.push(effect); }, deps),
  };
  const model = { id: 'ace', name: 'ACE', available: true, generation_modes: ['simple'], controls: { description: true, duration_seconds: null, instrumental: 'required' } };
  const server = { entitlements: { available: true, balance: 10, concurrency_limit: 4, models: [model] }, quote: null, generations: [], busy: '', error: '', errorCode: '',
    clearQuote() {}, quoteRevisionNow: () => 0, reviewQuote: async () => {}, confirmQuote: async () => {}, refreshGeneration: async () => {}, reload: async () => {} };
  const custom = { loaded: true, status: 'saved', conflict: null, draft: { model_id: 'ace', title: '', lyrics: '', styles: '', revision: 0 } };
  const compiled = load('app/veyrnox/_components/music/MusicServerStudio.jsx', {
    react: hooks,
    '../../../lib/authClient': { getStoredUserId: () => null },
    './useMusicServerState': { useMusicServerState: () => server },
    './useMusicDuration': { useMusicDuration: () => [60, () => {}] },
    './useMusicCustomDraft': { useMusicCustomDraft: () => custom },
    './MusicTempoKeyControls': { tempoKeyInvalid: () => false, tempoKeyQuoteFields: () => ({}) },
    '../../../../lib/licensedTrackTemplates.js': templates,
    '../../../../lib/musicDiscover.js': { buildMusicSamplePrompt: () => '', MUSIC_SAMPLE_DIRECTION_MAX: 200 },
    './MusicPublicPrompt': { MUSIC_PUBLIC_DRAFT_KEY: 'veyrnox.music.public-draft.v1' },
    './musicLyricHandoff': { readMusicLyricHandoff: () => null },
    '../../../../components/I18nProvider': { useI18n: () => ({ t: key => `translated:${key}`, locale: 'en' }) },
    '../../../../lib/i18n/translate.mjs': { pluralKey: () => 'credits', tOr: (_t, _key, fallback) => fallback },
    './musicSunoForm': { capSunoText: value => value, isSunoContract: () => false, SUNO_CONTROL_DEFAULTS: {}, sunoLimit: () => 500 },
    './musicWriting': { MUSIC_LYRIC_ASSISTANT_REQUEST_MAX: 500, MUSIC_STRUCTURE_LABELS: [], musicWritingReferences: () => [], nextMusicPrompt: value => value },
  });
  const previous = { window: globalThis.window, sessionStorage: globalThis.sessionStorage };
  const storage = { getItem: key => store.get(key) ?? null, removeItem: key => store.delete(key) };
  globalThis.sessionStorage = storage;
  globalThis.window = { location: { search: '' }, sessionStorage: storage, setTimeout: fn => { timers.push(fn); return timers.length; }, clearTimeout() {} };
  return {
    render() {
      let tree, attempts = 0;
      do {
        assert.ok(++attempts < 10, 'effects settle'); cursor = 0; dirty = false; effects = [];
        tree = compiled.MusicServerStudio({ challengeSeed });
        for (const effect of effects) effect();
      } while (dirty);
      return tree;
    },
    runTimers() { for (const timer of timers.splice(0)) timer(); },
    prompt(tree) { return [...elements(tree)].find(element => element.type === 'textarea' && element.props.maxLength === 500)?.props.value; },
    stored: () => store.get('veyrnox.music.public-draft.v1'),
    restore() { globalThis.window = previous.window; globalThis.sessionStorage = previous.sessionStorage; },
  };
}

test('the deferred stored draft is consumed but cannot replace a challenge prompt', t => {
  const challenge = musicDailyChallengeAt('2026-11-24T12:00:00.000Z');
  const withChallenge = studioHarness(challenge);
  t.after(() => withChallenge.restore());
  let tree = withChallenge.render();
  assert.equal(withChallenge.prompt(tree), `translated:${challenge.prompt_key}`);
  withChallenge.runTimers(); tree = withChallenge.render();
  assert.equal(withChallenge.prompt(tree), `translated:${challenge.prompt_key}`);
  assert.equal(withChallenge.stored(), undefined);
});

test('without an explicit handoff the deferred stored draft still restores', t => {
  const stored = studioHarness(null);
  t.after(() => stored.restore());
  let tree = stored.render();
  assert.equal(stored.prompt(tree), '');
  stored.runTimers(); tree = stored.render();
  assert.equal(stored.prompt(tree), 'stored public prompt');
  assert.equal(stored.stored(), undefined);
});
