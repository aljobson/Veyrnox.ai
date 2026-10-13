import test from 'node:test';
import assert from 'node:assert/strict';
import { emptySequence, addSequenceText } from '../app/veyrnox/_lib/editorSequence.mjs';
import { editorDraftScope, editorHasWork, readEditorDraft, removeEditorDraft, writeEditorDraft } from '../app/veyrnox/_lib/editorDraft.mjs';

class Storage {
    values = new Map();
    getItem(key) { return this.values.get(key) ?? null; }
    setItem(key, value) { this.values.set(key, value); }
    removeItem(key) { this.values.delete(key); }
}

test('drafts are account and project scoped validated timelines', () => {
    const storage = new Storage(), timeline = addSequenceText(emptySequence(), { text: 'Recovered title' });
    writeEditorDraft(storage, 'guest', 'local', timeline, 42);
    assert.deepEqual(readEditorDraft(storage, 'guest', 'local'), { timeline, updatedAt: 42 });
    assert.equal(readEditorDraft(storage, 'another-user', 'local'), null);
    removeEditorDraft(storage, 'guest', 'local');
    assert.equal(readEditorDraft(storage, 'guest', 'local'), null);
});

test('invalid draft payloads are discarded instead of entering the editor', () => {
    const storage = new Storage();
    storage.setItem('veyrnox-editor-draft-v1:guest:local', JSON.stringify({ version: 1, updatedAt: 1, timeline: { schemaVersion: 3 } }));
    assert.equal(readEditorDraft(storage, 'guest', 'local'), null);
    assert.equal(storage.values.size, 0);
});

test('draft scope follows a valid project query and otherwise stays local', () => {
    assert.equal(editorDraftScope('https://veyrnox.ai/app/editor?project=ABC_123'), 'project-abc_123');
    assert.equal(editorDraftScope('https://veyrnox.ai/app/editor?project=%20'), 'local');
    assert.equal(editorDraftScope('not a url'), 'local');
});

test('blank timelines do not become misleading recovery prompts',()=>{
    const storage=new Storage();writeEditorDraft(storage,'guest','local',emptySequence(),1);
    assert.equal(editorHasWork(emptySequence()),false);assert.equal(readEditorDraft(storage,'guest','local'),null);assert.equal(storage.values.size,0);
});
