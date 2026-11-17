import test from 'node:test';
import assert from 'node:assert/strict';
import { harness, elements, find, button } from './helpers/musicBeatComponentHarness.mjs';
import * as templates from '../app/veyrnox/_lib/music/beat/beatTemplates.mjs';
import * as documentModule from '../app/veyrnox/_lib/music/beat/beatDocument.mjs';
import * as ops from '../app/veyrnox/_lib/music/beat/beatOps.mjs';
import * as summary from '../app/veyrnox/_lib/music/beat/beatTrackSummary.mjs';
import * as ai from '../app/veyrnox/_lib/music/beat/beatAi.mjs';
import * as audio from '../app/veyrnox/_lib/music/beat/beatAudioSegments.mjs';
import * as shortcuts from '../app/veyrnox/_lib/music/beat/beatShortcuts.mjs';
import { createBeatTipSession } from '../app/veyrnox/_lib/music/beat/beatCoachMarks.mjs';

const placeholder = () => null;
function home(h, account, error) {
  return h.load('BeatsHome', {
    'next/link': { default: placeholder }, 'next/navigation': { useRouter: () => ({ push() { assert.fail('failed creation must not navigate'); } }) },
    './BeatTemplatePicker': { default: placeholder }, './useBeatAccountList': { useBeatAccountList: account },
    '../../../_lib/music/beat/beatTemplates.mjs': templates,
    '../../../_lib/music/beat/beatDocument.mjs': documentModule,
    '../../../_lib/music/beat/beatOps.mjs': ops,
    '../../../_lib/music/beat/beatTrackSummary.mjs': summary,
    '../../../_lib/music/beat/beatStore.js': { listBeats: async () => ({ records: [], count: 0, persistent: true }), subscribeBeats: () => () => {}, createBeat: async () => ({ error }) },
  }).default;
}
for (const error of ['limit', 'storage']) test(`creation ${error} closes the picker and exposes the failure`, async () => {
  const h = harness(), Home = home(h, () => ({ rows: [], loaded: true, userId() {} }), error);
  h.render(() => Home({}));
  const picker = { open: false, showModal() { this.open = true; }, close() { this.open = false; } };
  find(h.tree, n => n.type === 'dialog').props.ref.current = picker;
  await h.settle(); button(h.tree, 'New beat').props.onClick(); assert.equal(picker.open, true);
  await find(h.tree, n => n.props.choose).props.choose('blank'); await h.settle();
  assert.equal(picker.open, false);
  const message = find(h.tree, n => n.props['aria-live'] === 'polite').props.children;
  assert.equal(message, error === 'limit' ? 'This device has 50 beats. Delete one to make room.' : 'Could not create this beat.');
  assert.equal(button(h.tree, 'New beat').props.disabled, false); h.close();
});
test('failed cloud listing still offers empty-device templates and Retry', async () => {
  const h = harness();
  const { useBeatAccountList } = h.load('useBeatAccountList', {
    '../../../../lib/authClient.js': { getStoredUserId: () => 'user', onSessionChange: () => () => {} },
    '../../../_lib/music/beat/beatCloud.js': { listCloudBeats: async () => { throw Error('offline'); } },
    '../../../_lib/music/beat/beatDocument.mjs': documentModule, '../../../_lib/music/beat/beatStore.js': {},
  }, 'js');
  const Home = home(h, useBeatAccountList); h.render(() => Home({ cloud: true })); await h.settle();
  assert.ok(find(h.tree, n => n.type === 'h2' && n.props.children === 'Make your first beat'));
  assert.equal([...elements(h.tree)].filter(n => n.props.choose).length, 2);
  assert.ok(button(h.tree, 'Retry'));
  assert.ok(find(h.tree, n => n.props.role === 'status' && n.props.children[0] === 'Could not load account beats. Connect to the internet and Retry.'));
  h.close();
});
test('replay closes the sheet and restores its opener before focusing tips; Escape returns to Shortcuts', t => {
  const h = harness(), Sheet = h.load('BeatShortcutSheet', { '../../../_lib/music/beat/beatShortcuts.mjs': shortcuts }).default;
  const old = globalThis.document;
  const doc = { activeElement: null, querySelectorAll: selector => selector.startsWith('[data-feature-tour]') ? (dialog.open ? [dialog] : []) : [target] };
  globalThis.document = doc; t.after(() => { h.close(); globalThis.document = old; });
  const focusable = () => ({ isConnected: true, focus() { doc.activeElement = this; } });
  const opener = focusable(), replay = focusable(), primary = focusable();
  const target = { getClientRects: () => [1], getBoundingClientRect: () => ({ top: 10, left: 10, bottom: 54, right: 54, width: 44, height: 44 }) };
  let open = true, session, replays = 0, closeQueued = false;
  const dialog = { open: false, showModal() { this.open = true; replay.focus(); }, close() { if (this.open) { this.open = false; closeQueued = true; } } };
  const props = () => ({ open, close: () => { open = false; }, replayTips() {
    replays++; assert.equal(dialog.open, false); assert.equal(document.activeElement, opener);
    session = createBeatTipSession({ doc, viewport: () => ({ width: 375, height: 700 }), userId: 'one', replay: true, show() {}, focusPrimary: () => primary.focus() }); session.update();
  } });
  opener.focus(); h.render(() => Sheet(props())); h.tree.props.ref.current = dialog; h.effects();
  assert.equal(document.activeElement, replay);
  button(h.tree, 'Show tips again').props.onClick(); assert.equal(replays, 0); assert.equal(closeQueued, true);
  h.tree.props.onClose(); h.render(); h.effects();
  assert.equal(replays, 1); assert.equal(document.activeElement, primary);
  session.escape({ key: 'Escape', preventDefault() {}, stopPropagation() {} }); assert.equal(document.activeElement, opener);
});
for (const op of ['generate', 'extend', 'replace']) test(`${op} prompt validation waits for touch and appears once with its operation wording`, async () => {
  const h = harness();
  const asset = { ref: { versionId: 'v1' }, durationSec: 10 }, region = { start: 0, length: 3840, phaseSec: 0 };
  const Sheet = h.load('BeatAiActionSheet', {
    'next/link': { default: placeholder }, '../../../_lib/gateway.js': { gatewayFetch: async () => ({ version_id: 'v1', current_version: { id: 'v1' }, actions: ['extend', 'replace_section'] }) },
    '../../../_lib/music/beat/beatAssets.js': { subscribeAssets() {}, assetState: () => ({ status: 'ready' }) },
    '../../../_lib/music/beat/beatAi.mjs': ai, '../../../_lib/music/beat/beatAudioSegments.mjs': audio,
  }).default;
  const request = { selection: { op, region, ...(op === 'generate' ? {} : { source: { asset, songId: 's1' } }) }, online: true, reset() {} };
  const doc = documentModule.createBeat({ id: crypto.randomUUID() });
  h.render(() => Sheet({ request, doc })); h.tree.props.ref.current = { showModal() {} }; await h.settle();
  const textarea = () => find(h.tree, n => n.type === 'textarea');
  const inline = () => find(h.tree, n => n.props.id === 'beat-ai-prompt-error');
  assert.equal(inline().props.children, ''); assert.equal(textarea().props['aria-invalid'], false);
  if (op !== 'generate') { find(h.tree, n => n.props.type === 'checkbox').props.onChange({ target: { checked: true } }); await h.settle(); }
  assert.equal(find(h.tree, n => n.props.id === 'beat-ai-validation'), undefined);
  assert.equal(button(h.tree, 'Price').props.disabled, true);
  textarea().props.onChange({ target: { value: ' ' } }); await h.settle();
  assert.equal(textarea().props['aria-invalid'], true, 'non-empty invalid input shows the error before blur');
  textarea().props.onChange({ target: { value: '' } }); await h.settle();
  assert.equal(inline().props.children, '', 'an untouched empty field stays quiet');
  textarea().props.onBlur(); await h.settle();
  const message = op === 'generate' ? 'Describe a part in 1–400 characters' : 'Describe the part in 1–400 characters';
  assert.equal(inline().props.children, message); assert.equal(textarea().props['aria-invalid'], true);
  assert.equal(find(h.tree, n => n.props.id === 'beat-ai-validation'), undefined);
  textarea().props.onChange({ target: { value: 'warm piano' } }); await h.settle();
  assert.equal(inline().props.children, ''); assert.equal(button(h.tree, 'Price').props.disabled, false);
  textarea().props.onChange({ target: { value: ' '.repeat(2) } }); await h.settle(); assert.equal(inline().props.children, message);
  h.close();
});
