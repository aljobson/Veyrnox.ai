import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { editorFeatureEnabled } from '../lib/editorRuntimeFlags.mjs';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('the Pro interchange buttons are off unless the proEditor switch is exactly true', () => {
    assert.equal(editorFeatureEnabled('PRO_EDITOR_ENABLED', {}), false);
    assert.equal(editorFeatureEnabled('PRO_EDITOR_ENABLED', { EDITOR_RUNTIME_FLAGS: '{"proEditor":"false"}' }), false);
    assert.equal(editorFeatureEnabled('PRO_EDITOR_ENABLED', { EDITOR_RUNTIME_FLAGS: '{"proEditor":"true"}' }), true);
});
test('the flag reaches the workspace only through the layout, and the controls render only under it', async () => {
    const layout = await read('app/veyrnox/app/editor/layout.js');
    assert.match(layout, /proInterchange=\{editorFeatureEnabled\('PRO_EDITOR_ENABLED'\)\}/);
    const provider = await read('app/veyrnox/_components/editor/CompletionFlags.js');
    assert.match(provider, /proInterchange:false/);
    assert.match(provider, /proInterchange:proInterchange===true/);
    const workspace = await read('app/veyrnox/_components/editor/MultitrackWorkspace.js');
    assert.match(workspace, /\{proInterchange && <ProInterchangeControls /);
    assert.match(workspace, /openDisabled=\{!!projectContext\?\.id\}/);
});
test('the controls convert locally: no network, storage or cloud calls', async () => {
    const source = await read('app/veyrnox/_components/editor/ProInterchangeControls.js');
    assert.doesNotMatch(source, /fetch\(|XMLHttpRequest|localStorage|sessionStorage|sendBeacon/);
    assert.match(source, /MAX_FILE_BYTES/);
});
