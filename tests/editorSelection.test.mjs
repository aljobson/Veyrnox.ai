import test from 'node:test';
import assert from 'node:assert/strict';
import { emptySequence, addSequenceMedia, addSequenceClip, addSequenceText, updateSequenceTrack, sequenceTransitionAfter } from '../app/veyrnox/_lib/editorSequence.mjs';
import { groupSelection, linkedSelection, copySelection, pasteSelection, deleteSelection, moveSelection, trackAudible } from '../app/veyrnox/_lib/editorSelection.mjs';
import { evaluatedTransform } from '../app/veyrnox/_lib/editorSequenceRender.mjs';
const media = { id: 'local', kind: 'video', frames: 600, name: 'Example', hasAudio: true, width: 1280, height: 720 };
const fixture = () => addSequenceText(addSequenceClip(addSequenceMedia(emptySequence(), media), 'video', media.id, { len: 90 }), { text: 'Example', start: 0, len: 90 });
const selected = [{ track: 'video', id: 'v1' }, { track: 'text', id: 't2' }];
test('groups link different layer types; moves preserve their offsets and reject bounds atomically', () => {
    const grouped = groupSelection({ ...fixture(), text: fixture().text.map(c => ({ ...c, start: 30 })) }, selected), before = JSON.stringify(grouped);
    assert.deepEqual(linkedSelection(grouped, selected[0]), selected);
    const moved = moveSelection(grouped, selected, selected[0], 120, 'video-0', false, 0);
    assert.equal(moved.video[0].start, 120); assert.equal(moved.text[0].start, 150);
    assert.ok(moveSelection(grouped, selected, selected[0], 17990, 'video-0', false, 0).error);
    assert.equal(JSON.stringify(grouped), before);
});
test('copy/paste recreates missing media, issues distinct ids and groups, and preserves the source document', () => {
    const original = groupSelection(fixture(), selected), copy = copySelection(original, selected);
    const pasted = pasteSelection(emptySequence(), copy, 60);
    assert.equal(pasted.video[0].start, 60); assert.equal(pasted.text[0].start, 60);
    assert.deepEqual(pasted.media.local, media); assert.equal(pasted.video[0].groupId, pasted.text[0].groupId);
    const again = pasteSelection(pasted, copy, 180); assert.equal(new Set([...again.video, ...again.text].map(c => c.id)).size, 4);
    assert.notEqual(again.video[1].groupId, again.video[0].groupId);
    assert.equal(original.video.length, 1);
});
test('a locked member rejects grouped deletion and movement; overlapping ripple ranges are removed once', () => {
    const locked = updateSequenceTrack(fixture(), 'text-0', { locked: true });
    assert.ok(deleteSelection(locked, selected).error); assert.ok(moveSelection(locked, selected, selected[0], 60, 'video-0', false, 0).error);
    let tl = fixture(); tl = addSequenceClip(tl, 'video', media.id, { start: 30, len: 90 }); tl = addSequenceClip(tl, 'video', media.id, { start: 120, len: 30 });
    const cut = deleteSelection(tl, [{track:'video',id:'v1'}, {track:'video',id:'v3'}], true);
    assert.equal(cut.video[0].start, 0); assert.equal(cut.text[0].start, 0);
});
test('solo selection preserves mute precedence and suppresses sound on other tracks', () => {
    const tl = updateSequenceTrack(fixture(), 'audio-0', { solo: true });
    assert.equal(trackAudible(tl, tl.video[0]), false);
    assert.equal(trackAudible(tl, { trackId: 'audio-0' }), true);
    assert.equal(trackAudible(updateSequenceTrack(tl, 'audio-0', { muted: true }), { trackId: 'audio-0' }), false);
});
test('transition lookup follows lane adjacency rather than insertion order; animated inspector values preserve base settings', () => {
    let tl = fixture(); tl = addSequenceClip(tl, 'video', media.id, { start: 180, len: 60 }); tl = addSequenceClip(tl, 'video', media.id, { start: 90, len: 90, transition: 15 });
    assert.equal(sequenceTransitionAfter(tl, tl.video[0]), 15);
    const clip = { ...tl.video[0], animation: { in: 'zoom', out: 'none', duration: 30 } };
    assert.equal(evaluatedTransform(clip, 0, false).scale, 1); assert.equal(evaluatedTransform(clip, 0).scale, .5);
});
