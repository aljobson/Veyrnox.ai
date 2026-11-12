import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { editorJobHandoffFromUrl, libraryEditorHref } from '../app/veyrnox/_lib/editorMedia.mjs';

const JOB = '0b2c1f4e-5d6a-4e7b-8c9d-0123456789ab';
const done = (extra = {}) => ({ job_id: JOB, state: 'succeeded', asset_url: 'https://r2.test/x', mime_type: 'video/mp4', model_id: 'm', ...extra });

test('a finished video or audio result links to the editor with its job id', () => {
    for (const mime of ['video/mp4', 'video/webm', 'audio/mpeg', 'audio/wav']) {
        const href = libraryEditorHref(done({ mime_type: mime }), 'Kling 2.6');
        assert.ok(href.startsWith('/app/editor?job='), href);
        assert.deepEqual(editorJobHandoffFromUrl(href), { jobId: JOB, name: 'Kling 2.6' }, 'the editor reads back exactly what the link carries');
    }
});

test('only the job id and the model name travel in the address, never the prompt or the title', () => {
    const href = libraryEditorHref(done({ prompt: 'my secret birthday plan', name: 'Private title' }), 'Kling 2.6');
    assert.doesNotMatch(href, /secret|Private|birthday/);
    const params = [...new URL(href, 'https://x.test').searchParams.keys()].sort();
    assert.deepEqual(params, ['job', 'name']);
    assert.equal(libraryEditorHref(done(), ''), `/app/editor?job=${JOB}`, 'no name when there is none');
});

test('anything the editor cannot take gets no link', () => {
    for (const row of [
        done({ state: 'running' }), done({ state: 'failed' }), done({ state: 'unknown' }),
        done({ asset_url: null }), done({ asset_url: '' }),
        done({ mime_type: 'image/png' }), done({ mime_type: null }), done({ mime_type: undefined }),
        done({ job_id: 'not-a-uuid' }), done({ job_id: '' }), done({ job_id: undefined }), null, undefined,
    ]) assert.equal(libraryEditorHref(row, 'x'), null, JSON.stringify(row));
});

test('the model name is trimmed and cleaned like the editor does, and cannot break out of the address', () => {
    const href = libraryEditorHref(done(), `  A&b=c#d  \n${'x'.repeat(200)}`);
    const url = new URL(href, 'https://x.test');
    assert.equal(url.searchParams.get('job'), JOB);
    assert.equal([...url.searchParams.keys()].length, 2);
    assert.ok(url.searchParams.get('name').length <= 80);
    assert.equal(url.hash, '');
});

test('the Library card shows the link only where the editor is switched on', () => {
    const card = readFileSync(new URL('../app/veyrnox/_components/LibraryJobCard.js', import.meta.url), 'utf8');
    assert.match(card, /useEditorEnabled\(\)/);
    assert.match(card, /libraryEditorHref\(row, model\?\.name\)/);
    assert.match(card, /editorEnabled && editHref/);
    assert.match(card, /data-testid="library-open-editor"/);
});
