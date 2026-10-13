import test from 'node:test';
import assert from 'node:assert/strict';
import { timelineThumbnailFrames, timelineWaveform, mediaWaveform, createArtworkQueue, TIMELINE_ARTWORK_LIMITS } from '../app/veyrnox/_lib/editorTimelineArtwork.mjs';
import { emptySequence, addSequenceMedia, addSequenceClip, splitSequenceClip, trimSequence, reverseSequenceClip } from '../app/veyrnox/_lib/editorSequence.mjs';

const media = { id: 'source', kind: 'video', name: 'Source', frames: 120, width: 640, height: 360, hasAudio: true };
const peaks = Array.from({ length: 120 }, (_, i) => i === 20 ? 0.5 : i === 80 ? 1 : 0);
test('trimmed waveform excludes omitted impulses; rate and reversal move the retained impulse', () => {
    assert.equal(timelineWaveform(peaks, media, { in: 60, len: 30 }, 60)[20], 1);
    assert.equal(timelineWaveform(peaks, media, { in: 60, len: 30 }, 60).filter(Boolean).length, 1);
    const beginning = timelineWaveform(peaks, media, { in: 0, len: 30 }, 60);
    assert.equal(beginning[20], 0.5); assert.equal(beginning.includes(1), false);
    const fast = timelineWaveform(peaks, media, { in: 60, len: 15, rate: 2 }, 30);
    assert.equal(fast[10], 1); assert.equal(fast.filter(Boolean).length, 1);
    const backwards = timelineWaveform(peaks, media, { in: 89, len: 30, reverse: true }, 60);
    assert.equal(backwards[9], 1); assert.equal(backwards.filter(Boolean).length, 1);
});
test('actual trim/reverse commands update filmstrip source positions without modifying originals', () => {
    let tl = addSequenceClip(addSequenceMedia(emptySequence(), media), 'video', media.id, { len: 120 });
    const before = JSON.stringify(tl.media);
    tl = trimSequence(tl, 'video', 'v1', 'in', 60);
    assert.deepEqual(timelineThumbnailFrames(media, tl.video[0], 160), [75, 105]);
    tl = reverseSequenceClip(tl, 'video', 'v1');
    assert.deepEqual(timelineThumbnailFrames(media, tl.video[0], 160), [104, 74]);
    assert.equal(JSON.stringify(tl.media), before);
});
test('split ramp artwork retains the continuous nonlinear source path on both sides of the cut', () => {
    const source = { ...media, frames: 600 };
    let tl = addSequenceClip(addSequenceMedia(emptySequence(), source), 'video', source.id, { in: 60, len: 120, speedCurve: [{ frame: 0, rate: 1 }, { frame: 120, rate: 3 }] });
    const original = timelineThumbnailFrames(source, tl.video[0], 320);
    assert.deepEqual(original, [76.875, 121.875, 181.875, 256.875]);
    tl = splitSequenceClip(tl, 'video', 'v1', 60);
    assert.deepEqual([...timelineThumbnailFrames(source, tl.video[0], 160), ...timelineThumbnailFrames(source, tl.video[1], 160)], original);
});
test('freeze holds one picture and suppresses waveform; static media and large zoom stay bounded', () => {
    assert.deepEqual(timelineThumbnailFrames(media, { in: 0, len: 90, freezeFrame: 77 }, 320), [77, 77, 77, 77]);
    assert.deepEqual(timelineWaveform(peaks, media, { in: 0, len: 90, freezeFrame: 77 }, 320), []);
    assert.deepEqual(timelineThumbnailFrames({ ...media, kind: 'image', frames: 1 }, { in: 0, len: 18000 }, 320), [0, 0, 0, 0]);
    assert.equal(timelineThumbnailFrames(media, { in: 0, len: 120 }, 1e9).length, TIMELINE_ARTWORK_LIMITS.thumbnails);
    assert.equal(timelineWaveform(peaks, media, { in: 0, len: 120 }, 1e9).length, TIMELINE_ARTWORK_LIMITS.waveformBins);
    assert.equal(mediaWaveform(peaks, media).length, 120);
});
test('analysis queue bounds active jobs and never starts abandoned queued work', async () => {
    const queue = createArtworkQueue(2), finish = [];
    const tick = () => new Promise(resolve => setImmediate(resolve));
    let active = 0, maximum = 0, abandoned = false;
    const work = () => new Promise(resolve => { active++; maximum = Math.max(maximum, active); finish.push(() => { active--; resolve(); }); });
    const one = queue(work), two = queue(work), three = queue(work);
    const cancelled = queue(() => { abandoned = true; }, () => false);
    const refusal = assert.rejects(cancelled, { name: 'AbortError' });
    await tick(); assert.equal(finish.length, 2);
    finish.shift()(); await one; await tick();
    finish.shift()(); await two; await tick();
    finish.shift()(); await three; await refusal;
    assert.equal(maximum, 2); assert.equal(active, 0); assert.equal(abandoned, false);
});
