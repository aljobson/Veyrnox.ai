import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { harness, button } from './helpers/musicBeatComponentHarness.mjs';
import * as compatibility from '../app/veyrnox/_lib/music/beat/beatCompatibility.mjs';
import * as documentModule from '../app/veyrnox/_lib/music/beat/beatDocument.mjs';
import * as templates from '../app/veyrnox/_lib/music/beat/beatTemplates.mjs';
import * as ops from '../app/veyrnox/_lib/music/beat/beatOps.mjs';
import * as summary from '../app/veyrnox/_lib/music/beat/beatTrackSummary.mjs';
const { configureBeatWrites, capabilityGeneration, getBeatWriteVersion } = compatibility;
function home(h) {
  const doc = { ...documentModule.createBeat({ id: crypto.randomUUID(), now: 1 }), version: 5 };
  return h.load('BeatsHome', {
    'next/link': { default: () => null }, 'next/navigation': { useRouter: () => ({}) }, './BeatTemplatePicker': { default: () => null },
    './useBeatAccountList': { useBeatAccountList: () => ({ rows: [], loaded: true }) },
    '../../../_lib/music/beat/beatTemplates.mjs': templates, '../../../_lib/music/beat/beatDocument.mjs': documentModule,
    '../../../_lib/music/beat/beatOps.mjs': ops, '../../../_lib/music/beat/beatTrackSummary.mjs': summary,
    '../../../_lib/music/beat/beatStore.js': { listBeats: async () => ({ records: [{ id: doc.id, doc, revision: 1 }], count: 1 }), subscribeBeats: () => () => {} },
  }).default;
}
test.afterEach(() => configureBeatWrites(false));
test('cold list enables writes only at commit; enabled-to-disabled navigation disables rename without reload', async () => {
  const h = harness(), Home = home(h); let enabled = true;
  h.render(() => Home({ v5Writes: enabled }));
  assert.equal(getBeatWriteVersion(), 4);
  h.effects(); await h.settle(); assert.equal(getBeatWriteVersion(), 5); assert.equal(button(h.tree, 'Rename').props.disabled, false);
  enabled = false; h.render(); assert.equal(getBeatWriteVersion(), 5);
  h.effects(); await h.settle(); assert.equal(getBeatWriteVersion(), 4); assert.equal(button(h.tree, 'Rename').props.disabled, true);
  assert.match(button(h.tree, 'Rename').props.title, /read-only/);
  enabled = true; h.render(); h.effects(); await h.settle(); assert.equal(getBeatWriteVersion(), 5);
  h.close();
});
test('suspended or cancelled list renders cannot revoke the mounted page capability', () => {
  configureBeatWrites(true); const generation = capabilityGeneration();
  for (const suspended of [true, false]) {
    const h = harness(), Home = home(h);
    const render = () => { const tree = Home({ v5Writes: false }); if (suspended) throw new Promise(() => {}); return tree; };
    if (suspended) assert.throws(() => h.render(render)); else h.render(render);
    // An abandoned tree never commits its effects.
    h.close(); assert.equal(getBeatWriteVersion(), 5); assert.equal(capabilityGeneration(), generation);
  }
});
test('all server entries pass flag and client entry configuration is confined to layout effects', () => {
  const base = 'app/veyrnox/';
  for (const path of ['app/music/beats/page.js', 'app/music/beats/[id]/page.js', 'app/music/beats/new/page.js'])
    assert.match(readFileSync(base + path, 'utf8'), /v5Writes=\{musicBeatV5WritesEnabled\(\)\}/);
  for (const name of ['BeatsHome', 'BeatEditor', 'BeatSongSeedLoader']) {
    const source = readFileSync(`${base}_components/music/beat/${name}.jsx`, 'utf8');
    assert.match(source, /useLayoutEffect\(\(\) => \{\s*configureBeatWrites\(v5Writes\)/);
    assert.equal((source.match(/configureBeatWrites\(/g) || []).length, 1);
  }
});
for (const stale of [false, true]) test(`enabled account Open ${stale ? 'refuses stale fetch before storage/navigation' : 'loads v5 on a cold list'}`, async t => {
  const h = harness(); t.after(() => h.close());
  const doc = { ...documentModule.createBeat({ id: crypto.randomUUID(), now: 1 }), version: 5 }, userId = crypto.randomUUID();
  const project = { id: crypto.randomUUID(), beat_id: doc.id, revision: 1, doc_version: 5 };
  let opened = '', writes = 0, account; const messages = [];
  configureBeatWrites(true);
  const { useBeatAccountList } = h.load('useBeatAccountList', {
    '../../../../lib/authClient.js': { getStoredUserId: () => userId, onSessionChange: () => () => {} },
    '../../../_lib/music/beat/beatCloud.js': { listCloudBeats: async () => ({ projects: [project] }), getCloudBeat: async () => { if (stale) configureBeatWrites(false); return { project, doc_json: JSON.stringify(doc) }; } },
    '../../../_lib/music/beat/beatStore.js': { loadCloudBeat: async value => { assert.equal(getBeatWriteVersion(), 5); assert.equal(value.version, 5); writes++; return {}; } },
  }, 'js');
  h.render(() => { account = useBeatAccountList(true, { push: path => { opened = path; } }, text => messages.push(text), async () => {}); }); await h.settle();
  await account.open(project); await h.settle();
  assert.equal(writes, stale ? 0 : 1); assert.equal(opened, stale ? '' : `/app/music/beats/${doc.id}`);
  if (stale) assert.match(messages.at(-1), /read-only/);
});
