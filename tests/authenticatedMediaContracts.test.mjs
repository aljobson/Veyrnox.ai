import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';
import * as film from '../app/veyrnox/_lib/filmStudio.js';
import { capabilityFor, publicCapabilities, lengthsFor } from '../lib/modelCapabilities.js';
import * as contracts from '../app/veyrnox/_lib/authenticatedMedia.js';
import * as mobileLayout from '../lib/veyMobileLayout.js';
import * as pointer from '../lib/veyPointer.js';
import * as narration from '../lib/montageNarration.js';

const require = createRequire(import.meta.url);
const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
function load(path, stubs = {}) {
  const output = { exports: {} };
  const code = ts.transpileModule(read(path), { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS } }).outputText;
  new Function('require', 'module', 'exports', code)(id => id === '../../_lib/authenticatedMedia' ? contracts : stubs[id] || require(id), output, output.exports);
  return output.exports;
}
const record = capabilityFor('bytedance/seedance-2.0-fast');
const caps = publicCapabilities(record);
const model = { id: 'seedance-2.0-fast', name: 'Seedance', kind: 'video', durations: lengthsFor(record), aspects: caps.inputs.aspect_ratio.values, takesPrompt: true, promptMax: caps.inputs.prompt.max };
const fields = { FilmSelect: () => null, FilmField: () => null };
const { FilmSetup } = load('app/veyrnox/_components/film/FilmSetup.js', { '../../_lib/filmStudio': film, './FilmFields': fields });
function find(node, label) {
  if (Array.isArray(node)) return node.map(child => find(child, label)).find(Boolean);
  if (!React.isValidElement(node)) return null;
  return node.props.label === label ? node : find(node.props.children, label);
}

test('Film Setup normalizes incompatible external duration and frame format when a Studio model is selected', () => {
  let current = { ...film.emptyFilm(), stack: { image: 'image-model', imageAccess: 'Studio', video: 'External model', videoAccess: 'External', seconds: '12', aspect: '1:1' } };
  const tree = () => FilmSetup({ film: current, update: next => { current = next; }, models: [model] });
  find(tree(), 'Video workflow').props.onChange('Studio');
  find(tree(), 'Video model').props.onChange(model.id);
  assert.equal(current.stack.seconds, '10');
  assert.equal(current.stack.aspect, '16:9');
  assert.deepEqual(find(tree(), 'Frame format').props.options.map(([value]) => value), model.aspects);
  assert.ok(find(tree(), 'Clip length').props.options.some(([value]) => value === current.stack.seconds));
});

test('normalization is immutable, retains valid settings and leaves external workflows alone', () => {
  const stack = Object.freeze({ video: model.id, videoAccess: 'Studio', seconds: '10', aspect: '9:16', image: 'image' });
  assert.deepEqual(contracts.normalizeFilmStack(stack, 'image', 'new-image', [model]), { ...stack, image: 'new-image' });
  assert.deepEqual(stack, { video: model.id, videoAccess: 'Studio', seconds: '10', aspect: '9:16', image: 'image' });
  const external = { ...stack, videoAccess: 'External', seconds: '12', aspect: '1:1' };
  assert.deepEqual(contracts.normalizeFilmStack(external, 'image', 'new', [model]), { ...external, image: 'new' });
  assert.equal(contracts.normalizeFilmStack({ ...stack, seconds: '12' }, 'video', 'missing', [model]).seconds, '12', 'unknown model never invents a priced capability');
});

test('aspect compatibility reuses declared model facts without inventing constraints for source-derived formats', () => {
  assert.equal(contracts.filmAspectCompatible(model, '1:1'), false);
  assert.equal(contracts.filmAspectCompatible(model, '9:16'), true);
  assert.equal(contracts.filmAspectCompatible(model, undefined), true);
  assert.equal(contracts.filmAspectCompatible({ aspects: [] }, '1:1'), true);
  assert.equal(contracts.filmAspectCompatible({}, '16:9'), true);
});

test('Film handoff explains unsupported aspects and retains prompt, duration, catalog and model guards', () => {
  const { FilmPromptOutput } = load('app/veyrnox/_components/film/FilmPromptOutput.js', {
    'next/navigation': { useRouter: () => ({ push() {} }) }, '../../_lib/landingDraft': { writeStudioDraft() { throw new Error('No writes allowed'); } },
  });
  const props = { title: 'Shot', prompt: 'A lighthouse', access: 'Studio', modelId: model.id, models: [model], live: true, aspect: '9:16', duration: 10 };
  const render = patch => renderToStaticMarkup(React.createElement(FilmPromptOutput, { ...props, ...patch }));
  assert.match(render({}), />Open in Studio</);
  assert.doesNotMatch(render({ aspect: '1:1' }), />Open in Studio</);
  assert.match(render({ aspect: '1:1' }), /does not support.*frame format/i);
  for (const patch of [{ duration: 12 }, { live: false }, { access: 'External' }, { prompt: 'x'.repeat(model.promptMax + 1) }, { models: [{ ...model, gated: true }] }, { models: [{ ...model, takesPlan: true }] }]) assert.doesNotMatch(render(patch), />Open in Studio</);
});

test('Video Agent balance state fails closed for absent, malformed or negative balances and prices', () => {
  for (const balance of [null, undefined, NaN, Infinity, -1, '200']) assert.equal(contracts.videoAgentBalanceState(balance, 165), 'unavailable');
  for (const price of [undefined, NaN, Infinity, -1, '165']) assert.equal(contracts.videoAgentBalanceState(200, price), 'unavailable');
  assert.equal(contracts.videoAgentBalanceState(164, 165), 'insufficient');
  assert.equal(contracts.videoAgentBalanceState(165, 165), 'ready');
  assert.equal(contracts.videoAgentBalanceState(0, 0), 'ready');
});

function agent(balance, loading = false) {
  const nullStates = [balance, { plan_id: 'synthetic-plan', idempotency_key: 'synthetic-key', plan: { summary: 'A shot' }, credits: 165, expires_at: Date.now() / 1000 + 600, brief: 'A lighthouse', aspect: '9:16' }, null];
  let stateIndex = 0;
  const fakeReact = { ...React, useState: initial => [stateIndex++ === 2 ? 'A lighthouse' : initial === null ? nullStates.shift() : initial === true ? loading : initial, () => {}], useEffect() {}, useCallback: fn => fn, useRef: value => ({ current: value }) };
  const { default: Page } = load('app/veyrnox/app/video-agent/page.js', {
    react: fakeReact, 'next/link': 'a', '../../_components/NavBar': { AppNav: () => null }, '../../_components/Main': { Main: 'main' },
    '../../_components/JobAssetPreview': { JobAssetPreview: () => null }, '../../_lib/gateway': { GatewayError: Error },
    '../../_lib/createErrors': { ERROR_COPY: {}, failedJobCopy() {} }, '../../_lib/jobHistory': {}, '../../_lib/videoAgentResume': {},
    '../../_lib/useStudioJobs': { useStudioJobs: () => ({ jobs: [], generating: false }) }, '../../_lib/studioStates': {},
    '../../../../lib/montageNarration.js': narration,
  });
  return renderToStaticMarkup(React.createElement(Page));
}
test('Video Agent offers a read-only balance retry and never enables paid approval until balance is confirmed', () => {
  const approval = html => html.match(/<button[^>]*>Approve and make it[^<]*<\/button>/)?.[0];
  assert.match(approval(agent(null)), /\sdisabled=/);
  assert.match(agent(null), />Retry balance</);
  assert.doesNotMatch(agent(null), /You need 165 more/);
  assert.match(approval(agent(200, true)), /\sdisabled=/);
  assert.doesNotMatch(approval(agent(200)), /\sdisabled=/);
  assert.match(approval(agent(164)), /\sdisabled=/);
  const source = read('app/veyrnox/app/video-agent/page.js');
  assert.match(source, /catch\s*\{\s*if \(request === balanceRequest\.current\) setBalance\(null\)/);
  assert.match(source, /onClick=\{refreshBalance\}/);
});

test('the browser-storage notice remains above the full-screen editor so its acknowledgement is reachable', () => {
  const fakeReact = { ...React, useState: initial => [initial, () => {}], useSyncExternalStore: () => true, useEffect() {}, useCallback: fn => fn, useRef: value => ({ current: value }) };
  const { default: SiteChrome } = load('app/veyrnox/_components/SiteChrome.js', {
    react: fakeReact, 'next/link': 'a', '../_lib/tokens': { SUPPORT_EMAIL: 'synthetic@example.invalid' },
    '../_lib/utm': {}, './ThemeToggle': {}, './ReferralBridge': () => null, './Icon': { Icon: 'span' },
    '../../../components/I18nProvider': { useI18n: () => ({ locale: 'en', t: Object.assign((key) => key, { messages: {}, label: (label) => label }), href: (path) => path }) },
  });
  const notice = SiteChrome({}).props.children.find(child => React.isValidElement(child) && child.props.className?.includes('bottom-0'));
  assert.ok(notice, 'The unread notice is rendered');
  const noticeLayer = notice.props.className.match(/\bz-(?:\[(\d+)\]|(\d+))\b/) || notice.props.className.match(/\bz-\[(\d+)\]/);
  const editorLayer = read('app/veyrnox/_components/editor/MultitrackWorkspace.js').match(/fixed inset-0 z-\[(\d+)\]/);
  assert.ok(noticeLayer); assert.ok(editorLayer);
  assert.ok(Number(noticeLayer[1] || noticeLayer[2]) > Number(editorLayer[1]), 'A first-visit storage notice must be clickable above the full-screen editor');
});

test('the closed mobile assistant docks above the editor section controls without hiding the assistant', () => {
  const effects = []; let layout;
  const fakeReact = { useState: initial => [initial, next => { layout = typeof next === 'function' ? next(layout) : next; }], useRef: current => ({ current }), useEffect: effect => { effects.push(effect); } };
  const { default: useLayout } = load('app/veyrnox/_lib/useVeyMobileLayout.js', {
    react: fakeReact, '../../../lib/veyPointer': pointer, '../../../lib/veyMobileLayout': mobileLayout,
  });
  const nav = { getBoundingClientRect: () => ({ left: 8, right: 382, top: 788, bottom: 836, width: 374, height: 48 }), matches: () => false };
  const mocks = {
    innerWidth: 390, innerHeight: 844, requestAnimationFrame: callback => { callback(); return 1; }, cancelAnimationFrame() {},
    ResizeObserver: class { observe() {} disconnect() {} }, MutationObserver: class { observe() {} disconnect() {} },
    document: { documentElement: { style: {} }, body: {}, querySelector: selector => selector.includes('Mobile editor sections') ? nav : null },
    window: { addEventListener() {}, removeEventListener() {} },
  };
  const previous = Object.fromEntries(Object.keys(mocks).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  try {
    for (const [key, value] of Object.entries(mocks)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
    useLayout({ open: false, pathname: '/app/editor', position: { x: 8, y: 774 }, facing: 1 });
    const cleanup = effects.at(-1)();
    assert.ok(layout.docked, 'The assistant remains visible in its stable dock');
    assert.ok(layout.position.y + pointer.VEY_SIZE.height < nav.getBoundingClientRect().top, 'The assistant must not cover the editor Media button');
    cleanup();
  } finally {
    for (const [key, descriptor] of Object.entries(previous)) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; }
  }
});

test('the compact mobile project-file menu is viewport anchored instead of clipped left of its Files button', () => {
  const fakeReact = { useState: initial => [initial, () => {}], useEffect() {}, useRef: current => ({ current }) };
  const { ProjectFileControls } = load('app/veyrnox/_components/editor/ProjectFileControls.js', {
    react: fakeReact, '../Button': { Button: 'button' }, '../../_lib/editorProjectFile.mjs': {},
  });
  const menu = ProjectFileControls({ tl: {}, onLoadTimeline() {}, compact: true }).props.children[1];
  assert.match(menu.props.className, /(?:^|\s)fixed(?:\s|$)/);
  assert.match(menu.props.className, /(?:^|\s)inset-x-4(?:\s|$)/);
  assert.match(menu.props.className, /sm:absolute/);
});
