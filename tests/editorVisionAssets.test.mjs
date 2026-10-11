import test from 'node:test';
import assert from 'node:assert/strict';
import { VISION_ASSETS, validateVisionManifest } from '../scripts/editor-vision-assets.mjs';
import { EDITOR_VISION_VERSION, EDITOR_VISION_MODEL_SHA256 } from '../app/veyrnox/_lib/editorVisionRuntime.mjs';
const files = VISION_ASSETS.map(file => ({ ...file, bytes: file.bytes ?? 100, sha256: file.sha256 ?? '0'.repeat(64) }));
const fixture = () => ({ version: EDITOR_VISION_VERSION, files: structuredClone(files) });
test('the vision manifest refuses delivery path traversal, substituted hosts, duplicate assets and stale model bytes', () => {
    validateVisionManifest(fixture(), files);
    for (const alter of [
        manifest => { manifest.files[0].path = '../../model.tflite'; },
        manifest => { manifest.files[0].source = 'https://unapproved.example/model.tflite'; },
        manifest => { manifest.files[1] = manifest.files[0]; },
        manifest => { manifest.files[0].sha256 = '1'.repeat(64); },
        manifest => { manifest.files[0].bytes++; },
        manifest => { manifest.files.pop(); },
        manifest => { manifest.version = 'previous-model'; },
    ]) { const manifest = fixture(); alter(manifest); assert.throws(() => validateVisionManifest(manifest, files)); }
});
test('the model/runtime inventory matches the client version and remains below immutable asset bounds', () => {
    assert.equal(VISION_ASSETS[0].sha256, EDITOR_VISION_MODEL_SHA256);
    assert.equal(new Set(VISION_ASSETS.map(file => file.path)).size, VISION_ASSETS.length);
    assert.ok(VISION_ASSETS.every(file => !file.path.includes('..') && !file.path.startsWith('/')));
    assert.ok(VISION_ASSETS.filter(file => file.bytes).every(file => file.bytes < 25 * 1024 * 1024));
    assert.ok(VISION_ASSETS.reduce((sum, file) => sum + (file.bytes ?? 0), 0) < 32 * 1024 * 1024);
});
