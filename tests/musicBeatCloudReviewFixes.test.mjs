import test from 'node:test';
import assert from 'node:assert/strict';
import { configureBeatWrites, getBeatWriteVersion } from '../app/veyrnox/_lib/music/beat/beatCompatibility.mjs';
import { setup, fixture, saves } from './helpers/musicBeatCloudHookHarness.mjs';

for (const version of [4, 5]) test(`Load theirs resolves a v4/v${version} conflict with memory-only storage`, async t => {
  const h = await setup(t, { edited: true, writes: true, persistent: false });
  fixture.get = async () => ({ project: { id: fixture.record.cloud.projectId, revision: 2 },
    doc_json: JSON.stringify({ ...fixture.record.doc, version, title: 'Remote', updatedAt: 3 }) });
  h.project.output.edit(d => ({ ...d, title: 'Unstashed edit', updatedAt: 4 })); await h.settle();
  fixture.save = async () => { throw { code: 'VERSION_CONFLICT', status: 409 }; };
  await h.run(10000); assert.equal(h.sync.output.state, 'conflict');
  assert.equal(h.project.output.persistent, false);
  fixture.save = async body => ({ project: { id: fixture.record.cloud.projectId, revision: body.expected_revision + 1 } });
  await h.sync.output.resolve('theirs'); await h.settle();
  assert.equal(h.sync.output.state, 'synced'); assert.equal(h.sync.output.conflict, null);
  assert.equal(h.project.output.doc.title, 'Remote'); assert.equal(h.project.output.doc.version, version);
  assert.equal(fixture.record.doc.version, version); assert.equal(h.project.output.persistent, false);
  const stash = JSON.parse(saves().at(-1)[1].doc_json);
  assert.equal(stash.title, 'Unstashed edit'); assert.equal(stash.version, version);
  assert.equal(saves().at(-1)[1].mode, 'stash');
  assert.equal(fixture.calls.filter(c => c === 'local-write').length, 1, 'only replacement persists locally');
});

function refuseWithRemoteV5() {
  fixture.save = async () => { throw { code: 'BEAT_WRITES_DISABLED', status: 409 }; };
  fixture.get = async () => ({ project: { id: fixture.record.cloud.projectId, revision: 2 },
    doc_json: JSON.stringify({ ...fixture.record.doc, version: 5, title: 'Remote v5', updatedAt: 3 }) });
}
for (const writes of [false, true]) test(`dirty v4 survives stored-v5 refusal and keeps local saving with writes ${writes}`, async t => {
  const h = await setup(t, { edited: true, writes }); refuseWithRemoteV5();
  h.project.output.edit(d => ({ ...d, title: 'Unsaved local edit', updatedAt: 9 })); await h.settle();
  await h.run(10000);
  assert.equal(h.sync.output.state, 'cloud_read_only'); assert.equal(h.sync.output.conflict, null);
  assert.match(h.sync.output.message, /read-only/); assert.doesNotMatch(h.sync.output.message, /lost/);
  assert.equal(h.project.output.readOnly, false); assert.equal(h.project.output.dirty, true);
  assert.equal(h.project.output.doc.title, 'Unsaved local edit'); assert.equal(getBeatWriteVersion(), writes ? 5 : 4);
  assert.equal(fixture.calls.includes('cloud-read'), false);
  await h.project.output.flushLatest(); await h.settle();
  assert.equal(fixture.record.doc.title, 'Unsaved local edit'); assert.equal(h.project.output.dirty, false);
  assert.ok(h.project.output.edit(d => ({ ...d, title: 'Still local', updatedAt: 10 }))); await h.settle();
  await h.project.output.flushLatest(); await h.settle(); assert.equal(fixture.record.doc.title, 'Still local');
  const count = saves().length; await h.sync.output.checkpoint(); await h.settle();
  assert.equal(saves().length, count); assert.equal(h.timers.size, 0);
});
for (const writes of [false, true]) test(`clean v4 loads the refused account v5 read-only with writes ${writes}`, async t => {
  const h = await setup(t, { edited: true, writes }); refuseWithRemoteV5();
  await h.run(10000);
  assert.equal(h.project.output.doc.title, 'Remote v5'); assert.equal(h.project.output.readOnly, true);
  assert.equal(h.project.output.dirty, false); assert.equal(fixture.record.doc.version, 5);
  assert.equal(h.sync.output.state, 'read_only'); assert.equal(h.sync.output.conflict, null);
  assert.equal(fixture.calls.filter(c => c === 'cloud-read').length, 1);
  assert.equal(fixture.calls.includes('local-write'), false); assert.equal(h.timers.size, 0);
});
test('an edit during the refused-account GET prevents read-only replacement', async t => {
  const h = await setup(t, { edited: true, writes: true }); refuseWithRemoteV5();
  const get = fixture.get;
  fixture.get = async () => { h.project.output.edit(d => ({ ...d, title: 'During GET', updatedAt: 9 })); return get(); };
  await h.run(10000);
  assert.equal(h.sync.output.state, 'cloud_read_only'); assert.doesNotMatch(h.sync.output.message, /lost/);
  assert.equal(fixture.calls.includes('cloud-read'), false); assert.equal(getBeatWriteVersion(), 5);
  await h.project.output.flushLatest(); await h.settle(); assert.equal(fixture.record.doc.title, 'During GET');
});

for (const code of ['RATE_LIMITED', 'NETWORK_ERROR']) test(`capability flips preserve ${code} backoff deadline and attempt`, async t => {
  let now = 100000; t.mock.method(Date, 'now', () => now);
  const h = await setup(t, { edited: true });
  fixture.save = async () => { throw { code, status: code === 'RATE_LIMITED' ? 429 : 0 }; };
  await h.run(10000);
  const delay = code === 'RATE_LIMITED' ? 60000 : 10000;
  for (const enabled of [true, false]) {
    now += 1000; configureBeatWrites(enabled); await h.settle();
    assert.equal(saves().length, 1);
    assert.equal(h.timers.size, 1);
    assert.ok([...h.timers.values()][0].delay >= 100000 + delay - now, 'no timer before the retry deadline');
  }
  const remaining = [...h.timers.values()][0].delay; now += remaining; await h.run(remaining);
  assert.equal(saves().length, 2);
  assert.deepEqual([...h.timers.values()].map(timer => timer.delay), [code === 'RATE_LIMITED' ? 60000 : 20000]);
});
