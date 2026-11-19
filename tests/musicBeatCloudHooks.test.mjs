import test from 'node:test';
import assert from 'node:assert/strict';
import { configureBeatWrites, assertBeatWritable } from '../app/veyrnox/_lib/music/beat/beatCompatibility.mjs';
import { setup, fixture, saves } from './helpers/musicBeatCloudHookHarness.mjs';

test('a valid version-5 local record opens read-only and refuses edits', async t => {
  const h = await setup(t, { edited: true, localVersion: 5 });
  assert.equal(h.project.output.error, '');
  assert.equal(h.project.output.doc.version, 5);
  assert.equal(h.project.output.readOnly, true);
  assert.equal(h.project.output.edit(d => ({ ...d, title: 'Blocked' })), null);
  assert.match(fixture.announcements.at(-1), /read-only/);
  assert.equal(fixture.record.doc.version, 5);
  assert.equal(fixture.calls.includes('local-write'), false);
  assert.equal(saves().length, 0);
});
test('unchanged open reads once, never writes or lists absent takes', async t => {
  const h = await setup(t); await h.run();
  assert.deepEqual(fixture.calls, ['get']);
  assert.equal(h.sync.output.state, 'synced');
  assert.equal(h.project.output.doc.title, fixture.record.doc.title);
});
test('newer account revision quietly replaces, updates link and reloads without stash or PUT', async t => {
  const h = await setup(t, { newer: true }); await h.run();
  assert.deepEqual(fixture.calls, ['get', 'local-write']);
  assert.equal(fixture.record.cloud.revision, 2);
  assert.equal(fixture.record.cloud.syncedUpdatedAt, 3);
  assert.equal(h.project.output.doc.title, 'From account');
  assert.equal(fixture.announcements.at(-1), 'Updated from your account');
  assert.equal(h.project.output.canUndo, false);
  await h.run(); assert.equal(saves().length, 0);
});
test('a saved local edit writes its original expected revision and opens the normal conflict', async t => {
  const h = await setup(t, { edited: true, newer: true });
  fixture.save = async () => { throw { code: 'VERSION_CONFLICT', status: 409 }; };
  await h.run();
  assert.equal(saves().length, 1); assert.equal(saves()[0][1].expected_revision, 1);
  assert.equal(h.sync.output.state, 'conflict'); assert.equal(h.sync.output.conflict.revision, 2);
  assert.equal(fixture.record.doc.updatedAt, 2);
});
test('an unsaved edit during the open GET aborts quiet replacement and later conflicts normally', async t => {
  const h = await setup(t, { newer: true });
  const get = fixture.get;
  fixture.get = async () => {
    h.project.output.edit(doc => ({ ...doc, title: 'Edited during GET', updatedAt: 4 }));
    return get();
  };
  await h.run();
  assert.equal(fixture.record.doc.title, 'Edited during GET');
  assert.equal(fixture.record.cloud.revision, 1);
  assert.ok(!fixture.announcements.includes('Updated from your account'));
  fixture.get = get; fixture.save = async () => { throw { code: 'VERSION_CONFLICT', status: 409 }; };
  await h.run(10000);
  assert.equal(h.sync.output.state, 'conflict');
  assert.equal(JSON.parse(saves()[0][1].doc_json).title, 'Edited during GET');
});
test('NOT_FOUND clears the link, stops automatic saves and re-creates only on the explicit button', async t => {
  const h = await setup(t, { edited: true });
  fixture.save = async () => { throw { code: 'NOT_FOUND', status: 404 }; };
  await h.run();
  assert.equal(h.sync.output.state, 'removed');
  assert.equal(h.sync.output.message, 'Removed from your account — Save to your account');
  assert.deepEqual(fixture.record.cloud, { userId: fixture.userId, projectId: null, revision: 0 });
  assert.equal(h.timers.size, 0);
  fixture.save = async () => ({ project: { id: crypto.randomUUID(), revision: 1 } });
  await h.sync.output.link(); await h.settle();
  assert.equal(saves().length, 2); assert.equal(saves()[1][1].expected_revision, 0);
  assert.equal(h.sync.output.state, 'synced');
});
const takes = Object.fromEntries(['one', 'two', 'three'].map(ref => [`a${ref}`, { source: 'take', ref, name: ref, durationSec: 1, sourceChannels: 1, encodedBytes: 44, bpm: null }]));
for (const [status, code] of [[400, 'INVALID_REQUEST'], [401, 'UNAUTHORIZED'], [403, 'TAKE_UPLOAD_FAILED'],
  [404, 'NOT_FOUND'], [409, 'take_upload_invalid'], [413, 'TAKE_UPLOAD_FAILED'], [undefined, 'ENCODE_FAILED']]) {
  test(`${status} ${code} refuses only that take and stops its retry timer`, async t => {
    const h = await setup(t, { assets: takes });
    fixture.upload = async asset => {
      if (asset.ref === 'one') throw { status, code };
      return { id: asset.ref, status: 'ready' };
    };
    await h.run();
    assert.deepEqual(h.sync.output.media, ['one']);
    assert.equal(h.timers.size, 0);
    // Later document saves must not retry the refused ref either.
    await h.sync.output.checkpoint(); await h.settle();
    assert.equal(fixture.calls.filter(c => Array.isArray(c) && c[0] === 'upload' && c[1] === 'one').length, 1);
    assert.deepEqual(h.sync.output.media, ['one']);
    assert.equal(h.timers.size, 0);
  });
}
for (const error of [{ status: 503, code: 'TAKE_UPLOAD_FAILED' }, { code: 'NETWORK_ERROR' },
  { status: 409, code: 'take_upload_missing' }, { status: 408, code: 'TAKE_UPLOAD_FAILED' },
  { status: 429, code: 'TAKE_UPLOAD_FAILED' }, { status: 429, code: 'OTHER_LIMIT' }]) {
  test(`${error.code} ${error.status || 'network'} keeps the existing media retry`, async t => {
    const h = await setup(t, { assets: { aone: takes.aone } });
    fixture.upload = async () => { throw error; };
    await h.run();
    assert.deepEqual(h.sync.output.media, ['one']);
    assert.deepEqual([...h.timers.values()].map(timer => timer.delay), [60000]);
    fixture.upload = async asset => ({ id: asset.ref, status: 'ready' });
    await h.run(60000);
    assert.deepEqual(h.sync.output.media, []);
    assert.equal(fixture.calls.filter(c => Array.isArray(c) && c[0] === 'upload').length, 2);
    assert.equal(h.timers.size, 0);
  });
}
test('takes list once per cycle and successful uploads need no second listing', async t => {
  const h = await setup(t, { assets: takes }); await h.run();
  assert.equal(fixture.calls.filter(c => c === 'takes').length, 1);
  assert.equal(fixture.calls.filter(c => Array.isArray(c) && c[0] === 'upload').length, 3);
  assert.deepEqual(h.sync.output.media, []);
});
for (const code of ['RATE_LIMITED', 'LIMIT_REACHED']) test(`${code} stops take uploads; only rate limits schedule remaining takes`, async t => {
  const h = await setup(t, { assets: takes });
  fixture.upload = async () => { throw { code, status: 429 }; };
  await h.run();
  assert.equal(fixture.calls.filter(c => c === 'takes').length, 1);
  assert.equal(fixture.calls.filter(c => Array.isArray(c) && c[0] === 'upload').length, 1);
  assert.deepEqual(h.sync.output.media, ['one', 'two', 'three']);
  assert.equal([...h.timers.values()].some(t => t.delay === 60000), code === 'RATE_LIMITED');
  if (code === 'RATE_LIMITED') {
    fixture.upload = async asset => ({ id: asset.ref, status: 'ready' });
    await h.run(60000); assert.deepEqual(h.sync.output.media, []);
    assert.equal(fixture.calls.filter(c => c === 'takes').length, 2);
  }
});

test('a persisted removed link remains read-only on reopen until explicit save', async t => {
  const h = await setup(t);
  fixture.record.cloud = { userId: fixture.userId, projectId: null, revision: 0 };
  await h.run();
  assert.equal(h.sync.output.state, 'removed'); assert.deepEqual(fixture.calls, []);
  await h.sync.output.checkpoint(); await h.settle();
  assert.deepEqual(fixture.calls, []);
});
test('removal while resolving Keep mine clears the conflict and stops retries', async t => {
  const h = await setup(t, { edited: true, newer: true });
  fixture.save = async () => { throw { code: 'VERSION_CONFLICT', status: 409 }; };
  await h.run(); assert.equal(h.sync.output.state, 'conflict');
  fixture.save = async () => { throw { code: 'NOT_FOUND', status: 404 }; };
  await h.sync.output.resolve('mine'); await h.settle();
  assert.equal(h.sync.output.state, 'removed'); assert.equal(h.sync.output.conflict, null);
  assert.equal(h.timers.size, 0);
});
test('Load theirs retries a take that a background cycle refused', async t => {
  const h = await setup(t, { edited: true, assets: { aone: takes.aone } });
  fixture.upload = async () => { throw { status: 403, code: 'TAKE_UPLOAD_FAILED' }; };
  await h.run();
  assert.deepEqual(h.sync.output.media, ['one']);
  fixture.record = { ...fixture.record, doc: { ...fixture.record.doc, updatedAt: 5 }, updatedAt: 5 };
  fixture.save = async () => { throw { code: 'VERSION_CONFLICT', status: 409 }; };
  fixture.get = async () => ({ project: { id: fixture.record.cloud.projectId, revision: 2 }, doc_json: JSON.stringify({ ...fixture.record.doc, title: 'Theirs', updatedAt: 6 }) });
  await h.sync.output.checkpoint(); await h.settle();
  assert.equal(h.sync.output.state, 'conflict');
  const before = fixture.calls.filter(c => Array.isArray(c) && c[0] === 'upload').length;
  fixture.upload = async asset => ({ id: asset.ref, status: 'ready' });
  await h.sync.output.resolve('theirs'); await h.settle();
  assert.equal(fixture.calls.filter(c => Array.isArray(c) && c[0] === 'upload').length, before + 1);
  assert.deepEqual(h.sync.output.media, []);
});
test('a transient upload failure is not retried by a document save before its deadline', async t => {
  const h = await setup(t, { edited: true, assets: { aone: takes.aone } });
  fixture.upload = async () => { throw { status: 429, code: 'TAKE_UPLOAD_FAILED' }; };
  await h.run();
  const uploads = () => fixture.calls.filter(c => Array.isArray(c) && c[0] === 'upload').length;
  assert.equal(uploads(), 1);
  fixture.upload = async asset => ({ id: asset.ref, status: 'ready' });
  await h.sync.output.checkpoint(); await h.settle();
  assert.ok(saves().length >= 2, 'the document save still runs');
  assert.equal(uploads(), 1, 'the take waits for its retry deadline');
  assert.deepEqual(h.sync.output.media, ['one']);
  await h.run(60000);
  assert.equal(uploads(), 2); assert.deepEqual(h.sync.output.media, []);
});

test('BEAT_CLIENT_OUTDATED stops automatic retries and announces update required', async t => {
  const h = await setup(t, { edited: true });
  fixture.save = async () => { throw { code: 'BEAT_CLIENT_OUTDATED', status: 409 }; };
  await h.run();
  assert.equal(h.sync.output.state, 'update_required');
  assert.match(h.sync.output.message, /Update the app/);
  assert.equal(h.timers.size, 0);
  const count = saves().length;
  await h.sync.output.checkpoint(); await h.settle();
  assert.equal(saves().length, count); assert.equal(h.timers.size, 0);
});
for (const version of [6, 999]) test(`cloud open v${version} refuses persistence without writes, stash or retry`, async t => {
  const h = await setup(t, { newer: true });
  const raw = JSON.stringify({ ...fixture.record.doc, version, ...(version === 5 ? { markers: [{ id: 'a', name: 'Intro', tick: 3 }] } : {}) });
  const before = JSON.stringify(fixture.record);
  fixture.get = async () => ({ project: { id: fixture.record.cloud.projectId, revision: 2 }, doc_json: raw });
  await h.run();
  assert.equal(h.sync.output.state, 'update_required'); assert.equal(h.timers.size, 0);
  assert.equal(JSON.stringify(fixture.record), before); assert.deepEqual(fixture.calls, ['get']);
});
test('outdated response while resolving a conflict clears the conflict and never retries', async t => {
  const h = await setup(t, { edited: true, newer: true });
  fixture.save = async () => { throw { code: 'VERSION_CONFLICT', status: 409 }; };
  await h.run();
  fixture.save = async () => { throw { code: 'BEAT_CLIENT_OUTDATED', status: 409 }; };
  await h.sync.output.resolve('mine'); await h.settle();
  assert.equal(h.sync.output.state, 'update_required'); assert.equal(h.sync.output.conflict, null); assert.equal(h.timers.size, 0);
});

// B1 changes the v5 P0 case to read-only; unsupported-version cases above stay terminal.
test('cloud refresh loads v5 read-only without write-gated replacement, stash or upload', async t => {
  const h = await setup(t, { newer: true });
  const doc = { ...fixture.record.doc, version: 5, title: 'V5 account', updatedAt: 3 };
  fixture.get = async () => ({ project: { id: fixture.record.cloud.projectId, revision: 2 }, doc_json: JSON.stringify(doc) });
  await h.run();
  assert.equal(h.project.output.readOnly, true); assert.equal(h.project.output.doc.version, 5);
  assert.equal(h.sync.output.state, 'read_only'); assert.equal(h.timers.size, 0);
  assert.deepEqual(fixture.calls, ['get', 'cloud-read']);
});
for (const choice of ['mine', 'theirs']) test(`cross-version conflict ${choice} keeps v5 floor in editor, storage and every cloud payload`, async t => {
  const h = await setup(t, { edited: true, writes: true });
  fixture.get = async () => ({ project: { id: fixture.record.cloud.projectId, revision: 2 }, doc_json: JSON.stringify({ ...fixture.record.doc, version: 5, title: 'Remote v5', updatedAt: 3 }) });
  fixture.save = async () => { throw { code: 'BEAT_CLIENT_OUTDATED', status: 409 }; };
  await h.run(); assert.equal(h.sync.output.state, 'conflict');
  fixture.save = async body => ({ project: { id: fixture.record.cloud.projectId, revision: body.expected_revision + 1 } });
  const before = saves().length;
  await h.sync.output.resolve(choice); await h.settle();
  assert.equal(h.sync.output.state, 'synced');
  assert.equal(h.project.output.doc.version, 5); assert.equal(fixture.record.doc.version, 5);
  assert.equal(h.project.output.doc.title, choice === 'theirs' ? 'Remote v5' : 'Untitled beat 1');
  for (const [, body] of saves().slice(before)) assert.equal(JSON.parse(body.doc_json).version, 5);
});
test('v4 history restored after promotion never downgrades undo, redo, local save or cloud save', async t => {
  const h = await setup(t, { writes: true });
  h.project.output.edit(d => ({ ...d, title: 'Edited v4', updatedAt: 2 })); await h.settle();
  await h.project.output.raiseVersionFloor(5); await h.settle();
  h.project.output.undo(); await h.settle();
  assert.equal(h.project.output.doc.version, 5); assert.equal(h.project.output.doc.title, 'Untitled beat 1');
  h.project.output.redo(); await h.settle(); assert.equal(h.project.output.doc.version, 5);
  h.project.output.edit(d => ({ ...d, title: 'After undo', updatedAt: 3 })); await h.settle();
  await h.project.output.flushLatest(); await h.settle();
  assert.equal(fixture.record.doc.version, 5);
  await h.sync.output.checkpoint(); await h.settle();
  assert.equal(JSON.parse(saves().at(-1)[1].doc_json).version, 5);
});
test('server rollback stops retries, preserves pending edits, disables mounted editor without conflict', async t => {
  const h = await setup(t, { writes: true, localVersion: 5, edited: true });
  h.project.output.edit(d => ({ ...d, title: 'Pending edit', updatedAt: 4 })); await h.settle();
  fixture.save = async () => { throw { code: 'BEAT_WRITES_DISABLED', status: 409 }; };
  await h.run(10000); await h.settle();
  assert.equal(h.sync.output.state, 'read_only'); assert.equal(h.sync.output.conflict, null);
  assert.equal(h.project.output.doc.title, 'Pending edit'); assert.equal(h.project.output.dirty, true);
  assert.equal(h.project.output.readOnly, true);
  assert.equal(h.project.output.edit(d => ({ ...d, title: 'Refused' })), null);
  assert.equal(h.timers.size, 0);
});
test('clean v5 missing cloud media lists playback takes but never uploads when off', async t => {
  const h = await setup(t, { localVersion: 5, assets: takes }); await h.run();
  assert.ok(fixture.calls.includes('takes')); assert.equal(fixture.calls.some(c => Array.isArray(c) && c[0] === 'upload'), false);
  assert.equal(h.sync.output.state, 'read_only'); assert.equal(h.timers.size, 0);
});
test('mounted v5 editor follows disabled/enabled navigation without reloading its document', async t => {
  const h = await setup(t, { writes: true, localVersion: 5 });
  const doc = h.project.output.doc;
  configureBeatWrites(false); await h.settle();
  assert.equal(h.project.output.readOnly, true); assert.equal(h.project.output.doc, doc);
  assert.equal(h.project.output.edit(d => ({ ...d, title: 'Refused' })), null);
  configureBeatWrites(true); await h.settle();
  assert.equal(h.project.output.readOnly, false); assert.equal(h.project.output.doc, doc);
  assert.ok(h.project.output.edit(d => ({ ...d, title: 'Enabled again', updatedAt: 5 })));
  await h.project.output.flushLatest(); await h.settle();
  assert.equal(fixture.record.doc.version, 5); assert.equal(fixture.record.doc.title, 'Enabled again');
});
test('rollback during conflict media publication remains read-only after resolution exits', async t => {
  const h = await setup(t, { writes: true, localVersion: 5, edited: true, assets: takes });
  fixture.get = async () => ({ project: { id: fixture.record.cloud.projectId, revision: 2 }, doc_json: JSON.stringify(fixture.record.doc) });
  fixture.save = async () => { throw { code: 'VERSION_CONFLICT', status: 409 }; };
  await h.run(); assert.equal(h.sync.output.state, 'conflict');
  fixture.save = async body => ({ project: { id: fixture.record.cloud.projectId, revision: body.expected_revision + 1 } });
  fixture.upload = async () => { throw { code: 'BEAT_WRITES_DISABLED', status: 409 }; };
  await h.sync.output.resolve('mine'); await h.settle();
  assert.equal(h.sync.output.state, 'read_only'); assert.equal(h.sync.output.conflict, null); assert.equal(h.timers.size, 0);
});

test('clean v5 sync resumes after on/off/on and saves the next edit', async t => {
  const h = await setup(t, { writes: true, localVersion: 5 });
  await h.run(); assert.equal(h.sync.output.state, 'synced');
  configureBeatWrites(false); await h.settle(); assert.equal(h.sync.output.state, 'read_only');
  configureBeatWrites(true); await h.settle(); await h.run(0);
  assert.equal(h.sync.output.state, 'synced');
  h.project.output.edit(d => ({ ...d, title: 'After re-enable', updatedAt: 5 })); await h.settle();
  await h.project.output.flushLatest(); await h.settle(); await h.run(10000);
  assert.equal(h.sync.output.state, 'synced');
  assert.equal(JSON.parse(saves().at(-1)[1].doc_json).title, 'After re-enable');
});
for (const enabled of [true, false]) test(`mounted v4 retries a stale cycle when v5Writes becomes ${enabled}`, async t => {
  const h = await setup(t, { writes: !enabled, edited: true });
  fixture.beforeRead = () => { fixture.beforeRead = null; configureBeatWrites(enabled); };
  await h.run(); assert.notEqual(h.sync.output.state, 'read_only');
  await h.run(0); assert.equal(h.sync.output.state, 'synced');
  h.project.output.edit(d => ({ ...d, title: 'Still editable', updatedAt: 8 })); await h.settle();
  await h.project.output.flushLatest(); await h.settle(); await h.run(10000);
  assert.equal(h.sync.output.state, 'synced'); assert.equal(JSON.parse(saves().at(-1)[1].doc_json).version, 4);
});
for (const [code, state] of [['LIMIT_REACHED', 'limit'], ['BEAT_CLIENT_OUTDATED', 'update_required'], ['NOT_FOUND', 'removed']]) {
  test(`capability changes never clear terminal ${state}`, async t => {
    const h = await setup(t, { edited: true });
    fixture.save = async () => { throw { code, status: code === 'NOT_FOUND' ? 404 : 409 }; };
    await h.run(); assert.equal(h.sync.output.state, state);
    const count = saves().length;
    for (const enabled of [true, false, true]) {
      configureBeatWrites(enabled); await h.settle(); await h.sync.output.checkpoint(); await h.settle();
      assert.equal(h.sync.output.state, state); assert.equal(h.timers.size, 0); assert.equal(saves().length, count);
    }
  });
}

test('v4 account linking retries a capability change before persistence', async t => {
  const h = await setup(t, { writes: true }); fixture.record.cloud = null;
  await h.run(); assert.equal(h.sync.output.state, 'unlinked');
  fixture.beforeRead = () => { fixture.beforeRead = null; configureBeatWrites(false); };
  await h.sync.output.link(); await h.settle();
  assert.equal(h.sync.output.state, 'synced'); assert.equal(saves().length, 1);
  assert.ok(fixture.record.cloud.projectId);
});
for (const choice of ['mine', 'theirs']) test(`v4 conflict ${choice} retries its stale capability token`, async t => {
  const h = await setup(t, { writes: true, edited: true, newer: true });
  fixture.save = async () => { throw { code: 'VERSION_CONFLICT', status: 409 }; };
  await h.run(); assert.equal(h.sync.output.state, 'conflict');
  fixture.save = async body => ({ project: { id: fixture.record.cloud.projectId, revision: body.expected_revision + 1 } });
  configureBeatWrites(false); await h.settle();
  await h.sync.output.resolve(choice); await h.settle();
  assert.equal(h.sync.output.state, 'synced'); assert.equal(h.sync.output.conflict, null);
  assert.equal(h.project.output.doc.version, 4);
});
