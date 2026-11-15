import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

let shelf, calls;
globalThis.beatUploadFixture = {
  getStoredUserId: () => 'owner',
  getShelf: () => shelf,
  hydrateShelf: async () => {},
  gatewayFetch: async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) });
    return { take_id: 'take', status: 'ready' };
  },
};
const exportsByFile = {
  '/gateway.js': ['gatewayFetch'],
  '/authClient.js': ['getStoredUserId'],
  '/instrumentShelf.js': ['getShelf', 'hydrateShelf'],
};
const hooks = registerHooks({ load(url, context, next) {
  for (const [suffix, names] of Object.entries(exportsByFile)) if (url.endsWith(suffix))
    return { format: 'module', shortCircuit: true, source: `export const { ${names.join(', ')} } = globalThis.beatUploadFixture;` };
  return next(url, context);
} });
const { uploadTake } = await import('../app/veyrnox/_lib/music/beat/beatCloud.js');
hooks.deregister();
test.after(() => { delete globalThis.beatUploadFixture; });

for (const [label, length, seconds] of [['WAV bytes', 29999979, 500], ['duration', 1, 600.01]]) {
  test(`oversized ${label} never reserves or encodes a take`, async () => {
    calls = [];
    // A length-only sample stand-in also proves rejection happens before WAV allocation.
    shelf = [{ id: 'local', samples: { length }, sampleRate: 96000, seconds }];
    await assert.rejects(uploadTake('beat', { ref: 'local', encodedBytes: 0, durationSec: 1 }, null,
      { userId: 'owner' }), { status: 400, code: 'INVALID_REQUEST', message: 'Only on this device' });
    assert.deepEqual(calls, []);
  });
}
test('a take at the duration limit still reserves its measured WAV size', async () => {
  calls = [];
  shelf = [{ id: 'local', samples: new Float32Array(600), sampleRate: 1, seconds: 600 }];
  const result = await uploadTake('beat', { ref: 'local', durationSec: 600 }, null, { userId: 'owner' });
  assert.equal(result.status, 'ready');
  assert.deepEqual(calls, [{ url: '/music/beat-projects/beat/takes',
    body: { take_ref: 'local', byte_size: 1244, duration_sec: 600 } }]);
});
