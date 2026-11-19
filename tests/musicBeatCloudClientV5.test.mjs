import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { configureBeatWrites, capabilityGeneration } from '../app/veyrnox/_lib/music/beat/beatWriteVersion.mjs';
import { createBeat, upgradeBeatToV5 } from '../app/veyrnox/_lib/music/beat/beatDocument.mjs';
const calls = [], userId = crypto.randomUUID();
globalThis.beatV5ClientFixture = {
  gatewayFetch: async (url, init) => { calls.push({ url, ...init }); return {}; },
  getStoredUserId: () => userId, loadLocalTake: async () => { assert.fail('no media requested'); },
};
const hooks = registerHooks({ load(url, context, next) {
  const name = [['/gateway.js', 'gatewayFetch'], ['/authClient.js', 'getStoredUserId'], ['/localTakes.js', 'loadLocalTake']].find(([suffix]) => url.endsWith(suffix))?.[1];
  return name ? { format: 'module', shortCircuit: true, source: `export const { ${name} } = globalThis.beatV5ClientFixture;` } : next(url, context);
} });
const api = await import('../app/veyrnox/_lib/music/beat/beatCloud.js');
hooks.deregister();
test.after(() => { delete globalThis.beatV5ClientFixture; });
test('every actual cloud save/delete declares reader 5 while document payloads stay at writer 4', async () => {
  const doc = createBeat({ id: crypto.randomUUID(), now: 1 });
  for (const mode of ['autosave', 'checkpoint', 'stash']) {
    await api.saveCloudBeat(doc.id, { expected_revision: 1, doc_json: JSON.stringify(doc), mode, client_beat_version: 4 }, 'client-test-key', { userId });
    const sent = JSON.parse(calls.at(-1).body);
    assert.equal(sent.client_beat_version, 5); assert.equal(JSON.parse(sent.doc_json).version, 4);
  }
  await api.removeCloudBeat(doc.id, 1, { userId });
  assert.equal(JSON.parse(calls.at(-1).body).client_beat_version, 5);
  const count = calls.length;
  for (const version of [5, 6, 999]) assert.throws(() => api.saveCloudBeat(doc.id, { doc_json: JSON.stringify({ ...upgradeBeatToV5(doc), version }) }, 'client-test-key', { userId }),
    error => error.code === (version === 5 ? 'v5_write_disabled' : 'unsupported_version'));
  assert.equal(calls.length, count);
});
test('rollback invalidates writes but existing take playback downloads remain readable', async () => {
  configureBeatWrites(true); const writeGeneration = capabilityGeneration();
  configureBeatWrites(false);
  const before = calls.length;
  await api.listTakes('beat', { userId, writeGeneration });
  await api.takeUrl('beat', 'take', { userId, writeGeneration });
  assert.equal(calls.length, before + 2);
  assert.equal(calls.at(-1).url, '/music/beat-projects/beat/takes/take');
});

test('in-flight PUT returns the committed response after a capability change', async t => {
  for (const version of [4, 5]) {
    configureBeatWrites(true);
    const doc = { ...createBeat({ id: crypto.randomUUID(), now: 1 }), version };
    const pending = api.saveCloudBeat(doc.id, { doc_json: JSON.stringify(doc) }, 'in-flight', { userId });
    configureBeatWrites(false);
    const result = await pending;
    assert.deepEqual(result, {});
  }
  t.after(() => { configureBeatWrites(false); });
});
