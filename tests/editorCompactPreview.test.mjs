import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../app/veyrnox/_components/editor/MultitrackWorkspace.js', import.meta.url), 'utf8');

test('the compact preview scrolls above the mobile section bar while desktop keeps its clipped stage', () => {
    const preview = source.match(/<section aria-label=\{t\("app\.editor\.workspace\.preview"\)\}[^>]*className=\{`([^`]+)`\}/)?.[1] || '';
    assert.match(preview, /overflow-y-auto/);
    assert.match(preview, /overscroll-contain/);
    assert.match(preview, /lg:overflow-hidden/);
});

test('the export dialog cannot be dismissed while the local render is active', () => {
    assert.match(source, /onCancel=\{\(\)=>\{if\(!exporting\)setExportOpen\(false\);\}\}/);
    assert.match(source, /disabled=\{exporting\} onClick=\{\(\)=>setExportOpen\(false\)\}/);
});

test('export failures are passed into the open dialog instead of a notice behind it', () => {
    const panel = readFileSync(new URL('../app/veyrnox/_components/editor/ExportPanel.js', import.meta.url), 'utf8');
    assert.match(source, /error=\{exportError\}/);
    assert.match(source, /setExportError\(e\.message \|\| t\("app\.editor\.workspace\.exportFailed"\)\)/);
    assert.match(panel, /role="alert" data-testid="editor-export-error"/);
});
