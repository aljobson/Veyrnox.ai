import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';
import React from 'react';

const require = createRequire(import.meta.url);
const file = 'app/veyrnox/_components/music/MusicReferenceImporter.jsx';
const nodes = (node) => !node || typeof node !== 'object' ? [] : [
  node,
  ...(typeof node.type === 'function' ? nodes(node.type(node.props)) : React.Children.toArray(node.props?.children).flatMap(nodes)),
];
const text = (node) => typeof node === 'string' ? node : !node || typeof node !== 'object' ? ''
  : typeof node.type === 'function' ? text(node.type(node.props)) : React.Children.toArray(node.props?.children).map(text).join(' ');

function harness({ signedIn = false, referencesEnabled = true, sourcesEnabled = true, gatewayFetch = async () => ({ links: [] }) } = {}) {
  let cursor = 0;
  let effects = [];
  let userId = signedIn ? 'user-a' : null;
  let sessionListener = null;
  const values = [];
  const hooks = {
    ...React,
    useState(initial) {
      const index = cursor++;
      if (!(index in values)) values[index] = initial;
      return [values[index], (next) => { values[index] = typeof next === 'function' ? next(values[index]) : next; }];
    },
    useRef(initial) {
      const index = cursor++;
      if (!(index in values)) values[index] = { current: initial };
      return values[index];
    },
    useEffect(effect) { effects.push(effect); },
  };
  const source = `${readFileSync(file, 'utf8')}\nexport { ReferenceArtwork, ReferenceCard, safeEmbedUrl };`;
  const js = ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText;
  const loaded = { exports: {} };
  const imports = {
    react: hooks,
    'next/link': { __esModule: true, default: 'a' },
    '../../../lib/authClient': {
      getSession: () => userId ? { access_token: 'test', user: { id: userId } } : null,
      getStoredUserId: () => userId,
      onSessionChange: (listener) => { sessionListener = listener; return () => { sessionListener = null; }; },
    },
    '../../_lib/gateway': { gatewayFetch },
  };
  new Function('require', 'module', 'exports', js)((id) => imports[id] ?? require(id), loaded, loaded.exports);
  return {
    exports: loaded.exports,
    renderImporter() { cursor = 0; effects = []; return loaded.exports.MusicReferenceImporter({ referencesEnabled, sourcesEnabled }); },
    async runEffects() { for (const effect of effects) effect(); await new Promise((resolve) => setImmediate(resolve)); },
    switchUser(nextUserId) { userId = nextUserId; sessionListener?.(userId ? { user: { id: userId } } : null); },
  };
}

const reference = {
  id: '22222222-2222-4222-8222-222222222222',
  provider: 'youtube',
  title: 'Public track',
  creator: 'Public creator',
  canonical_url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
  thumbnail_url: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg',
  embed_url: 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?autoplay=0&playsinline=1',
  rights_mode: 'inspiration',
};

async function loadSignedIn(ui) {
  ui.renderImporter(); await ui.runEffects();
  ui.renderImporter(); await ui.runEffects();
  return ui.renderImporter();
}

test('reference cards load the exact official player only after a click-selected state', () => {
  const { ReferenceCard } = harness().exports;
  const base = { reference, removing: false, sourcesEnabled: true, onOpenPlayer() {}, onAskRemove() {}, onRemove() {}, onCancelRemove() {} };
  const artwork = ReferenceCard({ ...base, active: false });
  assert.equal(nodes(artwork).some((node) => node.type === 'iframe'), false);
  assert.ok(nodes(artwork).some((node) => node.type === 'button' && /Open official YouTube player/.test(node.props['aria-label'] || '')));
  const image = nodes(artwork).find((node) => node.type === 'img');
  assert.equal(image.props.loading, 'lazy');
  assert.equal(image.props.decoding, 'async');

  const player = ReferenceCard({ ...base, active: true });
  const iframe = nodes(player).find((node) => node.type === 'iframe');
  assert.equal(iframe.props.src, reference.embed_url);
  assert.doesNotMatch(iframe.props.allow, /autoplay/);
  assert.match(text(player), /Saved for inspiration only/);
  assert.doesNotMatch(text(player), /Upload owned master/);
});

test('reference cards survive malformed stored embeds and expose owned/removal actions correctly', () => {
  let action = '';
  const { ReferenceCard } = harness().exports;
  const props = {
    reference: { ...reference, embed_url: 'https://evil.test/player', rights_mode: 'owned_or_licensed' },
    sourcesEnabled: true,
    active: true,
    removing: true,
    onOpenPlayer() { action = 'open'; },
    onAskRemove() { action = 'ask'; },
    onRemove() { action = 'remove'; },
    onCancelRemove() { action = 'cancel'; },
  };
  const tree = ReferenceCard(props);
  assert.equal(nodes(tree).some((node) => node.type === 'iframe'), false);
  assert.match(text(tree), /Upload owned master/);
  const confirm = nodes(tree).find((node) => node.type === 'button' && text(node) === 'Confirm remove');
  const cancel = nodes(tree).find((node) => node.type === 'button' && text(node) === 'Cancel');
  confirm.props.onClick(); assert.equal(action, 'remove');
  cancel.props.onClick(); assert.equal(action, 'cancel');
});

test('owned cards do not promise an upload while Music sources are disabled', () => {
  const { ReferenceCard } = harness().exports;
  const tree = ReferenceCard({
    reference: { ...reference, rights_mode: 'owned_or_licensed' }, active: false, removing: false, sourcesEnabled: false,
    onOpenPlayer() {}, onAskRemove() {}, onRemove() {}, onCancelRemove() {},
  });
  assert.doesNotMatch(text(tree), /Upload owned master/);
  assert.match(text(tree), /upload is not available yet/);
});

test('owned-use selection stays disabled until the explicit rights confirmation', () => {
  const ui = harness();
  let tree = ui.renderImporter();
  const url = nodes(tree).find((node) => node.type === 'input' && node.props.type === 'url');
  url.props.onChange({ target: { value: 'https://youtu.be/dQw4w9WgXcQ' } });
  tree = ui.renderImporter();
  assert.equal(nodes(tree).find((node) => node.type === 'button' && text(node) === 'Sign in to save').props.disabled, false);

  const owned = nodes(tree).find((node) => node.type === 'input' && node.props.value === 'owned_or_licensed');
  owned.props.onChange();
  tree = ui.renderImporter();
  const confirm = nodes(tree).find((node) => node.type === 'input' && node.props.type === 'checkbox');
  assert.equal(nodes(tree).find((node) => node.type === 'button' && text(node) === 'Sign in to save').props.disabled, true);
  confirm.props.onChange({ target: { checked: true } });
  tree = ui.renderImporter();
  assert.equal(nodes(tree).find((node) => node.type === 'button' && text(node) === 'Sign in to save').props.disabled, false);
});

test('disabled reference rollout renders and fetches nothing before its migration lands', async () => {
  let reads = 0;
  const ui = harness({ signedIn: true, referencesEnabled: false, gatewayFetch: async () => { reads += 1; return { links: [reference] }; } });
  const tree = await loadSignedIn(ui);
  assert.equal(tree, null);
  assert.equal(reads, 0);
});

test('switching accounts hides the previous private shelf before the next fetch settles', async () => {
  let reads = 0;
  const ui = harness({ signedIn: true, gatewayFetch: async () => {
    reads += 1;
    if (reads === 1) return { links: [reference] };
    throw { code: 'network_error' };
  } });
  let tree = await loadSignedIn(ui);
  assert.match(text(tree), /Public track/);
  ui.switchUser('user-b');
  tree = ui.renderImporter();
  assert.equal(nodes(tree).some((node) => node.type === 'h3' && text(node) === 'Public track'), false);
  await ui.runEffects();
  tree = ui.renderImporter();
  assert.equal(nodes(tree).some((node) => node.type === 'h3' && text(node) === 'Public track'), false);
  assert.match(text(tree), /could not be loaded/);
});

test('add retries reuse one idempotency key, then render provider attribution and reset the form', async () => {
  const posts = [];
  const ui = harness({ signedIn: true, gatewayFetch: async (path, init = {}) => {
    if (!init.method) return { links: [] };
    if (init.method === 'POST') {
      posts.push(JSON.parse(init.body));
      if (posts.length === 1) throw { code: 'rate_limited' };
      return { link: reference };
    }
    throw new Error(`unexpected ${path}`);
  } });
  let tree = await loadSignedIn(ui);
  nodes(tree).find((node) => node.type === 'input' && node.props.type === 'url').props.onChange({ target: { value: 'https://youtu.be/dQw4w9WgXcQ' } });
  tree = ui.renderImporter();
  await nodes(tree).find((node) => node.type === 'form').props.onSubmit({ preventDefault() {} });
  tree = ui.renderImporter();
  assert.match(text(tree), /Too many changes at once/);
  await nodes(tree).find((node) => node.type === 'form').props.onSubmit({ preventDefault() {} });
  assert.equal(posts.length, 2);
  assert.equal(posts[0].idempotency_key, posts[1].idempotency_key);
  tree = ui.renderImporter();
  assert.equal(nodes(tree).find((node) => node.type === 'input' && node.props.type === 'url').props.value, '');
  assert.ok(nodes(tree).some((node) => node.type === 'span' && text(node) === 'YouTube'));
  const attribution = nodes(tree).find((node) => node.type === 'a' && text(node).replace(/\s+/g, ' ').trim() === 'Open on YouTube');
  assert.equal(attribution.props.href, reference.canonical_url);
});

test('a stale removal is treated as already gone and removes the private card locally', async () => {
  const ui = harness({ signedIn: true, gatewayFetch: async (_path, init = {}) => {
    if (!init.method) return { links: [reference] };
    throw { code: 'reference_not_found' };
  } });
  let tree = await loadSignedIn(ui);
  nodes(tree).find((node) => node.type === 'button' && text(node) === 'Remove').props.onClick();
  tree = ui.renderImporter();
  await nodes(tree).find((node) => node.type === 'button' && text(node) === 'Confirm remove').props.onClick();
  tree = ui.renderImporter();
  assert.equal(nodes(tree).some((node) => node.type === 'h3' && text(node) === 'Public track'), false);
  assert.match(text(tree), /already removed/);
});
