import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('web export emits bounded composited footage thumbnails and revokes replaced URLs', () => {
    const exporter = readFileSync(new URL('../app/veyrnox/_lib/editorExport.mjs', import.meta.url), 'utf8');
    const workspace = readFileSync(new URL('../app/veyrnox/_components/editor/MultitrackWorkspace.js', import.meta.url), 'utf8');
    const progress = readFileSync(new URL('../app/veyrnox/_components/editor/ExportReadyCard.js', import.meta.url), 'utf8');
    assert.match(exporter, /previewWidth = Math\.min\(480, W\)/);
    assert.match(exporter, /context\.drawImage\(canvas, 0, 0, previewWidth, previewHeight\)/);
    assert.match(exporter, /convertToBlob\(\{ type: 'image\/jpeg', quality: \.78 \}\)/);
    assert.match(workspace, /setExportPreview\(URL\.createObjectURL\(frame\)\)/);
    assert.match(workspace, /URL\.revokeObjectURL\(exportPreview\)/);
    assert.match(progress, /<img src=\{preview\} alt=\{t\('app\.editor\.export\.previewLabel'\)\}/);
});
