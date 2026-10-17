import test from 'node:test';
import assert from 'node:assert/strict';
import { libraryTile, libraryBadge } from '../app/veyrnox/_lib/editorLibraryTile.mjs';
import { listLibraryMedia } from '../app/veyrnox/_lib/editorLibrary.mjs';
import { AUDIO_STEMS } from '../lib/audioStems.mjs';

const id = '12345678-1234-4123-8123-123456789012';

test('badges name where a Library item comes from', () => {
    assert.equal(libraryBadge('device'), 'This device');
    assert.equal(libraryBadge('editor'), 'Saved edit');
    assert.equal(libraryBadge('master'), 'Film Studio');
    assert.equal(libraryBadge('generation'), 'Generated');
    assert.equal(libraryBadge(undefined), 'Generated');
});

test('a generated image or video tile previews the picture and keeps the exact button name', () => {
    const image = libraryTile({ kind: 'image', label: 'Synthetic Library image', source: 'generation', previewUrl: 'https://files.example/a.png' });
    assert.equal(image.name, 'image: Synthetic Library image · Generated');
    assert.deepEqual(image.preview, { type: 'image', url: 'https://files.example/a.png' });
    const video = libraryTile({ kind: 'video', label: 'Clip', source: 'generation', previewUrl: 'https://files.example/a.mp4' });
    assert.deepEqual(video.preview, { type: 'video', url: 'https://files.example/a.mp4' });
});

test('sounds and items without a safe link get a symbol tile, not a broken picture', () => {
    assert.equal(libraryTile({ kind: 'audio', label: 'Song', source: 'generation', previewUrl: 'https://files.example/a.mp3' }).preview, null);
    for (const url of ['http://files.example/a.png', 'javascript:alert(1)', 'data:image/png;base64,AAAA', '', null, undefined, 42]) {
        assert.equal(libraryTile({ kind: 'image', label: 'x', source: 'generation', previewUrl: url }).preview, null, String(url));
    }
    assert.equal(libraryTile({ kind: 'video', label: 'Saved', source: 'editor' }).preview, null);
});

test('every tile has a symbol for its kind', () => {
    for (const kind of ['video', 'audio', 'image']) assert.ok(libraryTile({ kind, label: 'x', source: 'device' }).symbol);
});

test('listing a generation also carries the short-lived link it already fetched, never for stems', async () => {
    const fetcher = async path => path.startsWith('/jobs?')
        ? { jobs: [{ job_id: id, has_asset: true, label: 'Picture' }] }
        : { mime_type: 'image/png', url: 'https://files.example/signed.png?sig=1' };
    const [item] = await listLibraryMedia(fetcher, { includeImages: true });
    assert.equal(item.previewUrl, 'https://files.example/signed.png?sig=1');
    const plain = await listLibraryMedia(async path => path.startsWith('/jobs?') ? { jobs: [{ job_id: id, has_asset: true }] } : { mime_type: 'video/mp4', url: 'http://insecure.example/a.mp4' });
    assert.equal(plain[0].previewUrl, undefined);
    const stems = await listLibraryMedia(async path => path.startsWith('/jobs?') ? { jobs: [{ job_id: id, model_id: 'demucs-stems', has_asset: true }] } : { mime_type: 'audio/mpeg', output_stems: AUDIO_STEMS, url: 'https://files.example/s.mp3' });
    for (const stem of stems) assert.equal(stem.previewUrl, undefined);
});
