import test from 'node:test';
import assert from 'node:assert/strict';
import { emptySequence, addSequenceTrack, addSequenceText, updateSequenceTrack, removeSequenceTrack } from '../app/veyrnox/_lib/editorSequence.mjs';
import { validateSequence } from '../app/veyrnox/_lib/editorSequenceValidation.mjs';
import { createHistory, commitHistory, undoHistory, redoHistory } from '../app/veyrnox/_lib/editorHistory.mjs';
const ok = tl => { assert.equal(tl.error, undefined); assert.equal(validateSequence(tl), null); return tl; };

test('removal refuses locked, populated, missing and final per-kind tracks without changing the document', () => {
    let tl = ok(addSequenceTrack(emptySequence(), 'text'));
    const id = tl.tracks.at(-1).id;
    const occupied = ok(addSequenceText(tl, { text: 'Keep this title', trackId: id }));
    const snapshot = JSON.stringify(occupied);
    assert.match(removeSequenceTrack(occupied, id).error, /Move or remove/);
    assert.match(removeSequenceTrack(ok(updateSequenceTrack(tl, id, { locked: true })), id).error, /Unlock/);
    assert.match(removeSequenceTrack(tl, 'unknown').error, /existing/);
    for (const kind of ['video', 'audio', 'text']) assert.match(removeSequenceTrack(emptySequence(), `${kind}-0`).error, /at least one/);
    assert.equal(JSON.stringify(occupied), snapshot);
});
test('removing an empty lane recovers capacity with unchanged clips and reversible history', () => {
    let tl = ok(addSequenceText(emptySequence(), { text: 'Preserved title', start: 15, len: 90 }));
    for (let i = 0; i < 13; i++) tl = ok(addSequenceTrack(tl, 'video'));
    assert.equal(tl.tracks.length, 16); assert.match(addSequenceTrack(tl, 'audio').error, /16 tracks/);
    const id = tl.tracks.at(-1).id, next = ok(removeSequenceTrack(tl, id));
    assert.equal(next.tracks.length, 15); assert.equal(next.seq, tl.seq); assert.deepEqual(next.text, tl.text);
    assert.equal(ok(addSequenceTrack(next, 'audio')).tracks.length, 16);
    const history = commitHistory(createHistory(tl), next);
    assert.deepEqual(undoHistory(history).now, tl);
    assert.deepEqual(redoHistory(undoHistory(history)).now, next);
});
