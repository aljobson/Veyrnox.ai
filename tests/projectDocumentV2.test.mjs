import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyProjectDocument, withTimeline, equalProjectDocuments, validProjectDocument } from '../lib/projectDocument.js';
import { FPS, emptyTimeline, addMedia, addVideoClip, addText } from '../app/veyrnox/_lib/editorTimeline.mjs';

const id = '11111111-1111-4111-8111-111111111111';
const vid = (mid, seconds) => ({ id: mid, kind: 'video', frames: seconds * FPS, name: `${mid}.mp4`, hasAudio: true, width: 1280, height: 720 });
function timeline() {
    let tl = emptyTimeline();
    tl = addMedia(tl, vid('j-abc', 4)); tl = addVideoClip(tl, 'j-abc'); tl = addText(tl, { text: 'Hi' });
    return JSON.parse(JSON.stringify(tl));
}

test('v2 carries a validated timeline or null, with exactly five keys', () => {
    const v1 = emptyProjectDocument(id);
    assert.equal(validProjectDocument(v1, id), true);
    const v2 = withTimeline(v1, timeline());
    assert.equal(v2.schema_version, 2);
    assert.equal(validProjectDocument(v2, id), true);
    assert.equal(validProjectDocument(withTimeline(v1, null), id), true);
    assert.equal(validProjectDocument({ ...v1, schema_version: 2 }, id), false, 'v2 without the timeline key');
    assert.equal(validProjectDocument({ ...v1, timeline: null }, id), false, 'v1 with a timeline key');
    assert.equal(validProjectDocument(withTimeline({ ...v1, project_id: '22222222-2222-4222-8222-222222222222' }, null), id), false);
    assert.equal(validProjectDocument(withTimeline(v1, { ...timeline(), schemaVersion: 1 }), id), false, 'an old timeline version');
    assert.equal(validProjectDocument(withTimeline(v1, { ...timeline(), video: 'nope' }), id), false, 'damage is refused, never repaired');
    assert.equal(validProjectDocument({ ...v2, extra: 1 }, id), false);
});

test('v2 equality ignores key order inside the timeline and sees edits', () => {
    const tl = timeline();
    const a = withTimeline(emptyProjectDocument(id), tl);
    const reordered = JSON.parse(JSON.stringify(a));
    reordered.timeline = Object.fromEntries(Object.entries(tl).reverse());
    reordered.timeline.media = { 'j-abc': Object.fromEntries(Object.entries(tl.media['j-abc']).reverse()) };
    assert.equal(equalProjectDocuments(a, reordered), true);
    assert.equal(equalProjectDocuments(a, withTimeline(emptyProjectDocument(id), null)), false);
    const edited = JSON.parse(JSON.stringify(a)); edited.timeline.text[0].text = 'Bye';
    assert.equal(equalProjectDocuments(a, edited), false);
    assert.equal(equalProjectDocuments(emptyProjectDocument(id), withTimeline(emptyProjectDocument(id), null)), false, 'v1 and v2 differ');
});

test('a full timeline stays well inside the 32 KiB document ceiling', () => {
    let tl = emptyTimeline();
    for (let i = 0; i < 24; i++) tl = addMedia(tl, vid(`j-${'x'.repeat(50)}${i}`, 60));
    for (let i = 0; i < 10; i++) tl = addVideoClip(tl, `j-${'x'.repeat(50)}${i}`, { in: 0, len: 6 * FPS });
    for (let i = 0; i < 10; i++) tl = addText(tl, { text: 'y'.repeat(120), start: 0, len: 30 });
    const doc = withTimeline({ ...emptyProjectDocument(id), brief: 'b'.repeat(6000) }, JSON.parse(JSON.stringify(tl)));
    assert.equal(validProjectDocument(doc, id), true);
    assert.ok(new TextEncoder().encode(JSON.stringify(doc)).byteLength < 24000);
});
