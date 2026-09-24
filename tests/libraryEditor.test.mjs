import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isShelfModel } from '../app/veyrnox/_lib/tokens.js';
import { capabilityFor } from '../lib/modelCapabilities.js';

// JSX sources, so these read the text, like createAutoShort.test.mjs.
const library = readFileSync(new URL('../app/veyrnox/app/library/page.js', import.meta.url), 'utf8');
const sheet = readFileSync(new URL('../app/veyrnox/_components/EditSheet.js', import.meta.url), 'utf8');

test('the editor is off unless localStorage.veyrnox_editor is "1"', () => {
    assert.match(library, /const EDITOR_FLAG = 'veyrnox_editor';/);
    assert.match(library, /setEditorOn\(window\.localStorage\.getItem\(EDITOR_FLAG\) === '1'\)/);
    assert.match(library, /const canSelect = \(r\) => editorOn && r\.state === 'succeeded' && /);
});

test('the sheet sends Library job ids and cut points only, as a clip-edit generation', () => {
    assert.match(sheet, /model_id: 'clip-edit', idempotency_key: makeIdempotencyKey\(\), inputs/);
    assert.match(sheet, /clips: items\.map\(\(x\) => \(\{ asset_id: x\.job_id, in_s: round\(x\.in_s\), out_s: round\(x\.out_s\) \}\)\)/);
    // No price, key or length from the client: the gateway measures and prices.
    assert.doesNotMatch(sheet, /credits:\s*cost[^,]*,\s*\n?\s*inputs/);
    assert.doesNotMatch(sheet, /r2_key|duration_s/);
});

test('the sheet refuses what the gateway would, before spending a request', () => {
    for (const guard of ['mixed', 'badRange', 'noop', 'output > MAX_OUTPUT_S', 'cost == null']) {
        assert.ok(sheet.includes(guard), guard);
    }
    assert.match(sheet, /const MAX_OUTPUT_S = 60;/);
});

test('the landing shelf and site search never list the Clip Editor as a model', () => {
    // Both surfaces filter through isShelfModel, which also holds back the
    // still-gated Auto Short row (tests/shelfModels.test.mjs pins the rest).
    assert.equal(isShelfModel(capabilityFor('clip-edit:v1')), false);
    const landing = readFileSync(new URL('../app/veyrnox/page.js', import.meta.url), 'utf8');
    const search = readFileSync(new URL('../app/veyrnox/_components/SiteSearch.js', import.meta.url), 'utf8');
    assert.match(landing, /filter\(\(m\) => isShelfModel\(/);
    assert.match(search, /filter\(\(m\) => isShelfModel\(/);
});
