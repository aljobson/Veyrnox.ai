import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyTimeline, addText, totalFrames, validateTimeline, addAudioClip, setVolume } from '../app/veyrnox/_lib/editorTimeline.mjs';
import { importMedia, insertMedia, duplicateSelection, detachAudio, splitSelection, trimEdge, removeMedia } from '../app/veyrnox/_lib/editorCommands.mjs';
import { createHistory, commitHistory, undoHistory, redoHistory, retainedMedia } from '../app/veyrnox/_lib/editorHistory.mjs';
import { localMediaId } from '../app/veyrnox/_lib/editorMedia.mjs';
const video = (id = 'l-source', frames = 300) => ({ id, kind: 'video', frames, name: 'source.mp4', hasAudio: true, width: 1280, height: 720 });
const ok = x => { assert.equal(x.error, undefined, x.error); assert.equal(validateTimeline(x), null); return x; };

test('text-only titles have a duration and trailing text extends an edit', () => {
    const title = ok(addText(emptyTimeline(), { text: 'Title', start: 30, len: 90 }));
    assert.equal(totalFrames(title), 120);
    const mixed = ok(addText(importMedia(emptyTimeline(), video()), { text: 'End', start: 290, len: 90 }));
    assert.equal(totalFrames(mixed), 380);
});
test('long sources are kept in full while only available timeline time is inserted', () => {
    const first = ok(importMedia(emptyTimeline(), video('long', 6000)));
    assert.equal(first.media.long.frames, 6000); assert.equal(first.video[0].len, 1800);
    const second = ok(importMedia(first, video('next')));
    assert.ok(second.media.next); assert.equal(second.video.length, 1);
    assert.match(insertMedia(second, 'next').error, /full/);
    assert.match(importMedia(first, video('long', 30)).error, /already/);
});
test('local media identifiers cannot collide with a reopened l-1 source', () => {
    const ids = new Set(Array.from({ length: 100 }, localMediaId));
    assert.equal(ids.size, 100); assert.ok(!ids.has('l-1'));
    for (const id of ids) assert.match(id, /^[A-Za-z0-9_-]{1,64}$/);
});
test('duplicating a trimmed muted clip preserves its source range and creates an independent id', () => {
    let tl = ok(importMedia(emptyTimeline(), video()));
    tl = ok(trimEdge(tl, 'video', 'v1', 'in', 30)); tl = ok(setVolume(tl, 'video', 'v1', 0.25));
    const copy = ok(duplicateSelection(tl, { track: 'video', id: 'v1' }));
    assert.deepEqual(copy.video.map(x => [x.in, x.len, x.volume]), [[30,270,0.25],[30,270,0.25]]);
    assert.notEqual(copy.video[0].id, copy.video[1].id);
    const full = ok(importMedia(emptyTimeline(), video('full', 1800)));
    assert.match(duplicateSelection(full, { track: 'video', id: 'v1' }).error, /60 seconds/);
});
test('extracted audio transfers volume without doubling it and failure preserves the original video', () => {
    let tl = ok(setVolume(importMedia(emptyTimeline(), video()), 'video', 'v1', 0.4));
    const extracted = ok(detachAudio(tl, 'v1'));
    assert.equal(extracted.video[0].volume, 0); assert.equal(extracted.audio[0].volume, 0.4);
    assert.equal(tl.video[0].volume, 0.4);
    const muted = ok(importMedia(emptyTimeline(), { ...video(), hasAudio: false }));
    assert.match(detachAudio(muted, 'v1').error, /no audio/);
    assert.equal(muted.video[0].volume, 1);
});
test('text can be split and duplicated with independent timing', () => {
    const title = ok(addText(emptyTimeline(), { text: 'Title', start: 30, len: 90 }));
    const split = ok(splitSelection(title, { track: 'text', id: 't1' }, 60));
    assert.deepEqual(split.text.map(x => [x.start,x.len]), [[30,30],[60,60]]);
    assert.equal(totalFrames(split), 120);
    const copy = ok(duplicateSelection(title, { track: 'text', id: 't1' }));
    assert.deepEqual(copy.text.map(x => x.start), [30,120]);
    assert.match(splitSelection(title, { track: 'text', id: 't1' }, 30).error, /inside/);
});
test('trimming audio at its first edge preserves its out point beside another sound', () => {
    let tl = ok(importMedia(emptyTimeline(), video()));
    tl = ok(addAudioClip(tl, 'l-source', { start: 60, in: 60, len: 60 }));
    tl = ok(addAudioClip(tl, 'l-source', { start: 120, in: 120, len: 60 }));
    const next = ok(trimEdge(tl, 'audio', 'a2', 'in', -30));
    assert.deepEqual([next.audio[0].start, next.audio[0].in, next.audio[0].len], [30,30,90]);
    assert.match(trimEdge(next, 'audio', 'a2', 'out', 1).error, /overlap/);
});
test('undo/redo restores files and clips, a new edit clears redo, and retention is bounded', () => {
    const first = ok(importMedia(emptyTimeline(), video()));
    let h = commitHistory(createHistory(emptyTimeline()), first);
    h = commitHistory(h, ok(removeMedia(first, 'l-source')));
    assert.ok(retainedMedia(h).has('l-source'));
    const restored = undoHistory(h); assert.deepEqual(restored.now, first);
    assert.deepEqual(redoHistory(restored).now, h.now);
    h = commitHistory(restored, ok(addText(first, { text: 'Branch' })));
    assert.equal(h.future.length, 0);
    h = commitHistory(h, ok(removeMedia(h.now, 'l-source')));
    for (let n = 0; n < 55; n++) h = commitHistory(h, { ...h.now, seq: h.now.seq + 1 });
    assert.equal(h.past.length, 50); assert.ok(!retainedMedia(h).has('l-source'));
});
