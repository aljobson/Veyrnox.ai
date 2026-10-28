import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';
import * as helpers from '../app/veyrnox/_lib/publishQueueAccounts.js';
import { translator } from '../lib/i18n/translate.mjs';
import messages from '../lib/i18n/messages/app/en/publish-queues.mjs';

const { queueAccountEligible, splitQueueAccounts, queueSaveAccountIds } = helpers;
const active = id => ({ id, status: 'active', network: 'instagram', display_name: id });
const accounts = [active('A'), { ...active('B'), publishingEnabled: false },
  ...['revoked', 'expired', 'error'].map(status => ({ ...active(status), status }))];
const source = readFileSync(new URL('../app/veyrnox/app/publish/queues/page.js', import.meta.url), 'utf8');

test('queue accounts preserve saved order and explain every exclusion', () => {
  const ids = ['unknown', 'B', 'A', 'error', 'revoked', 'expired'];
  assert.equal(queueAccountEligible(undefined), false);
  assert.equal(queueAccountEligible(active('A')), true);
  assert.equal(queueAccountEligible({ ...active('A'), publishingEnabled: true }), true);
  assert.deepEqual(splitQueueAccounts(ids, accounts), {
    selected: ['A'],
    excluded: [
      { id: 'unknown', account: null, reason: null },
      { id: 'B', account: accounts[1], reason: 'publishingOff' },
      ...[4, 2, 3].map(index => ({ id: accounts[index].id, account: accounts[index], reason: 'disconnected' })),
    ],
  });
  assert.deepEqual(queueSaveAccountIds(ids, accounts), ['A']);
  assert.deepEqual(queueSaveAccountIds(['C', 'A'], [...accounts, active('C')]), ['C', 'A']);
  assert.deepEqual(splitQueueAccounts([], []), { selected: [], excluded: [] });
});

test('the editor stores all accounts, filters the payload, and exposes translated exclusions', () => {
  assert.match(source, /import\s*\{[^}]*splitQueueAccounts[^}]*queueSaveAccountIds[^}]*\}/);
  assert.match(source, /accountIds:\s*queueSaveAccountIds\(/);
  assert.doesNotMatch(source, /\.filter\(\(item\)=>item.status==='active'/);
  for (const key of ['excludedTitle', 'reason.publishingOff', 'reason.disconnected', 'unknownAccounts', 'excludedNote', 'excludedAccount'])
    assert.ok(source.includes(`app.publish.queues.${key}`), key);
});

// Exercise the real page handlers with persistent hook state and controlled API replies.
// JSX is kept as an element tree so tests can click the same controls the user sees.
function editor(initialAccounts = [active('A'), active('B')], savedIds = ['A', 'B']) {
  const state = [], effects = [];
  let cursor = 0, first = true, currentAccounts = initialAccounts, saveError = false;
  const sent = [];
  const t = translator('en', messages);
  const react = {
    createElement: (type, props, ...children) => ({ type, props: { ...props, children: children.flat(Infinity) } }),
    useState(initial) {
      const index = cursor++;
      if (!(index in state)) state[index] = typeof initial === 'function' ? initial() : initial;
      return [state[index], update => { state[index] = typeof update === 'function' ? update(state[index]) : update; }];
    },
    useCallback: callback => callback,
    useEffect: callback => { if (first) effects.push(callback); },
  };
  const require = createRequire(import.meta.url);
  const mocks = {
    react,
    '../../../../../components/I18nProvider': { useI18n: () => ({ t, locale: 'en' }) },
    '../../../../../lib/i18n/translate.mjs': { pluralKey: () => 'app.publish.queues.slots.other', tOr: (translate, key, fallback) => translate.messages[key] ? translate(key) : fallback },
    '../../../../../lib/i18n/locales.mjs': { localeTag: () => 'en' },
    '../../../_lib/publishPresentation': { canEditPublishing: role => role === 'owner' },
    '../../../_lib/publishQueueAccounts': helpers,
    '../../../../lib/socialConnectClient': { listSocialAccounts: async () => ({ accounts: currentAccounts, brandRole: 'owner' }) },
    '../../../../lib/socialQueuesClient': {
      listSocialQueues: async () => ({ queues: [{ id: 'q', name: 'Queue AB', timezone: 'UTC', enabled: true, account_ids: savedIds, slots: [{ weekday: 1, minute: 540 }] }] }),
      saveSocialQueue: async payload => { sent.push(payload); if (saveError) throw Error('save failed'); return { queue_id: 'q' }; },
    },
  };
  const compiled = ts.transpileModule(source + '\nexport { Queues };', { compilerOptions: { jsx: ts.JsxEmit.React, jsxFactory: 'React.createElement', module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', 'React', compiled)(id => mocks[id] || (id === 'react/jsx-runtime' ? require(id) : {}), module, module.exports, react);
  let tree;
  function render() { cursor = 0; tree = module.exports.Queues(); first = false; return tree; }
  function nodes(node = tree) { return node && typeof node === 'object' ? [node, ...(node.props?.children || []).flatMap(child => nodes(child))] : []; }
  function text(node) { return typeof node === 'string' ? node : (node?.props?.children || []).map(text).join(''); }
  function button(label) { const buttons = nodes().filter(node => node.type === 'button'); const found = buttons.find(node => text(node) === label) || buttons.find(node => text(node).includes(label)); assert.ok(found, `button: ${label}`); return found; }
  async function click(label) { await button(label).props.onClick(); render(); }
  render();
  return {
    async ready() { for (const effect of effects) effect(); await new Promise(resolve => setImmediate(resolve)); render(); await click('Queue AB'); },
    reload: () => click('recovery.retry'), click, sent,
    setAccounts: value => { currentAccounts = value; },
    failSave: value => { saveError = value; },
    selected: () => nodes().filter(node => node.type === 'button' && node.props['aria-pressed']).map(text),
    text: () => text(tree), nodes,
  };
}

test('Retry removes newly disconnected selections and save sends only eligible accounts', async () => {
  const page = editor(); await page.ready();
  assert.deepEqual(page.selected(), ['A', 'B']);
  page.failSave(true); await page.click('Save queue');
  page.setAccounts([active('A'), { ...active('B'), status: 'revoked' }]);
  await page.reload();
  assert.deepEqual(page.selected(), ['A']);
  assert.match(page.text(), /instagram · B · Disconnected/);
  page.failSave(false); await page.click('Save queue');
  assert.deepEqual(page.sent.at(-1).accountIds, ['A']);
  assert.doesNotMatch(page.text(), /Not kept on save/);
});

test('Retry preserves explicit deselection after a save error', async () => {
  const page = editor(); await page.ready();
  await page.click('B');
  page.failSave(true); await page.click('Save queue');
  await page.reload();
  assert.deepEqual(page.selected(), ['A']);
  assert.doesNotMatch(page.text(), /Not kept on save/);
});

test('reconnected exclusions require a new selection; empty filtered saves fail locally', async () => {
  const page = editor([{ ...active('B'), status: 'expired' }], ['B']); await page.ready();
  assert.deepEqual(page.selected(), []);
  await page.click('Save queue');
  assert.equal(page.sent.length, 0);
  assert.match(page.text(), /Choose at least one connected account/);
  page.setAccounts([active('B')]); await page.reload();
  assert.deepEqual(page.selected(), []);
  assert.doesNotMatch(page.text(), /Not kept on save/);
  await page.click('B'); assert.deepEqual(page.selected(), ['B']);
});

test('exclusions are noninteractive text, and New queue clears them', async () => {
  const page = editor(accounts, ['A', 'B', 'unknown']); await page.ready();
  assert.match(page.text(), /instagram · B · Publishing is off/);
  assert.match(page.text(), /Unknown accounts: 1/);
  const row = page.nodes().find(node => node.type === 'li' && node.props.children.some(child => typeof child === 'string' && child.includes('Publishing is off')));
  assert.ok(row);
  assert.equal(row.props.tabIndex, undefined);
  assert.equal(row.props.onClick, undefined);
  await page.click('New queue');
  assert.doesNotMatch(page.text(), /Not kept on save/);
});
