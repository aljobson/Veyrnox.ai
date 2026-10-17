import test from 'node:test';
import assert from 'node:assert/strict';
import { emptySequence, addSequenceMedia, addSequenceClip, addSequenceTrack, addSequenceText, updateSequenceClip, updateSequenceTrack, splitSequenceClip, splitSequenceAtFrames, removeSequenceClip, duplicateSequence, moveSequence, trimSequence, upgradeSequence, sequenceEnd } from '../app/veyrnox/_lib/editorSequence.mjs';
import { validateSequence } from '../app/veyrnox/_lib/editorSequenceValidation.mjs';
import { emptyTimeline, addMedia, addVideoClip } from '../app/veyrnox/_lib/editorTimeline.mjs';
import { sequenceLayers } from '../app/veyrnox/_lib/editorSequenceRender.mjs';
import { emptyProjectDocument, withTimeline, validProjectDocument } from '../lib/projectDocument.js';
const media = { id: 'l-test', kind: 'video', frames: 300, width: 1280, height: 720, hasAudio: true, name: 'Test.mp4' };
const ok = value => { assert.equal(value.error, undefined); assert.equal(validateSequence(value), null); return value; };
const fixture = () => ok(addSequenceClip(ok(addSequenceMedia(emptySequence(), media)), 'video', media.id, { len: 120 }));
test('independent visual and audio tracks overlap without length drift; hidden layers and muted flags survive', () => {
    let tl = fixture(); tl = ok(addSequenceTrack(tl, 'video')); const lane = tl.tracks.at(-1).id;
    tl = ok(addSequenceClip(tl, 'video', media.id, { start: 30, len: 60, trackId: lane }));
    tl = ok(addSequenceClip(tl, 'audio', media.id, { start: 0, len: 120 }));
    tl = ok(addSequenceTrack(tl, 'audio')); tl = ok(addSequenceClip(tl, 'audio', media.id, { start: 0, len: 120, trackId: tl.tracks.at(-1).id }));
    assert.equal(sequenceEnd(tl), 120); assert.equal(sequenceLayers(tl, 40).visuals.length, 2);
    tl = ok(updateSequenceTrack(tl, lane, { hidden: true })); assert.equal(sequenceLayers(tl, 40).visuals.length, 1);
});
test('locked tracks refuse split, trim, move, delete and duplicate without changing the input', () => {
    const tl = ok(updateSequenceTrack(fixture(), 'video-0', { locked: true })), snapshot = JSON.stringify(tl);
    for (const result of [splitSequenceClip(tl, 'video', 'v1', 30), trimSequence(tl, 'video', 'v1', 'out', -1), moveSequence(tl, 'video', 'v1', 10), removeSequenceClip(tl, 'video', 'v1'), duplicateSequence(tl, { track: 'video', id: 'v1' })]) assert.match(result.error, /Unlock/);
    assert.equal(JSON.stringify(tl), snapshot);
});
test('rate-aware splits and trims preserve source alignment; bounds are refused atomically', () => {
    let tl = ok(updateSequenceClip(fixture(), 'video', 'v1', { rate: 2, len: 60 }));
    tl = ok(splitSequenceClip(tl, 'video', 'v1', 15)); assert.equal(tl.video[1].in, 30); assert.equal(tl.video[1].start, 15);
    tl = ok(trimSequence(tl, 'video', 'v2', 'in', 5)); assert.equal(tl.video[1].in, 40); assert.equal(tl.video[1].start, 20);
    assert.match(updateSequenceClip(tl, 'video', 'v2', { len: 300 }).error, /range/);
});
test('snapping aligns starts and ends; ripple deletion affects only its lane', () => {
    let tl = fixture(); tl = ok(addSequenceClip(tl, 'video', media.id, { len: 90 }));
    tl = ok(moveSequence(tl, 'video', 'v2', 123, 'video-0', true)); assert.equal(tl.video[1].start, 120);
    tl = ok(removeSequenceClip(tl, 'video', 'v1', true)); assert.equal(tl.video[0].start, 0);
});
test('v2 upgrade preserves clip positions and settings; a v3 document round-trips and validates strict keys', () => {
    let legacy = addMedia(emptyTimeline(), media); legacy = addVideoClip(legacy, media.id, { len: 60 }); legacy = addVideoClip(legacy, media.id, { in: 60, len: 90 });
    const tl = ok(upgradeSequence(legacy)); assert.deepEqual(tl.video.map(c => c.start), [0, 60]);
    const id = '11111111-1111-4111-8111-111111111111', doc = withTimeline(emptyProjectDocument(id), tl);
    assert.equal(doc.schema_version, 3); assert.equal(validProjectDocument(JSON.parse(JSON.stringify(doc)), id), true);
    assert.equal(validProjectDocument({ ...doc, schema_version: 2 }, id), false);
    assert.equal(validProjectDocument({ ...doc, timeline: { ...tl, extra: true } }, id), false);
    assert.equal(validProjectDocument({ ...doc, timeline: { ...tl, tracks: [] } }, id), false);
});
test('images hold beyond their nominal source duration; multiline text has bounded timing', () => {
    let tl = ok(addSequenceMedia(emptySequence(), { ...media, kind: 'image', hasAudio: false, frames: 90 }));
    tl = ok(addSequenceClip(tl, 'video', media.id, { len: 300 })); tl = ok(addSequenceText(tl, { text: 'Line one\nLine two', start: 300, len: 120 }));
    assert.equal(sequenceEnd(tl), 420); assert.match(addSequenceText(tl, { text: 'bad\u0000' }).error, /text/i);
});

test('overlapping caption layers render in their track order after a reorder', () => {
    let tl = ok(addSequenceText(emptySequence(), { text: 'First', start: 0, len: 90 }));
    tl = ok(addSequenceTrack(tl, 'text')); const lane = tl.tracks.at(-1).id;
    tl = ok(addSequenceText(tl, { text: 'Second', start: 0, len: 90, trackId: lane }));
    assert.deepEqual(sequenceLayers(tl, 30).texts.map(t => t.text), ['First', 'Second']);
    const index = tl.tracks.findIndex(t => t.id === lane), tracks = [...tl.tracks];
    [tracks[index], tracks[index - 1]] = [tracks[index - 1], tracks[index]];
    assert.deepEqual(sequenceLayers({ ...tl, tracks }, 30).texts.map(t => t.text), ['Second', 'First']);
});
test('splitSequenceAtFrames cuts a clip at several frames as one edit, last to first, and is all or nothing', () => {
    const tl = ok(addSequenceClip(ok(addSequenceMedia(emptySequence(), media)), 'video', media.id, { len: 240 }));
    const cut = ok(splitSequenceAtFrames(tl, 'video', 'v1', [180, 60, 120, 60]));
    assert.deepEqual(cut.video.map(c => [c.start, c.len, c.in]), [[0, 60, 0], [60, 60, 60], [120, 60, 120], [180, 60, 180]]);
    assert.equal(cut.video[0].id, 'v1', 'the first part keeps the original id');
    assert.equal(sequenceEnd(cut), sequenceEnd(tl));
    const snapshot = JSON.stringify(tl);
    for (const [frames, pattern] of [[[100, 240], /frame 240 is outside/], [[0], /outside/], [[10.5], /whole frames/], [[], /no cuts/]]) {
        assert.match(splitSequenceAtFrames(tl, 'video', 'v1', frames).error, pattern);
    }
    const locked = ok(updateSequenceTrack(tl, 'video-0', { locked: true }));
    assert.ok(splitSequenceAtFrames(locked, 'video', 'v1', [60]).error);
    assert.equal(JSON.stringify(tl), snapshot, 'the input is never changed');
    const trimmed = ok(updateSequenceClip(tl, 'video', 'v1', { in: 30, len: 120 }));
    assert.deepEqual(ok(splitSequenceAtFrames(trimmed, 'video', 'v1', [50])).video.map(c => [c.start, c.in, c.len]), [[0, 30, 50], [50, 80, 70]]);
});
