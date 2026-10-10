import test from 'node:test';
import assert from 'node:assert/strict';
import { timelineFromDocument, documentForTimeline, mediaToRelink, matchLocalFile, jobIdFromMediaId, saveProblem } from '../app/veyrnox/_lib/editorProject.mjs';
import { FPS, emptyTimeline, addMedia, addVideoClip } from '../app/veyrnox/_lib/editorTimeline.mjs';
import { emptyProjectDocument, validProjectDocument } from '../lib/projectDocument.js';

const id = '11111111-1111-4111-8111-111111111111';
const vid = (mid, name, seconds) => ({ id: mid, kind: 'video', frames: seconds * FPS, name, hasAudio: true, width: 1280, height: 720 });
function tl() {
    let t = emptyTimeline();
    t = addMedia(t, vid('j-0b4c7d9e-1111-4222-8333-444455556666', 'A friendly woman', 4));
    t = addMedia(t, vid('l-1', 'holiday.mp4', 6));
    t = addVideoClip(t, 'l-1');
    return t;
}

test('a v1 document opens as an empty timeline; a v2 opens its timeline; damage is refused, never repaired', () => {
    const v1 = emptyProjectDocument(id);
    assert.deepEqual(timelineFromDocument(v1), { timeline: emptyTimeline(), problem: null });
    const saved = JSON.parse(JSON.stringify(documentForTimeline(v1, tl())));
    assert.equal(validProjectDocument(saved, id), true);
    assert.deepEqual(timelineFromDocument(saved).timeline, JSON.parse(JSON.stringify(tl())));
    saved.timeline.video[0].len = 99999;
    const opened = timelineFromDocument(saved);
    assert.deepEqual(opened.timeline, emptyTimeline());
    assert.match(opened.problem, /outside its file/);
    assert.deepEqual(timelineFromDocument(documentForTimeline(v1, null)).timeline, emptyTimeline());
});

test('reopening lists Library files to fetch and local files to ask for, skipping what is already loaded', () => {
    const t = tl();
    const all = mediaToRelink(t);
    assert.deepEqual(all.library, [{ id: 'j-0b4c7d9e-1111-4222-8333-444455556666', jobId: '0b4c7d9e-1111-4222-8333-444455556666', name: 'A friendly woman' }]);
    assert.deepEqual(all.local, [{ id: 'l-1', name: 'holiday.mp4', frames: 180, kind: 'video' }]);
    const rest = mediaToRelink(t, new Set(['l-1']));
    assert.equal(rest.local.length, 0);
    assert.equal(rest.library.length, 1);
    assert.equal(jobIdFromMediaId('l-1'), null);
});

test('a chosen file stands in for a missing local entry only when name, kind and length match to the frame', () => {
    const t = tl();
    const probe = { kind: 'video', seconds: 6.01, hasAudio: true, width: 1280, height: 720 };
    assert.equal(matchLocalFile(t, { name: 'holiday.mp4' }, probe)?.id, 'l-1');
    assert.equal(matchLocalFile(t, { name: 'other.mp4' }, probe), null);
    assert.equal(matchLocalFile(t, { name: 'holiday.mp4' }, { ...probe, seconds: 5.5 }), null);
    assert.equal(matchLocalFile(t, { name: 'holiday.mp4' }, { ...probe, kind: 'audio' }), null);
    assert.equal(matchLocalFile(t, { name: 'holiday.mp4' }, probe, new Set(['l-1'])), null, 'already loaded');
    assert.equal(matchLocalFile(t, { name: 'holiday.mp4' }, { error: 'bad' }), null);
});

test('save problems are plain words with no server detail', () => {
    assert.match(saveProblem({ status: 409 }), /newer version/);
    assert.match(saveProblem({ status: 404 }), /no longer/);
    assert.match(saveProblem({ status: 429 }), /Too many/);
    assert.match(saveProblem({ status: 400 }), /could not be saved/);
    assert.match(saveProblem({ status: 500, message: 'relation x does not exist' }), /connection/);
    assert.doesNotMatch(saveProblem({ status: 500, message: 'relation x does not exist' }), /relation/);
});
