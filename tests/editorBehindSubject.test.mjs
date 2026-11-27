import assert from 'node:assert/strict';
import test from 'node:test';
import { behindSubjectCandidates, setBehindSubject } from '../app/veyrnox/_lib/editorBehindSubject.mjs';
import { addSequenceClip, addSequenceMedia, addSequenceText, addSequenceTrack, emptySequence, updateSequenceClip } from '../app/veyrnox/_lib/editorSequence.mjs';
import { sequenceLayers, subjectCompositeOrder } from '../app/veyrnox/_lib/editorSequenceRender.mjs';
import { validateSequence } from '../app/veyrnox/_lib/editorSequenceValidation.mjs';

function media(id, kind, frames = 300) {
    return { id, kind, frames, name: id, hasAudio: kind === 'video', width: 1080, height: 1920,
        ...(kind === 'graphic' ? { graphic: { shape: 'rectangle', color: '#ffffff' } } : {}) };
}

function fixture() {
    let timeline = emptySequence();
    timeline = addSequenceMedia(timeline, media('subject', 'video'));
    timeline = addSequenceMedia(timeline, media('subject-mask', 'image'));
    timeline = addSequenceMedia(timeline, media('overlay', 'image'));
    timeline = addSequenceClip(timeline, 'video', 'subject', { start: 0, len: 180, trackId: 'video-0' });
    const subjectId = timeline.video.at(-1).id;
    timeline = updateSequenceClip(timeline, 'video', subjectId, { semanticMask: { version: 1, mediaId: 'subject-mask', category: 'person', sourceFrame: 0 } });
    timeline = addSequenceTrack(timeline, 'video');
    const overlayTrack = timeline.tracks.filter(track => track.kind === 'video').at(-1).id;
    timeline = addSequenceClip(timeline, 'video', 'overlay', { start: 30, len: 90, trackId: overlayTrack });
    const overlayId = timeline.video.at(-1).id;
    timeline = addSequenceText(timeline, { text: 'Behind', start: 30, len: 90, x: .5, y: .5, size: 8 });
    const textId = timeline.text.at(-1).id;
    return { timeline, subjectId, overlayId, textId };
}

test('only overlapping titles and still image overlays can target a whole-person mask', () => {
    const { timeline, subjectId, overlayId, textId } = fixture();
    assert.deepEqual(behindSubjectCandidates(timeline, timeline.video.find(item => item.id === overlayId)).map(item => item.id), [subjectId]);
    assert.deepEqual(behindSubjectCandidates(timeline, timeline.text.find(item => item.id === textId)).map(item => item.id), [subjectId]);
    assert.deepEqual(behindSubjectCandidates(timeline, timeline.video.find(item => item.id === subjectId)), []);

    const outside = { ...timeline.text.find(item => item.id === textId), start: 170, len: 20 };
    assert.deepEqual(behindSubjectCandidates(timeline, outside), []);
});

test('behind-subject references validate, remove cleanly, and reject stale or unsafe relations', () => {
    const { timeline, subjectId, overlayId, textId } = fixture();
    const withImage = setBehindSubject(timeline, 'video', overlayId, subjectId);
    const complete = setBehindSubject(withImage, 'text', textId, subjectId);
    assert.equal(validateSequence(complete), null);
    assert.equal(complete.video.find(item => item.id === overlayId).behindSubject, subjectId);
    assert.equal(complete.text.find(item => item.id === textId).behindSubject, subjectId);

    const removed = setBehindSubject(complete, 'text', textId, null);
    assert.equal(Object.hasOwn(removed.text.find(item => item.id === textId), 'behindSubject'), false);
    assert.match(setBehindSubject(timeline, 'text', textId, 'v999').error, /overlapping clip/i);
    assert.match(validateSequence({ ...complete, text: complete.text.map(item => item.id === textId ? { ...item, start: 170 } : item) }), /behind.subject/i);
    assert.match(validateSequence({ ...complete, video: complete.video.map(item => item.id === subjectId
        ? { ...item, semanticMask: { ...item.semanticMask, category: 'background' } } : item) }), /behind.subject/i);
});

test('canonical compositor order is original scene, opted-in overlays, then masked subject', () => {
    const { timeline, subjectId, overlayId, textId } = fixture();
    const complete = setBehindSubject(setBehindSubject(timeline, 'video', overlayId, subjectId), 'text', textId, subjectId);
    const layers = sequenceLayers(complete, 45);
    const order = subjectCompositeOrder(layers).map(layer => layer.kind === 'text'
        ? `text:${layers.texts[layer.index].id}`
        : `visual:${layers.visuals[layer.index].clip.id}:${layer.semantic}`);
    assert.deepEqual(order, [
        `visual:${subjectId}:base`,
        `visual:${overlayId}:normal`,
        `text:${textId}`,
        `visual:${subjectId}:foreground`,
    ]);
});
