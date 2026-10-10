import test from 'node:test';
import assert from 'node:assert/strict';
import {
    FPS, LIMITS, MAX_FRAMES, emptyTimeline, addMedia, addVideoClip, addAudioClip, splitClip, trimClip, removeClip, setVolume,
    moveVideoClip, moveAudioClip, pruneMedia, validateTimeline, videoLayout, videoFrames, totalFrames, videoClipAt, formatTime,
    secondsToFrames, framesToSeconds,
} from '../app/veyrnox/_lib/editorTimeline.mjs';

const vid = (id, seconds, extra = {}) => ({ id, kind: 'video', frames: seconds * FPS, name: `${id}.mp4`, hasAudio: true, width: 1280, height: 720, ...extra });
const aud = (id, seconds) => ({ id, kind: 'audio', frames: seconds * FPS, name: `${id}.mp3`, hasAudio: true, width: 0, height: 0 });
const ok = result => { assert.equal(result.error, undefined, result.error); return result; };

function withTwoClips() {
    let tl = emptyTimeline();
    tl = ok(addMedia(tl, vid('a', 4)));
    tl = ok(addMedia(tl, vid('b', 6)));
    tl = ok(addVideoClip(tl, 'a'));
    tl = ok(addVideoClip(tl, 'b'));
    return tl;
}

test('video clips play back to back, so a clip starts where the one before it ends', () => {
    const tl = withTwoClips();
    assert.deepEqual(videoLayout(tl).map(i => [i.start, i.end]), [[0, 120], [120, 300]]);
    assert.equal(videoFrames(tl), 300);
    assert.equal(videoClipAt(tl, 119).clip.mediaId, 'a');
    assert.equal(videoClipAt(tl, 120).clip.mediaId, 'b');
    assert.equal(videoClipAt(tl, 300), null);
});

test('operations return new documents and never change the one they were given', () => {
    const before = withTwoClips();
    const snapshot = JSON.stringify(before);
    splitClip(before, 'video', 'v1', 30); trimClip(before, 'video', 'v1', { len: 10 }); removeClip(before, 'video', 'v1'); setVolume(before, 'video', 'v1', 0.5);
    assert.equal(JSON.stringify(before), snapshot);
});

test('a clip cannot be added for a missing file or a range outside the file', () => {
    let tl = ok(addMedia(emptyTimeline(), vid('a', 4)));
    assert.match(addVideoClip(tl, 'nope').error, /Add a video file/);
    assert.match(addVideoClip(tl, 'a', { in: 100, len: 50 }).error, /outside/);
    assert.match(addVideoClip(tl, 'a', { in: -1, len: 10 }).error, /outside/);
    assert.match(addVideoClip(tl, 'a', { in: 0, len: 0 }).error, /outside/);
    assert.match(addVideoClip(tl, 'a', { in: 0.5, len: 10 }).error, /outside/);
});

test('splitting inside a clip makes two clips that together play the same frames', () => {
    const tl = ok(splitClip(withTwoClips(), 'video', 'v1', 50));
    assert.equal(tl.video.length, 3);
    const [first, second, third] = tl.video;
    assert.deepEqual([first.in, first.len], [0, 50]);
    assert.deepEqual([second.in, second.len], [50, 70]);
    assert.equal(third.mediaId, 'b');
    assert.equal(videoFrames(tl), 300);
    assert.notEqual(first.id, second.id);
});

test('a split at the start or end of a clip is refused, so neither half is ever empty', () => {
    const tl = withTwoClips();
    assert.match(splitClip(tl, 'video', 'v1', 0).error, /inside/);
    assert.match(splitClip(tl, 'video', 'v1', 120).error, /inside/);
    ok(splitClip(tl, 'video', 'v1', 119)); // one frame before the end still leaves a one-frame second half
    assert.match(splitClip(tl, 'video', 'missing', 10).error, /Select a clip/);
});

test('splitting the second video clip uses the timeline frame, not the clip frame', () => {
    const tl = ok(splitClip(withTwoClips(), 'video', 'v2', 150));
    assert.deepEqual(tl.video.map(c => c.len), [120, 30, 150]);
    assert.equal(tl.video[2].in, 30);
});

test('trimming keeps the clip inside its file and closes the gap in the video sequence', () => {
    let tl = withTwoClips();
    tl = ok(trimClip(tl, 'video', 'v1', { in: 30, len: 60 }));
    assert.deepEqual(videoLayout(tl).map(i => [i.start, i.end]), [[0, 60], [60, 240]]);
    assert.match(trimClip(tl, 'video', 'v1', { in: 100, len: 60 }).error, /outside/);
    assert.match(trimClip(tl, 'video', 'v1', { len: 0 }).error, /outside/);
});

test('removing a clip closes the gap; removing the last clip of a file lets pruneMedia free its slot', () => {
    let tl = ok(removeClip(withTwoClips(), 'video', 'v1'));
    assert.deepEqual(videoLayout(tl).map(i => i.start), [0]);
    tl = pruneMedia(tl);
    assert.deepEqual(Object.keys(tl.media), ['b']);
});

test('volume must be between 0 and 1', () => {
    const tl = withTwoClips();
    assert.equal(ok(setVolume(tl, 'video', 'v1', 0.25)).video[0].volume, 0.25);
    for (const bad of [-0.1, 1.1, NaN, Infinity, '1']) assert.match(setVolume(tl, 'video', 'v1', bad).error, /Volume/);
});

test('reordering the video sequence moves a clip to the requested position', () => {
    const tl = ok(moveVideoClip(withTwoClips(), 'v2', 0));
    assert.deepEqual(tl.video.map(c => c.id), ['v2', 'v1']);
    assert.match(moveVideoClip(tl, 'v1', 5).error, /Select a clip/);
});

test('audio clips sit at a start frame and an overlapping one is moved after the one in the way', () => {
    let tl = ok(addMedia(withTwoClips(), aud('m', 8)));
    tl = ok(addAudioClip(tl, 'm', { start: 0, len: 90 }));
    tl = ok(addAudioClip(tl, 'm', { start: 30, in: 90, len: 60 }));
    assert.deepEqual(tl.audio.map(c => c.start), [0, 90]);
    assert.equal(totalFrames(tl), 300);
});

test('a video file with sound can be used as an audio clip, a silent one cannot', () => {
    let tl = ok(addMedia(emptyTimeline(), vid('talk', 4)));
    ok(addAudioClip(tl, 'talk'));
    tl = ok(addMedia(tl, vid('mute', 4, { hasAudio: false })));
    assert.match(addAudioClip(tl, 'mute').error, /no audio/);
});

test('moving or trimming audio so it overlaps another is refused', () => {
    let tl = ok(addMedia(emptyTimeline(), aud('m', 10)));
    tl = ok(addAudioClip(tl, 'm', { start: 0, len: 60 }));
    tl = ok(addAudioClip(tl, 'm', { start: 90, len: 60 }));
    assert.match(moveAudioClip(tl, 'a2', 30).error, /overlap/);
    assert.equal(ok(moveAudioClip(tl, 'a2', 60)).audio[1].start, 60);
    assert.match(trimClip(tl, 'audio', 'a1', { len: 120 }).error, /overlap/);
});

test('the project is capped at 60 seconds, 10 video clips and 10 audio clips', () => {
    let tl = ok(addMedia(emptyTimeline(), vid('long', 59)));
    tl = ok(addVideoClip(tl, 'long'));
    tl = ok(addMedia(tl, vid('two', 5)));
    assert.match(addVideoClip(tl, 'two').error, /60 seconds/);
    let many = ok(addMedia(emptyTimeline(), vid('s', 1)));
    for (let i = 0; i < LIMITS.maxVideoClips; i++) many = ok(addVideoClip(many, 's'));
    assert.match(addVideoClip(many, 's').error, /10 video clips/);
    assert.match(splitClip(many, 'video', 'v1', 10).error, /10 video clips/);
    assert.equal(MAX_FRAMES, 1800);
});

test('a project holds at most 24 files', () => {
    let tl = emptyTimeline();
    for (let i = 0; i < LIMITS.maxMedia; i++) tl = ok(addMedia(tl, vid(`m${i}`, 1)));
    assert.match(addMedia(tl, vid('extra', 1)).error, /24 files/);
});

test('media entries are cleaned: bad ids and kinds are refused and long names are cut', () => {
    const tl = emptyTimeline();
    assert.match(addMedia(tl, vid('has space', 1)).error, /Bad media id/);
    assert.match(addMedia(tl, vid('../etc', 1)).error, /Bad media id/);
    assert.match(addMedia(tl, { ...vid('x', 1), kind: 'image' }).error, /video or audio/);
    assert.match(addMedia(tl, { ...vid('x', 1), frames: 0 }).error, /usable length/);
    assert.equal(addMedia(tl, { ...vid('x', 1), name: 'n'.repeat(500) }).media.x.name.length, LIMITS.maxNameLength);
});

test('a sound timeline validates, and each kind of damage is refused with a reason, never repaired', () => {
    let tl = ok(addMedia(withTwoClips(), aud('m', 8)));
    tl = ok(addAudioClip(tl, 'm', { start: 0, len: 90 }));
    assert.equal(validateTimeline(tl), null);
    assert.equal(validateTimeline(JSON.parse(JSON.stringify(tl))), null);
    const bad = (mutate, pattern) => { const copy = JSON.parse(JSON.stringify(tl)); mutate(copy); assert.match(validateTimeline(copy), pattern); };
    bad(c => { c.schemaVersion = 2; }, /version/);
    bad(c => { c.fps = 24; }, /frames a second/);
    bad(c => { c.video[0].mediaId = 'ghost'; }, /missing file/);
    bad(c => { c.video[0].in = 9999; }, /outside its file/);
    bad(c => { c.video[0].len = 1.5; }, /outside its file/);
    bad(c => { c.video[0].volume = 3; }, /volume/i);
    bad(c => { c.video[0].id = c.video[1].id; }, /clip id/);
    bad(c => { c.video[0].id = '<script>'; }, /clip id/);
    bad(c => { c.media.a.hasAudio = false; c.audio[0].mediaId = 'a'; }, /no audio/);
    bad(c => { c.audio.push({ ...c.audio[0], id: 'a9', start: 10 }); }, /overlap/);
    bad(c => { c.media.a.name = 'x'.repeat(500); }, /media name/);
    bad(c => { c.media.a.kind = 'image'; }, /media kind/);
    bad(c => { c.media.a.frames = -1; }, /media length/);
    bad(c => { c.video = 'nope'; }, /tracks/);
    bad(c => { c.video[0].len = 2000; c.media.a.frames = 5000; }, /60 seconds/);
    for (const junk of [null, 5, 'x', [], {}]) assert.ok(validateTimeline(junk));
});

test('a timeline document that is far too big is refused before any clip is read', () => {
    const tl = emptyTimeline();
    tl.video = Array.from({ length: 50 }, (_, i) => ({ id: `v${i + 1}`, mediaId: 'a', in: 0, len: 1, volume: 1 }));
    assert.match(validateTimeline(tl), /Too many video clips/);
});

test('time helpers round to whole frames and format as minutes and seconds', () => {
    assert.equal(secondsToFrames(1.5), 45);
    assert.equal(framesToSeconds(45), 1.5);
    assert.equal(formatTime(0), '0:00.0');
    assert.equal(formatTime(222), '0:07.4');
    assert.equal(formatTime(1800), '1:00.0');
    assert.equal(formatTime(-5), '0:00.0');
});
