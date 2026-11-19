import test from 'node:test';
import assert from 'node:assert/strict';
import { createBeat, migrateBeat, upgradeBeatToV5, validateBeat } from '../app/veyrnox/_lib/music/beat/beatDocument.mjs';
import { BEAT_WRITE_VERSION, assertBeatWritable } from '../app/veyrnox/_lib/music/beat/beatCompatibility.mjs';
import { addMarker, moveMarker, renameMarker, removeMarker, nextMarker, prevMarker } from '../app/veyrnox/_lib/music/beat/beatMarkers.mjs';
import { rippleDeleteRegion, rippleInsertGap } from '../app/veyrnox/_lib/music/beat/beatRipple.mjs';
import { searchClips } from '../app/veyrnox/_lib/music/beat/beatClipSearch.mjs';
import { snapTick } from '../app/veyrnox/_lib/music/beat/beatTime.mjs';
import { tryOp, restoreVersion } from '../app/veyrnox/_lib/music/beat/beatOps.mjs';
import { createHistory, record, undo, redo } from '../app/veyrnox/_lib/music/beat/beatHistory.mjs';
import { BEAT_TEMPLATES, createBeatFromTemplate } from '../app/veyrnox/_lib/music/beat/beatTemplates.mjs';
import { saveRequest, conflictRequest, parseCloudBeat, classifyCloudBeat, errorState, retryDelay } from '../app/veyrnox/_lib/music/beat/beatCloudRules.mjs';
const fresh = () => createBeat({ id: crypto.randomUUID(), now: 1 });
const typed = code => error => error.code === code;
test('v5 recognizes the complete v4 schema plus markers, passes through unchanged, upgrades only explicitly', () => {
  for (const template of BEAT_TEMPLATES) {
    const old = createBeatFromTemplate({ id: crypto.randomUUID(), template: template.id, now: 1 });
    assert.equal(old.version, BEAT_WRITE_VERSION); assert.equal(BEAT_WRITE_VERSION, 4);
    const v5 = upgradeBeatToV5(old); v5.markers = [{ id: 'intro', name: 'Intro', tick: 3 }];
    const bytes = JSON.stringify(v5);
    assert.equal(validateBeat(v5).ok, true);
    assert.throws(() => restoreVersion(v5, old), typed('v5_write_disabled'));
    assert.equal(migrateBeat(v5), v5); assert.equal(upgradeBeatToV5(v5), v5);
    assert.equal(JSON.stringify(parseCloudBeat(bytes, v5.id)), bytes);
    assert.equal(JSON.stringify(v5), bytes); assert.equal(old.version, 4);
    assert.equal(JSON.parse(saveRequest(old, 1).doc_json).version, 4);
    for (const write of [d => assertBeatWritable(d), d => saveRequest(d, 1), d => conflictRequest('theirs', d, 1)])
      assert.throws(() => write(v5), typed('v5_write_disabled'));
  }
  const v5 = upgradeBeatToV5(fresh());
  for (const markers of [null, {}, [{ id: 'x', name: 'X', tick: -1 }], [{ id: 'x', name: 'X', tick: 0.5 }],
    [{ id: 'x', name: 'X'.repeat(41), tick: 0 }], Array.from({ length: 100 }, (_, i) => ({ id: `${i}`, name: 'X', tick: i })),
    [{ id: 'x', name: 'X', tick: 0 }, { id: 'x', name: 'Y', tick: 1 }]]) assert.equal(validateBeat({ ...v5, markers }).ok, false);
  assert.equal(validateBeat({ ...fresh(), markers: [] }).ok, false);
  assert.equal(validateBeat({ ...v5, clips: null }).ok, false);
  assert.equal(validateBeat({ ...v5, unexpected: true }).ok, false);
});
test('marker edits are immutable, typed, bounded and searchable in time without reordering the document', () => {
  const old = fresh(), doc = upgradeBeatToV5(old);
  for (const op of [d => addMarker(d, { id: 'a', name: 'A', tick: 0 }), d => moveMarker(d, 'a', 1),
    d => renameMarker(d, 'a', 'B'), d => removeMarker(d, 'a'), d => nextMarker(d, 0), d => prevMarker(d, 0)])
    assert.throws(() => op(old), typed('markers_require_v5'));
  let next = addMarker(doc, { id: 'a', name: 'Intro', tick: 120 }, 2);
  next = addMarker(next, { id: 'b', name: 'End', tick: 480 }, 3);
  assert.equal(doc.markers, undefined);
  assert.equal(nextMarker(next, 120).id, 'b'); assert.equal(prevMarker(next, 480).id, 'a');
  assert.equal(prevMarker(next, 0), null); assert.equal(nextMarker(next, 480), null);
  const bytes = JSON.stringify(next);
  assert.equal(moveMarker(next, 'b', 240, 4).markers[1].tick, 240);
  assert.equal(renameMarker(next, 'a', 'Start', 4).markers[0].name, 'Start');
  assert.equal(removeMarker(next, 'a', 4).markers.length, 1);
  assert.equal(JSON.stringify(next), bytes);
  assert.equal(tryOp(next, d => addMarker(d, { id: 'a', name: 'Duplicate', tick: 0 })).code, 'invalid_markers');
  assert.throws(() => moveMarker(next, 'missing', 0), typed('marker_not_found'));
  assert.throws(() => moveMarker(next, 'a', Infinity), typed('invalid_markers'));
});
function arranged() {
  const doc = fresh();
  doc.tracks[0].regions = [0, 3840, 9600].map((start, i) => ({ id: `r${i}`, start, length: 1920, offset: 0, pattern: 'A' }));
  doc.tracks.push({ ...structuredClone(doc.tracks[0]), id: 't2', regions: [{ ...doc.tracks[0].regions[0], id: 'other' }] });
  return doc;
}
test('ripple delete and insert affect only later regions on the selected track and form one undo step', () => {
  const doc = arranged(), bytes = JSON.stringify(doc);
  for (const operation of [d => rippleDeleteRegion(d, 't1', 'r1', 1), d => rippleInsertGap(d, 't1', 3840, 1920, 1)]) {
    const next = operation(doc);
    assert.equal(validateBeat(next).ok, true); assert.deepEqual(next.tracks[1], doc.tracks[1]);
    let h = record(createHistory(doc), next); assert.equal(h.past.length, 1);
    h = undo(h); assert.deepEqual(h.present, doc); h = redo(h); assert.deepEqual(h.present, next);
  }
  assert.deepEqual(rippleDeleteRegion(doc, 't1', 'r1').tracks[0].regions.map(r => r.start), [0, 7680]);
  assert.deepEqual(rippleInsertGap(doc, 't1', 3840, 1920).tracks[0].regions.map(r => r.start), [0, 5760, 11520]);
  assert.equal(JSON.stringify(doc), bytes);
  for (const length of [-1, 0, 1.5, Infinity]) assert.throws(() => rippleInsertGap(doc, 't1', 0, length), typed('invalid_ticks'));
  for (const length of [1, 512 * 3840]) assert.throws(() => rippleInsertGap(doc, 't1', 0, length), typed('invalid_ripple'));
  assert.throws(() => rippleDeleteRegion(doc, 't2', 'r1'), typed('region_not_found'));
  assert.throws(() => rippleInsertGap(doc, 'missing', 0, 240), typed('track_not_found'));
});
test('clip selector searches region, track, MIDI clip and asset labels case-insensitively; existing snap is reused', () => {
  const doc = arranged(); doc.tracks[0].regions[0].name = 'Opening';
  doc.assets.a1 = { name: 'Warm Piano' }; doc.tracks[0].regions[1].assetId = 'a1';
  doc.clips.c1 = { name: 'Bass line' }; doc.tracks[0].regions[2].clipId = 'c1';
  assert.deepEqual(searchClips(doc, 'PIANO'), [{ trackId: 't1', regionId: 'r1', label: 'Warm Piano' }]);
  assert.equal(searchClips(doc, 'opening')[0].regionId, 'r0');
  assert.equal(searchClips(doc, 'BASS')[0].regionId, 'r2');
  assert.equal(searchClips(doc, 'DRUMS').length, 4); assert.deepEqual(searchClips(doc, 'missing'), []);
  assert.deepEqual(searchClips(doc, ''), []); assert.deepEqual(searchClips(doc, '   '), []);
  assert.equal(snapTick(250), 240); assert.equal(snapTick(3000, 3840), 3840);
});
test('cloud readers distinguish unsupported from damaged without mutating bytes; update-required never retries', () => {
  for (const version of [6, 999]) {
    const doc = { ...fresh(), version }, raw = JSON.stringify(doc);
    assert.equal(classifyCloudBeat(raw, doc.id), 'unsupported-version');
    assert.throws(() => parseCloudBeat(raw, doc.id), typed('unsupported_version'));
    assert.equal(JSON.stringify(doc), raw);
  }
  assert.equal(classifyCloudBeat('{', 'x'), 'damaged');
  for (const code of ['BEAT_CLIENT_OUTDATED', 'unsupported_version', 'v5_write_disabled']) {
    assert.equal(errorState({ code, status: 409 }), 'update_required'); assert.equal(retryDelay(0, { code }), null);
  }
});
