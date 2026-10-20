import test from 'node:test';
import assert from 'node:assert/strict';
import { emptySequence, addSequenceMedia, addSequenceClip } from '../app/veyrnox/_lib/editorSequence.mjs';
import { TRANSITIONS } from '../app/veyrnox/_lib/editorEffects.mjs';
import { timelineGuidance, transitionGuidance, transitionJunctions, transitionPreview } from '../app/veyrnox/_lib/editorGuidance.mjs';

const media = { id: 'l-a', kind: 'video', frames: 300, width: 1280, height: 720, hasAudio: true, name: 'A.mp4' };
const withMedia = () => addSequenceMedia(emptySequence(), media);
const oneClip = () => addSequenceClip(withMedia(), 'video', media.id, { len: 90 });
const twoClips = () => addSequenceClip(oneClip(), 'video', media.id, { len: 90 });

test('an empty timeline tells the user to add media first', () => {
    const hint = timelineGuidance(emptySequence());
    assert.equal(hint.id, 'empty');
    assert.match(hint.body, /Upload|Library/);
    assert.equal(hint.action, 'Open media');
});

test('one video clip explains how to add a second one and where clips land', () => {
    const hint = timelineGuidance(oneClip());
    assert.equal(hint.id, 'second');
    assert.match(hint.title, /second/i);
    assert.match(hint.body, /Add to timeline/);
    assert.match(hint.body, /end/i);
    assert.equal(hint.action, 'Open media');
});

test('two or more video clips need no hint', () => {
    assert.equal(timelineGuidance(twoClips()), null);
});

test('transition guidance asks for a selection when nothing is selected', () => {
    const hint = transitionGuidance(twoClips(), null);
    assert.match(hint.title, /Select a clip/);
    assert.equal(hint.action, null);
});

test('transition guidance says transitions sit between two clips when only one exists', () => {
    const tl = oneClip();
    const hint = transitionGuidance(tl, { track: 'video', id: tl.video[0].id });
    assert.match(hint.body, /between two/i);
    assert.equal(hint.action, 'Open media');
});

test('the first of two clips has no clip before it, the second does', () => {
    const tl = twoClips();
    assert.ok(transitionGuidance(tl, { track: 'video', id: tl.video[0].id }));
    assert.equal(transitionGuidance(tl, { track: 'video', id: tl.video[1].id }), null);
});

test('the timeline exposes one transition action at every touching video join', () => {
    const tl = twoClips();
    const [junction] = transitionJunctions(tl, 'video-0');
    assert.equal(transitionJunctions(tl, 'video-0').length, 1);
    assert.equal(junction.frame, tl.video[1].start);
    assert.equal(junction.outgoing.id, tl.video[0].id);
    assert.equal(junction.incoming.id, tl.video[1].id);
    assert.deepEqual(transitionJunctions(tl, 'video-2'), []);
});

test('non-video selections are told transitions are for video clips', () => {
    const tl = twoClips();
    const hint = transitionGuidance(tl, { track: 'text', id: 't1' });
    assert.match(hint.title, /video clip/i);
});

test('every catalogue transition has an animated preview that moves the incoming picture', () => {
    for (const transition of TRANSITIONS) {
        const preview = transitionPreview(transition.id);
        assert.ok(preview.duration >= 600 && preview.duration <= 2000, transition.id);
        const layers = [preview.outgoing, preview.incoming, preview.overlay].filter(Boolean);
        assert.ok(layers.length >= 1, transition.id);
        for (const frames of layers) {
            assert.ok(Array.isArray(frames) && frames.length >= 2, transition.id);
            assert.ok(frames.some(frame => JSON.stringify(frame) !== JSON.stringify(frames[0])), `${transition.id} must change over time`);
        }
    }
});

test('directional previews run in the named direction', () => {
    assert.match(transitionPreview('wipe-left').incoming[0].clipPath, /^inset\(0(px|%)? 0(px|%)? 0(px|%)? 100%\)$/);
    assert.match(transitionPreview('wipe-right').incoming[0].clipPath, /^inset\(0(px|%)? 100% 0(px|%)? 0(px|%)?\)$/);
    assert.match(transitionPreview('slide-left').incoming[0].transform, /translateX\(100%\)/);
    assert.match(transitionPreview('slide-right').incoming[0].transform, /translateX\(-100%\)/);
    assert.match(transitionPreview('slide-up').incoming[0].transform, /translateY\(100%\)/);
    assert.match(transitionPreview('slide-down').incoming[0].transform, /translateY\(-100%\)/);
});

test('flash, dip and blur use an overlay or filter; unknown ids fall back to a dissolve', () => {
    assert.ok(transitionPreview('flash').overlay);
    assert.ok(transitionPreview('dip-black').overlay);
    assert.match(transitionPreview('blur').incoming[0].filter, /blur/);
    assert.deepEqual(transitionPreview('not-a-transition'), transitionPreview('dissolve'));
});
