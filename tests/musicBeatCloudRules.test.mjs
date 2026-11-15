import test from 'node:test';
import assert from 'node:assert/strict';
import { sameAccount, removedLink, isRemoved, maySync, needsSync, errorState, retryDelay, conflictRequest, takesToUpload, replaceAfterStash, recoverTake, syncDocumentThenMedia } from '../app/veyrnox/_lib/music/beat/beatCloudRules.mjs';
import { createBeat } from '../app/veyrnox/_lib/music/beat/beatDocument.mjs';
import { validRecord, decideUpdate, validCloudLink, decideCloudLink } from '../app/veyrnox/_lib/music/beat/beatStoreRules.mjs';
import { restoreVersion } from '../app/veyrnox/_lib/music/beat/beatOps.mjs';
import { musicBeatCloudEnabled } from '../lib/musicBackend.js';
const id = crypto.randomUUID(), userId = crypto.randomUUID(), projectId = crypto.randomUUID();
const doc = createBeat({ id, now: 1 });
const link = { userId, projectId, revision: 1, syncedUpdatedAt: 1 };
test('both beat switches and existing UI switch are required', () => {
  for (const ui of [false, true]) for (const beatEditor of [false, true]) for (const beatCloud of [false, true])
    assert.equal(musicBeatCloudEnabled({ MUSIC_RUNTIME_FLAGS: JSON.stringify({ ui, beatEditor, beatCloud }) }), ui && beatEditor && beatCloud);
  assert.equal(musicBeatCloudEnabled({}), false);
});
test('account and generation binding rejects stale results and unlinked/foreign beats', () => {
  assert.equal(sameAccount({ userId, generation: 1 }, { userId, generation: 1 }), true);
  assert.equal(sameAccount({ userId, generation: 1 }, { userId, generation: 2 }), false);
  assert.equal(sameAccount({ userId, generation: 1 }, { userId: 'other', generation: 1 }), false);
  assert.equal(maySync(null, userId), false); assert.equal(maySync(link, 'other'), false);
  assert.equal(needsSync({ doc, cloud: link }, userId), false);
  assert.equal(needsSync({ doc, cloud: { ...link, projectId: null, revision: 0 } }, userId), true);
  assert.equal(needsSync({ doc: { ...doc, updatedAt: 2 }, cloud: link }, userId), true);
});
test('old local records remain valid; links are exact, preserved by updates, and bound on link writes', () => {
  const old = { id, doc, updatedAt: 1, revision: 1 };
  assert.equal(validRecord(old), true); assert.equal(validRecord({ ...old, cloud: link }), true);
  for (const cloud of [null, {}, { ...link, x: 1 }, { ...link, projectId: null }, { ...link, userId: '' }, { ...link, revision: -1 }]) assert.equal(validRecord({ ...old, cloud }), false);
  const linked = { ...old, cloud: link };
  assert.deepEqual(decideUpdate(linked, { ...doc, title: 'Renamed', updatedAt: 2 }, 1).record.cloud, link);
  assert.equal(decideUpdate(old, doc, 1).record.cloud, undefined);
  assert.equal(decideCloudLink(linked, { userId: 'other' }, link).error, 'conflict');
  assert.equal(decideCloudLink(old, null, link).record.revision, 1);
  assert.equal(decideCloudLink(linked, link, { ...link, revision: 2 }).record.doc, doc);
  assert.equal(validCloudLink({ ...link, projectId: null, revision: 0 }), true);
});
test('typed errors select bounded retries and conflict request modes', () => {
  for (const [code, state] of [['VERSION_CONFLICT', 'conflict'], ['limit_reached', 'limit'], ['RATE_LIMITED', 'rate_limited'], ['network_error', 'offline']]) assert.equal(errorState({ code }), state);
  assert.equal(retryDelay(0, {}), 10000); assert.equal(retryDelay(100, {}), 300000);
  assert.equal(retryDelay(0, { code: 'RATE_LIMITED' }), 60000);
  assert.equal(retryDelay(0, { code: 'LIMIT_REACHED' }), null);
  assert.equal(conflictRequest('mine', doc, 9).mode, 'checkpoint');
  assert.deepEqual(conflictRequest('theirs', doc, 9), { mode: 'stash', expected_revision: 9, doc_json: JSON.stringify(doc) });
});
test('take selection includes pending media even without document edits', () => {
  const doc = { assets: { a1: { source: 'take', ref: 'one' }, a2: { source: 'take', ref: 'two' }, a3: { source: 'sound', ref: 'sound' } } };
  const rows = [{ take_ref: 'one', status: 'ready' }, { take_ref: 'two', status: 'pending' }];
  assert.deepEqual(takesToUpload(doc, rows).map(a => a.ref), ['two']);
  assert.deepEqual(takesToUpload(doc, rows, new Set(['two'])), []);
});
test('first sync saves document before attempting media', async () => {
  const calls = []; await syncDocumentThenMedia(async () => calls.push('doc'), async () => calls.push('takes'));
  assert.deepEqual(calls, ['doc', 'takes']);
  await assert.rejects(syncDocumentThenMedia(async () => { throw Error('failed'); }, async () => calls.push('unexpected')));
  assert.deepEqual(calls, ['doc', 'takes']);
});
test('Load theirs stashes latest dialog edits, then conditionally replaces', async () => {
  let live = { ...doc, title: 'Edited while dialog open' }; const events = [];
  await replaceAfterStash({ latest: async () => ({ doc: live, revision: 4 }), media: async d => events.push(['media', d.title]),
    stash: async d => events.push(['stash', d.title]), current: () => true, replace: async c => events.push(['replace', c.revision]) });
  assert.deepEqual(events, [['media', live.title], ['stash', live.title], ['replace', 4]]);
});
test('Load theirs refuses quota, PUT, confirm, stash and concurrent local failures without replacement', async () => {
  for (const failure of ['quota', 'put', 'confirm', 'stash', 'local']) {
    const events = [];
    await assert.rejects(replaceAfterStash({ latest: async () => ({ doc, revision: 3 }),
      media: async () => { events.push('media'); if (['quota', 'put', 'confirm'].includes(failure)) throw Error(failure); },
      stash: async () => { events.push('stash'); if (failure === 'stash') throw Error('stash'); },
      current: () => failure !== 'local', replace: async () => events.push('replace') }));
    assert.ok(!events.includes('replace')); if (['quota', 'put', 'confirm'].includes(failure)) assert.ok(!events.includes('stash'));
  }
  await assert.rejects(replaceAfterStash({ latest: async () => ({ doc, revision: 3 }), media: async () => {}, stash: async () => {}, current: () => true, replace: async () => ({ error: 'conflict' }) }), { code: 'LOCAL_CONFLICT' });
});
test('lost PUT response/interrupted confirm recover confirm-first without another upload', async () => {
  const calls = [];
  await recoverTake({ row: { id: 'take', status: 'pending' }, confirm: async id => calls.push(id), reserve: async () => { throw Error('unexpected'); }, put: async () => { throw Error('unexpected'); } });
  assert.deepEqual(calls, ['take']);
});
test('missing object is reserved and uploaded; 412 proceeds to confirmation', async () => {
  for (const status of [200, 412]) {
    const calls = [];
    await recoverTake({ row: { id: 'old', status: 'pending' }, confirm: async id => { calls.push(`confirm:${id}`); if (id === 'old') throw { code: 'take_upload_missing' }; },
      reserve: async () => { calls.push('reserve'); return { take_id: 'new', status: 'pending' }; },
      put: async () => { calls.push('put'); return { ok: status === 200, status }; } });
    assert.deepEqual(calls, ['confirm:old', 'reserve', 'put', 'confirm:new']);
  }
});
test('restore keeps document identity and creation time as a single validated edit', () => {
  const source = { ...doc, id: crypto.randomUUID(), title: 'Old version', createdAt: 0, updatedAt: 0 };
  const restored = restoreVersion(doc, source, 10);
  assert.equal(restored.id, doc.id); assert.equal(restored.createdAt, 1); assert.equal(restored.updatedAt, 10); assert.equal(restored.title, source.title);
  assert.equal(doc.title, 'Untitled beat 1');
});

test('Save as copy refuses cloud-only takes before writing; shelf copies are unlinked', async () => {
  const { createDeviceCopy } = await import('../app/veyrnox/_lib/music/beat/beatCloudRules.mjs');
  const withTake = { ...doc, assets: { a1: { source: 'take', ref: 'local-take' } } };
  const written = [], create = async (...args) => { written.push(args); return { revision: 1 }; };
  assert.equal((await createDeviceCopy(withTake, [], create, id, 2)).error, 'cloud_only_takes'); assert.equal(written.length, 0);
  const nextId = crypto.randomUUID(); assert.equal((await createDeviceCopy(withTake, [{ id: 'local-take' }], create, nextId, 2)).id, nextId);
  assert.equal(written.length, 1); assert.equal(written[0].length, 1, 'no cloud link passed to createBeat');
  assert.equal(written[0][0].id, nextId); assert.equal(written[0][0].createdAt, 2);
});

test('same-timestamp and backwards-clock edits still sync by local revision', () => {
  const record = { doc, cloud: link, revision: 4 };
  assert.equal(needsSync(record, userId, 3), true);
  assert.equal(needsSync(record, userId, 4), false);
  assert.equal(needsSync(record, userId, null), false, 'opening checks the account with a read');
});


test('removed projects stop retries and require explicit relinking even after reopening', () => {
  const removed = removedLink(userId);
  assert.deepEqual(removed, { userId, projectId: null, revision: 0 });
  assert.equal(validCloudLink(removed), true);
  assert.equal(isRemoved(removed), true);
  assert.equal(maySync(removed, userId), false);
  assert.equal(needsSync({ doc, cloud: removed, revision: 1 }, userId), false);
  assert.equal(errorState({ code: 'NOT_FOUND', status: 404 }), 'removed');
  assert.equal(retryDelay(0, { code: 'NOT_FOUND', status: 404 }), null);
  const relinked = decideCloudLink({ id, doc, updatedAt: 1, revision: 1, cloud: removed }, removed,
    { ...removed, syncedUpdatedAt: 0 }).record;
  assert.equal(needsSync(relinked, userId), true);
});

test('quiet replacement uses the atomic path without media or stash', async () => {
  const events = [];
  await replaceAfterStash({ latest: async () => ({ doc, revision: 1 }), current: () => true,
    replace: async () => events.push('replace') });
  assert.deepEqual(events, ['replace']);
});

test('version reasons and local Today time match the Versions labels', async () => {
  const { versionReason, versionTime } = await import('../app/veyrnox/_lib/music/beat/beatVersionLabels.mjs');
  for (const [reason, label] of Object.entries({ autosave: 'Autosave', checkpoint: 'Checkpoint',
    conflict: 'Account version kept when you chose Keep mine', stash: 'Your changes kept when you chose Load theirs' }))
    assert.equal(versionReason(reason), label);
  const now = new Date(2026, 10, 15, 17, 0);
  assert.equal(versionTime(new Date(2026, 10, 15, 14, 2), now), 'Today 14:02');
  assert.match(versionTime(new Date(2026, 10, 14, 14, 2), now), /2026 14:02$/);
});
