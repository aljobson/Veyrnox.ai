import test from 'node:test';
import assert from 'node:assert/strict';
import { harness, find, button, elements } from './helpers/musicBeatComponentHarness.mjs';
import * as documentModule from '../app/veyrnox/_lib/music/beat/beatDocument.mjs';
import * as rules from '../app/veyrnox/_lib/music/beat/beatCloudRules.mjs';
import * as compatibility from '../app/veyrnox/_lib/music/beat/beatCompatibility.mjs';
import * as ops from '../app/veyrnox/_lib/music/beat/beatOps.mjs';
import * as labels from '../app/veyrnox/_lib/music/beat/beatVersionLabels.mjs';
import * as templates from '../app/veyrnox/_lib/music/beat/beatTemplates.mjs';
import * as summary from '../app/veyrnox/_lib/music/beat/beatTrackSummary.mjs';
const doc = documentModule.upgradeBeatToV5(documentModule.createBeat({ id: crypto.randomUUID(), now: 1 }));
doc.markers = [{ id: 'm', name: 'Intro', tick: 10 }];
const raw = JSON.stringify(doc), userId = crypto.randomUUID();
const project = { id: crypto.randomUUID(), beat_id: doc.id, revision: 1, doc_version: 5 };
test('account open reads v5 exactly and explicitly refuses local persistence; delete displays server update message', async t => {
  const h = harness(), announced = []; let captured, account;
  const oldWindow = globalThis.window; globalThis.window = { confirm: () => true };
  t.after(() => { globalThis.window = oldWindow; h.close(); });
  const { useBeatAccountList } = h.load('useBeatAccountList', {
    '../../../../lib/authClient.js': { getStoredUserId: () => userId, onSessionChange: () => () => {} },
    '../../../_lib/music/beat/beatCloud.js': {
      listCloudBeats: async () => ({ projects: [project] }), getCloudBeat: async () => ({ project, doc_json: raw }),
      removeCloudBeat: async () => { throw { code: 'BEAT_CLIENT_OUTDATED', status: 409 }; },
    },
    '../../../_lib/music/beat/beatStore.js': { createBeat: async value => { captured = value; try { compatibility.assertBeatWritable(value); } catch (error) { return { error: error.code }; } assert.fail('v5 must be refused'); } },
  }, 'js');
  h.render(() => { account = useBeatAccountList(true, { push() { assert.fail('must not navigate after refusal'); } }, text => announced.push(text), async () => {}); });
  await h.settle(); await account.open(project); await h.settle();
  assert.equal(JSON.stringify(captured), raw); assert.match(announced.at(-1), /Update the app/);
  await account.remove(project); assert.match(announced.at(-1), /Update the app/);
});
test('version restore reads v5 without changing it and refuses before editing or saving', async t => {
  const h = harness(); let edits = 0;
  t.after(() => h.close());
  const Panel = h.load('BeatVersionsPanel', {
    '../../../../lib/authClient.js': { onSessionChange: () => () => {} },
    '../../../_lib/music/beat/beatCloud.js': { listVersions: async () => ({ versions: [{ id: 'v', title: doc.title, saved_at: new Date(0).toISOString(), revision: 1 }] }), getVersion: async () => ({ doc_json: raw }) },
    '../../../_lib/music/beat/beatOps.mjs': ops, '../../../_lib/music/beat/beatVersionLabels.mjs': labels,
  }).default;
  h.render(() => Panel({ beatId: doc.id, project: { finishRecording: async () => {}, edit: () => { edits++; } }, sync: { options: () => ({ userId }), current: () => true } }));
  find(h.tree, n => n.type === 'dialog').props.ref.current = { showModal() {}, close() {} };
  button(h.tree, 'Versions').props.onClick(); await h.settle();
  await button(h.tree, 'Restore').props.onClick(); await h.settle();
  assert.equal(edits, 0); assert.equal(JSON.stringify(doc), raw);
  assert.match(find(h.tree, n => n.props.role === 'alert').props.children[0], /Update the app/);
});
test('unsupported device and account rows show newer-app messages with no open/delete controls', async t => {
  const h = harness(); t.after(() => h.close());
  const Home = h.load('BeatsHome', {
    'next/link': { default: () => null }, 'next/navigation': { useRouter: () => ({}) }, './BeatTemplatePicker': { default: () => null },
    './useBeatAccountList': { useBeatAccountList: () => ({ rows: [{ ...project, doc_version: 999, unsupported: true }], loaded: true }) },
    '../../../_lib/music/beat/beatTemplates.mjs': templates, '../../../_lib/music/beat/beatDocument.mjs': documentModule,
    '../../../_lib/music/beat/beatOps.mjs': ops, '../../../_lib/music/beat/beatTrackSummary.mjs': summary,
    '../../../_lib/music/beat/beatStore.js': { listBeats: async () => ({ records: [], unsupported: [{ id: doc.id, title: 'Future beat' }], count: 1 }), subscribeBeats: () => () => {} },
  }).default;
  h.render(() => Home({ cloud: true })); await h.settle();
  assert.equal([...elements(h.tree)].filter(n => n.props.role === 'status' && n.props.children === 'Needs a newer app').length, 2);
  for (const label of ['Delete', 'Remove from account', 'Open']) assert.equal(button(h.tree, label), undefined);
  assert.equal(rules.classifyCloudBeat(raw, doc.id), 'ok');
});
