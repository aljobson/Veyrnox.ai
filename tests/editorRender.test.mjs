import test from 'node:test';
import assert from 'node:assert/strict';
import { FPS, emptyTimeline, addMedia, addVideoClip, setTransition, setAspect, addText, trimClip } from '../app/veyrnox/_lib/editorTimeline.mjs';
import { frameLayers, outputSize, timelineSize } from '../app/veyrnox/_lib/editorRender.mjs';

const vid = (id, seconds, w = 1280, h = 720) => ({ id, kind: 'video', frames: seconds * FPS, name: `${id}.mp4`, hasAudio: true, width: w, height: h });
const ok = r => { assert.equal(r.error, undefined, r.error); return r; };

function twoClips() {
    let tl = emptyTimeline();
    tl = ok(addMedia(tl, vid('a', 4)));
    tl = ok(addMedia(tl, vid('b', 6)));
    tl = ok(addVideoClip(tl, 'a', { in: 0, len: 60 }));   // a plays 0..59, file has 120 frames
    tl = ok(addVideoClip(tl, 'b', { in: 30, len: 90 }));  // b plays 60..149 from source frame 30
    return tl;
}

test('without a dissolve each frame is one clip at its source time', () => {
    const tl = twoClips();
    assert.deepEqual(frameLayers(tl, 0), { base: { k: 0, time: 0 }, over: null, texts: [] });
    assert.deepEqual(frameLayers(tl, 59), { base: { k: 0, time: 59 / FPS }, over: null, texts: [] });
    assert.deepEqual(frameLayers(tl, 60), { base: { k: 1, time: 30 / FPS }, over: null, texts: [] });
    assert.deepEqual(frameLayers(tl, 150), { base: null, over: null, texts: [] });
});

test('a dissolve draws the previous clip underneath, continuing past its out point, with the new clip fading in on top', () => {
    const tl = ok(setTransition(twoClips(), 'v2', 30));
    // first frame of the dissolve: a continues at its frame 60 (it has 120), b starts at its frame 30 almost transparent
    const first = frameLayers(tl, 60);
    assert.deepEqual(first.base, { k: 0, time: 60 / FPS });
    assert.deepEqual(first.over, { k: 1, time: 30 / FPS, alpha: 1 / 30 });
    // middle
    assert.equal(frameLayers(tl, 74).over.alpha, 15 / 30);
    // last frame of the dissolve is fully the new clip, and the frame after it has no overlay at all
    assert.equal(frameLayers(tl, 89).over.alpha, 1);
    assert.deepEqual(frameLayers(tl, 90), { base: { k: 1, time: 60 / FPS }, over: null, texts: [] });
});

test('under a dissolve a clip that has no more frames holds its last one', () => {
    let tl = twoClips();
    tl = ok(trimClip(tl, 'video', 'v1', { in: 100, len: 20 })); // a now ends on its last source frame (119)
    tl = ok(setTransition(tl, 'v2', 20));
    const layers = frameLayers(tl, 20 + 10); // 10 frames into the dissolve
    assert.equal(layers.base.time, 119 / FPS, 'clamped to the file\'s last frame, not past it');
});

test('texts show only on their frames', () => {
    let tl = twoClips();
    tl = ok(addText(tl, { text: 'Hi', start: 10, len: 5 }));
    assert.equal(frameLayers(tl, 9).texts.length, 0);
    assert.equal(frameLayers(tl, 10).texts[0].text, 'Hi');
    assert.equal(frameLayers(tl, 14).texts.length, 1);
    assert.equal(frameLayers(tl, 15).texts.length, 0);
});

test('the output size follows the aspect preset, else the first clip, always even and within 1920 wide', () => {
    assert.deepEqual(outputSize(1920, 1080, 720), { width: 1280, height: 720 });
    assert.deepEqual(outputSize(1920, 1080, 720, '9:16'), { width: 406, height: 720 });
    assert.deepEqual(outputSize(1920, 1080, 1080, '1:1'), { width: 1080, height: 1080 });
    assert.deepEqual(outputSize(1080, 1920, 1080, '16:9'), { width: 1920, height: 1080 });
    assert.deepEqual(outputSize(0, 0, 999), { width: 1280, height: 720 });
    let tl = twoClips();
    assert.deepEqual(timelineSize(tl, 720), { width: 1280, height: 720 });
    tl = ok(setAspect(tl, '9:16'));
    assert.deepEqual(timelineSize(tl, 1080), { width: 608, height: 1080 });
    assert.deepEqual(timelineSize(emptyTimeline(), 720), { width: 1280, height: 720 });
});
