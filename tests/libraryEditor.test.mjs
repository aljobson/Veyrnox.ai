import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isShelfModel } from '../app/veyrnox/_lib/tokens.js';
import { capabilityFor } from '../lib/modelCapabilities.js';
import { CAPTIONS_UNITS, CAPTION_PRESETS, SLOW_FACTORS, SLOW_UNITS_PER_SECOND, SLOW_MAX_SOURCE_S } from '../lib/clipEdit.js';

// JSX sources, so these read the text, like createAutoShort.test.mjs.
const library = readFileSync(new URL('../app/veyrnox/app/library/page.js', import.meta.url), 'utf8');
const sheet = readFileSync(new URL('../app/veyrnox/_components/EditSheet.js', import.meta.url), 'utf8');

test('the editor is off unless localStorage.veyrnox_editor is "1"', () => {
    assert.match(library, /const EDITOR_FLAG = 'veyrnox_editor';/);
    assert.match(library, /const editorFlag = \(\) => \{ try \{ return window\.localStorage\.getItem\(EDITOR_FLAG\) === '1'; \} catch \{ return false; \} \};/);
    assert.match(library, /const canSelect = \(r\) => editorOn && r\.state === 'succeeded' && /);
});

test('the sheet sends Library job ids and cut points only, as a clip-edit generation', () => {
    assert.match(sheet, /model_id: 'clip-edit', idempotency_key: makeIdempotencyKey\(\), inputs/);
    // Ids and cut points, plus a slow factor only for a clip that is slowed (never a price, key or length).
    assert.match(sheet, /clips: items\.map\(\(x\) => \(\{ asset_id: x\.job_id, in_s: round\(x\.in_s\), out_s: round\(x\.out_s\), \.\.\.\(slowOf\(x\) > 1 \? \{ slow: slowOf\(x\) \} : \{\}\) \}\)\)/);
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

test('the sheet\'s captions share the server\'s unit count and only offer presets the server accepts', () => {
    assert.match(sheet, new RegExp(`const CAPTIONS_UNITS = ${CAPTIONS_UNITS};`));
    const styles = /const CAPTION_STYLES = \[([^\]]+)\];/.exec(sheet)[1].split(',').map((x) => x.trim().replace(/'/g, ''));
    assert.ok(styles.length > 0);
    for (const n of styles) assert.ok(CAPTION_PRESETS.includes(n), n);
    // Hidden unless the per-browser switch is on, and sent as a preset name only.
    assert.match(sheet, /veyrnox_editor_captions/);
    assert.match(sheet, /captions: \{ preset: style \}/);
});

test('the sheet\'s slow motion shares the server\'s numbers, sends a factor only, and is hidden behind its own switch', () => {
    assert.match(sheet, new RegExp(`const SLOW_FACTORS = \\[${SLOW_FACTORS.join(', ')}\\];`));
    assert.match(sheet, new RegExp(`const SLOW_UNITS_PER_SECOND = ${SLOW_UNITS_PER_SECOND};`));
    assert.match(sheet, new RegExp(`const SLOW_MAX_SOURCE_S = ${SLOW_MAX_SOURCE_S};`));
    assert.match(sheet, /veyrnox_editor_slow/);
    assert.match(sheet, /\.\.\.\(slowOf\(x\) > 1 \? \{ slow: slowOf\(x\) \} : \{\}\)/);
    // The sheet refuses what the gateway would: no sound, or too much slowed.
    assert.ok(sheet.includes('slowNoAudio') && sheet.includes('slowTooLong'));
    // Slow motion took about four minutes on a tall 1080p clip on staging, so the sheet says so before the debit.
    assert.match(sheet, /Slow motion can take several minutes to finish/);
    assert.doesNotMatch(sheet, /topaz|target_fps|slowdown_factor/, 'no provider detail reaches the browser');
});
