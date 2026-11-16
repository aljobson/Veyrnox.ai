import test from 'node:test';
import assert from 'node:assert/strict';
import { coverJobId } from '../app/veyrnox/_lib/projectCover.mjs';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

test('a project is covered by its first video clip', () => {
  const doc = { timeline: { audio: [{ mediaId: `j-${B}` }], video: [{ mediaId: `j-${A}` }, { mediaId: `j-${B}` }] } };
  assert.equal(coverJobId(doc), A);
});

test('audio-only projects fall back to the audio job', () => {
  assert.equal(coverJobId({ timeline: { audio: [{ mediaId: `j-${B}--vocals` }] } }), B);
});

test('empty, malformed and non-job media give no cover', () => {
  assert.equal(coverJobId(null), null);
  assert.equal(coverJobId({}), null);
  assert.equal(coverJobId({ timeline: { video: [{ mediaId: 'upload-1' }, { mediaId: 7 }] } }), null);
  assert.equal(coverJobId({ timeline: 'x' }), null);
});

test('media in unknown track groups is still found', () => {
  assert.equal(coverJobId({ timeline: { extras: { clips: [{ mediaId: `j-${A}` }] } } }), A);
});
