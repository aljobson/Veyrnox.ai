import test from 'node:test';
import assert from 'node:assert/strict';
import { clearTransientFailures, permanentAssetFailure } from '../app/veyrnox/_lib/music/beat/beatAssetFailures.mjs';

test('only permanent audio failures stick; connection, signing and server failures can retry', () => {
  for (const message of ['This take was deleted', 'Unsupported audio format', 'This sound changed size since it was added',
    'Audio must be at most 120 MB, with a known size.', 'Invalid or missing sound metadata (maximum duration: 600 seconds).']) {
    assert.equal(permanentAssetFailure(new Error(message)), true, message);
  }
  assert.equal(permanentAssetFailure(Object.assign(new Error('decode failed'), { permanent: true })), true);
  assert.equal(permanentAssetFailure(new DOMException('Cannot decode audio', 'EncodingError')), true);
  assert.equal(permanentAssetFailure(new DOMException('Decoder context closed', 'InvalidStateError')), false);
  for (const message of ['Failed to fetch', 'Offline', 'This song version is no longer available', 'Service unavailable']) {
    assert.equal(permanentAssetFailure(new Error(message)), false, message);
  }
  const states = new Map([
    ['offline', { status: 'missing', permanent: false }], ['expired', { status: 'missing', permanent: false }],
    ['deleted', { status: 'missing', permanent: true }], ['cached', { status: 'ready' }],
  ]);
  clearTransientFailures(states, 'offline'); assert.equal(states.has('offline'), false); assert.equal(states.has('expired'), true);
  clearTransientFailures(states); assert.deepEqual([...states.keys()], ['deleted', 'cached']);
});
