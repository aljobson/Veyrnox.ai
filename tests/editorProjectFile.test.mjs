import test from 'node:test';
import assert from 'node:assert/strict';
import { exportProjectFile, parseProjectFile, readProjectFile, projectFileName, PROJECT_FILE_LIMIT } from '../app/veyrnox/_lib/editorProjectFile.mjs';
import { emptyProjectDocument } from '../lib/projectDocument.js';
import { documentForTimeline } from '../app/veyrnox/_lib/editorProject.mjs';
import { emptySequence, addSequenceMedia, addSequenceClip, addSequenceTrack, addSequenceText, updateSequenceClip, updateSequenceTrack } from '../app/veyrnox/_lib/editorSequence.mjs';
import { validateSequence, TEXT_DEFAULTS } from '../app/veyrnox/_lib/editorSequenceValidation.mjs';
import { emptyTimeline, addMedia, addVideoClip } from '../app/veyrnox/_lib/editorTimeline.mjs';
import { customFontFamily } from '../app/veyrnox/_lib/editorOrganization.mjs';
import { missingCustomFont } from '../app/veyrnox/_lib/editorCustomFonts.mjs';
import { createHistory, commitHistory, undoHistory, redoHistory } from '../app/veyrnox/_lib/editorHistory.mjs';

const projectId = '11111111-1111-4111-8111-111111111111', assetId = '22222222-2222-4222-8222-222222222222';
const ok = tl => { assert.equal(tl.error, undefined); assert.equal(validateSequence(tl), null); return tl; };
const original = { id: 'local-original', kind: 'video', name: 'Renamed scene', sourceName: 'original-scene.mp4', frames: 240, width: 640, height: 360, hasAudio: true, folder: 'Campaign/Scenes', attribution: { credit: 'Original creator', usage: 'Original owner footage', url: '' } };
function fixture() {
    const sha256 = 'a'.repeat(64), font = { family: customFontFamily(sha256), name: 'Original title font', sourceName: 'title.ttf', sha256, bytes: 12, format: 'ttf', rights: { credit: 'Font creator', usage: 'Owner supplied permission', url: '' } };
    let tl = ok(addSequenceMedia(emptySequence(), original));
    tl = ok(addSequenceClip(tl, 'video', original.id, { start: 30, in: 120, len: 60, reverse: true, rate: 1 }));
    tl = ok(addSequenceTrack(tl, 'video'));
    tl = ok(addSequenceMedia(tl, { ...original, id: 'project-source', name: 'Saved original', assetSource: { projectId, assetId } }));
    tl = ok(addSequenceClip(tl, 'video', 'project-source', { start: 45, len: 30, trackId: tl.tracks.at(-1).id }));
    tl = ok(updateSequenceTrack(tl, tl.tracks.at(-1).id, { hidden: true, locked: true }));
    tl = ok(addSequenceClip(tl, 'audio', original.id, { start: 20, in: 15, len: 90, volume: .4, fadeIn: 15, fadeOut: 15 }));
    tl = ok({ ...tl, folders: ['Campaign/Empty', 'Campaign/Scenes'], fonts: [font] });
    return ok(addSequenceText(tl, { text: 'Original caption', start: 30, len: 60, caption: true, style: { ...TEXT_DEFAULTS, font: font.family }, words: [{ text: 'Original', start: 0, len: 20 }, { text: 'caption', start: 20, len: 30 }], wordsEstimated: false }));
}
test('a project file round-trips the complete edit and source/font metadata, without embedding media bytes', () => {
    const tl = fixture(), before = JSON.stringify(tl), base = { ...emptyProjectDocument(projectId), brief: 'Preserve the owner brief', canvas: { aspect_ratio: '9:16', frame_rate: 25 } };
    const saved = exportProjectFile(tl, { projectDocument: base, name: 'Launch film' }), opened = parseProjectFile(saved.json);
    assert.equal(saved.name, 'Launch-film.veyrnox.json'); assert.equal(saved.bytes, new TextEncoder().encode(saved.json).byteLength); assert.ok(saved.bytes < PROJECT_FILE_LIMIT);
    assert.equal(saved.document.schema_version, 3); assert.equal(opened.document.project_id, projectId); assert.equal(opened.document.brief, base.brief); assert.deepEqual(opened.document.canvas, base.canvas);
    assert.deepEqual(opened.timeline, tl); assert.notEqual(opened.timeline, tl); assert.equal(JSON.stringify(tl), before);
    assert.deepEqual(opened.relink.local, [{ id: original.id, name: original.name, frames: 240, kind: 'video' }]); assert.equal(opened.relink.assets[0].assetId, assetId);
    assert.deepEqual(opened.fonts, tl.fonts); assert.match(missingCustomFont(opened.timeline, { has: () => false }), /Relink.*Original title font/);
    assert.doesNotMatch(saved.json, /data:|blob:|base64/);
    assert.throws(() => exportProjectFile({ ...tl, media: { ...tl.media, [original.id]: { ...original, file: new Blob(['original bytes']) } } }), /could not be downloaded/);
});
test('v1 and v2 files upgrade once to independent tracks while preserving ordered clip timing and document metadata', () => {
    const base = { ...emptyProjectDocument(projectId), brief: 'Foundation project' };
    const empty = parseProjectFile(JSON.stringify(base)); assert.equal(empty.sourceVersion, 1); assert.equal(empty.timeline.schemaVersion, 3); assert.deepEqual(empty.timeline.video, []); assert.equal(empty.document.brief, base.brief);
    let legacy = addMedia(emptyTimeline(), { id: 'local-original', kind: 'video', name: 'Original.mp4', frames: 240, width: 640, height: 360, hasAudio: true });
    legacy = addVideoClip(legacy, 'local-original', { in: 15, len: 60 }); legacy = addVideoClip(legacy, 'local-original', { in: 90, len: 90 });
    const source = documentForTimeline(base, legacy), serialized = JSON.stringify(source), opened = parseProjectFile(serialized);
    assert.equal(source.schema_version, 2); assert.equal(opened.sourceVersion, 2); assert.equal(opened.document.schema_version, 3);
    assert.deepEqual(opened.timeline.video.map(c => [c.start, c.in, c.len, c.trackId]), [[0, 15, 60, 'video-0'], [60, 90, 90, 'video-0']]); assert.deepEqual(opened.timeline.media, legacy.media);
    assert.equal(JSON.stringify(source), serialized); assert.equal(parseProjectFile(exportProjectFile(opened.timeline).json).sourceVersion, 3);
});
test('damaged, unsupported and embedded-byte documents refuse rather than replacing the current edit with empty work', () => {
    const source = exportProjectFile(fixture()).document;
    for (const value of [null, [], {}, { ...source, schema_version: 4 }, { ...source, project_id: [] }, { ...source, download_url: 'https://example.invalid/source' }, { ...source, timeline: null }, { ...source, timeline: { ...source.timeline, media: { 'local-original': null } } }]) assert.throws(() => parseProjectFile(JSON.stringify(value)), /unsupported or invalid/);
    const damaged = structuredClone(source); damaged.timeline.video[0].len = 99999;
    assert.throws(() => parseProjectFile(JSON.stringify(damaged)), /invalid project data/);
    const bytes = structuredClone(source); bytes.timeline.media[original.id].bytes = 'base64-untrusted';
    assert.throws(() => parseProjectFile(JSON.stringify(bytes)), /invalid project data/);
    assert.throws(() => parseProjectFile('{"schema_version":3'), /not valid JSON/); assert.throws(() => parseProjectFile(''), /Choose a Veyrnox/);
    assert.throws(() => exportProjectFile(emptySequence(), { projectDocument: { ...emptyProjectDocument(projectId), brief: 42 } }), /metadata is invalid/);
});
test('file reads and both JSON directions enforce the byte ceiling, including multibyte text', async () => {
    let reads = 0;
    for (const size of [0, PROJECT_FILE_LIMIT + 1, Infinity, 1.5]) await assert.rejects(readProjectFile({ size, text: async () => { reads++; return '{}'; } }), /up to 32 KiB/);
    assert.equal(reads, 0, 'oversized files must be refused before reading');
    await assert.rejects(readProjectFile({ size: 1, text: async () => { throw new Error('Device detail'); } }), /could not be read/);
    assert.throws(() => parseProjectFile('字'.repeat(11000)), /32 KiB document limit/);
    const exported = exportProjectFile(emptySequence()), boundary = exported.json.padEnd(PROJECT_FILE_LIMIT, ' ');
    assert.equal((await readProjectFile(new Blob([boundary]))).timeline.schemaVersion, 3);
    assert.throws(() => parseProjectFile(`${boundary} `), /32 KiB document limit/);
    let tl = emptySequence(); for (let i = 0; i < 8; i++) tl = ok(addSequenceText(tl, { text: '字'.repeat(1000), start: i * 60, len: 60 }));
    const base = { ...emptyProjectDocument(projectId), brief: '💡'.repeat(3000) };
    assert.throws(() => exportProjectFile(tl, { projectDocument: base }), /32 KiB document limit/);
});
test('a successful imported timeline forms one reversible load boundary and generates safe local filenames', () => {
    const before = ok(addSequenceText(emptySequence(), { text: 'Before opening' })), imported = parseProjectFile(exportProjectFile(fixture()).json);
    const loaded = commitHistory(createHistory(before), imported.timeline);
    assert.equal(loaded.past.length, 1); assert.deepEqual(undoHistory(loaded).now, before); assert.deepEqual(redoHistory(undoHistory(loaded)).now, imported.timeline);
    assert.equal(projectFileName('../Été film.json'), 'Été-film.veyrnox.json'); assert.equal(projectFileName('saved.veyrnox.json'), 'saved.veyrnox.json');
    assert.equal(projectFileName('\u0000/\\'), 'veyrnox-studio-project.veyrnox.json'); assert.ok(projectFileName('x'.repeat(1000)).length <= 93);
    assert.throws(() => exportProjectFile(updateSequenceClip(fixture(), 'video', 'v1', { len: 99999 })), /could not be downloaded/);
});
