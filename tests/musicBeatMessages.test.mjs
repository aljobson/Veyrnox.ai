import test from 'node:test';
import assert from 'node:assert/strict';
import { make, freeze } from './musicBeatFixtures.mjs';
import * as ops from '../app/veyrnox/_lib/music/beat/beatOps.mjs';
import { arrangementMessage } from '../app/veyrnox/_lib/music/beat/beatMessages.mjs';

test('arrangement announcements describe committed destinations, ranges and track names', () => {
  const doc = freeze(ops.addTrack(make(), '808'));
  const cases = [
    [ops.moveRegion(doc, 'r1', 4 * 3840, 't2'), { label: 'move region', regionId: 'r1' }, 'Moved to bar 5 on Drums 2'],
    [ops.copyRegion(doc, 'r1', 4 * 3840, 't2'),
      { label: 'copy region', regionId: 'r1', trackId: 't2', start: 4 * 3840 }, 'Copied to bar 5 to bar 9'],
    [ops.resizeRegion(doc, 'r1', 3 * 3840), { label: 'resize region', regionId: 'r1' }, 'Now bar 1 to bar 4'],
    [ops.trimRegionStart(doc, 'r1', 3840), { label: 'trim region', regionId: 'r1' }, 'Now bar 2 to bar 5'],
    [ops.splitRegion(doc, 'r1', 2 * 3840), { label: 'split region', regionId: 'r1' }, 'Split at bar 3'],
    [ops.duplicateRegion(doc, 'r1'), { label: 'duplicate region', regionId: 'r1' }, 'Duplicated to bar 5 to bar 9'],
    [ops.deleteRegion(doc, 'r1'), { label: 'delete region', regionId: 'r1' }, 'Region deleted'],
    [ops.setCycle(doc, { on: true, start: 3 * 3840, end: 6 * 3840 }), { label: 'change cycle' }, 'Cycle bar 4 to bar 7'],
  ];
  for (const [after, options, expected] of cases) {
    assert.equal(arrangementMessage(doc, after, options), expected);
  }
  assert.equal(arrangementMessage(make(), doc, { label: 'add track' }), 'Track added: Drums 2');
  const shorter = ops.resizeRegion(doc, 'r1', 3840);
  assert.equal(arrangementMessage(shorter, ops.resizeRegion(shorter, 'r1', 4 * 3840),
    { label: 'resize region', regionId: 'r1' }), 'Now bar 1 to bar 5');
});

test('overlap fragments do not displace the region being announced', () => {
  const doc = make();
  const inserted = ops.addRegion(doc, 't1', 3840, 'B');
  assert.equal(arrangementMessage(doc, inserted, { label: 'add region', trackId: 't1', start: 3840 }),
    'Added at bar 2 to bar 3');
  const moved = ops.moveRegion(inserted, 'r2', 2 * 3840, 't1');
  assert.equal(arrangementMessage(inserted, moved, { label: 'move region', regionId: 'r2' }),
    'Moved to bar 3 on Drums');
  const copied = ops.copyRegion(inserted, 'r2', 0, 't1');
  assert.equal(arrangementMessage(inserted, copied,
    { label: 'copy region', regionId: 'r2', trackId: 't1', start: 0 }), 'Copied to bar 1 to bar 2');
});
