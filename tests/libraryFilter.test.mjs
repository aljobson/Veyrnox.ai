import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { kindOfRow, filterRows, readView, VIEW_KEY } from '../app/veyrnox/_lib/libraryFilter.js';

const MODELS = [{ id: 'seedream-4', kind: 'image' }, { id: 'wan-2.5-kie', kind: 'video' }, { id: 'ace-step', kind: 'audio' }];
const ROWS = [
    { job_id: 'a', state: 'succeeded', model_id: 'seedream-4', mime_type: 'image/png' },
    { job_id: 'b', state: 'queued', model_id: 'wan-2.5-kie' },
    { job_id: 'c', state: 'failed', model_id: 'ace-step' },
    { job_id: 'd', state: 'succeeded', model_id: 'gone-model' },
];

test('a row is typed by its file, else by the model that ran it', () => {
    assert.equal(kindOfRow(ROWS[0], MODELS), 'image');
    assert.equal(kindOfRow(ROWS[1], MODELS), 'video', 'queued: no file yet, the model says video');
    assert.equal(kindOfRow({ model_id: 'seedream-4', mime_type: 'video/mp4' }, MODELS), 'video', 'the file wins');
    assert.equal(kindOfRow(ROWS[3], MODELS), null);
    assert.equal(kindOfRow(ROWS[1], undefined), null);
});

test('state and type filters combine; an unknown type only shows under All types', () => {
    const ids = (f) => filterRows(ROWS, f, MODELS).map((r) => r.job_id).join('');
    assert.equal(ids({}), 'abcd');
    assert.equal(ids({ kind: 'video' }), 'b');
    assert.equal(ids({ state: 'succeeded' }), 'ad');
    assert.equal(ids({ state: 'succeeded', kind: 'image' }), 'a');
    assert.equal(ids({ state: 'failed', kind: 'image' }), '');
});

test('the saved layout is read safely', () => {
    const store = (v) => ({ getItem: (k) => (k === VIEW_KEY ? v : null) });
    assert.equal(readView(store('list')), 'list');
    assert.equal(readView(store('weird')), 'grid');
    assert.equal(readView(store(null)), 'grid');
    assert.equal(readView({ getItem() { throw new Error('blocked'); } }), 'grid');
});

test('the Library page filters through the helper and offers both controls', () => {
    const page = readFileSync(new URL('../app/veyrnox/app/library/page.js', import.meta.url), 'utf8');
    assert.match(page, /filterRows\(shown, \{ state: tab, kind \}, models\)/);
    assert.match(page, /aria-label="Filter by type"/);
    assert.match(page, /aria-label="Layout"/);
});
