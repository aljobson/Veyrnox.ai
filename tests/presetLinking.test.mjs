import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { MODELS, PRESETS, PRESET_CATEGORIES, modelIdForName, presetHref, templateHref, templatesIn } from '../app/veyrnox/_lib/tokens.js';

test('every preset names a model that still exists in the catalog list', () => {
    // A drifted name makes the card link without a model — not broken, but it
    // silently stops preselecting, which is the kind of thing nobody notices.
    for (const p of PRESETS) {
        assert.ok(modelIdForName(p.model), `preset "${p.id}" names "${p.model}", which is not in MODELS`);
    }
});

test('model names resolve to ids, and a drifted name resolves to null', () => {
    assert.equal(modelIdForName('Wan 2.5'), 'wan-2.5-kie');
    assert.equal(modelIdForName('  wan 2.5  '), 'wan-2.5-kie', 'case and padding insensitive');
    assert.equal(modelIdForName('MiniMax Hailuo 02'), 'hailuo-02-kie');
    assert.equal(modelIdForName('Wan 9.9'), null);
    assert.equal(modelIdForName(''), null);
    assert.equal(modelIdForName(undefined), null);
});

test('every preset quotes the same credit cost as its model', () => {
    // The preset card prints preset.credits; the studio then charges the
    // model's price. A mismatch is a quoted price the server refuses to honour.
    for (const p of PRESETS) {
        const m = MODELS.find((x) => x.id === modelIdForName(p.model));
        if (!m) continue;
        assert.equal(p.credits, m.credits, `preset "${p.id}" quotes ${p.credits} cr but ${m.id} costs ${m.credits} cr`);
    }
});

test('the template card navigates to its template page', () => {
    const raw = readFileSync(new URL('../app/veyrnox/_components/PresetCard.js', import.meta.url), 'utf8');
    // Strip comments first, so an explanation cannot satisfy or fail a check.
    const src = raw.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
    assert.match(src, /<Link/, 'must render a Link');
    assert.match(src, /templateHref\(preset\)/, 'must link to the template page');
    assert.ok(!/<button[\s>]/.test(src), 'must not go back to a button every caller forgets to wire');
    assert.equal(templateHref({ id: 'cctv-night' }), '/presets/cctv-night');
    // The template page's "Use this template" opens the studio on the model.
    const withModel = PRESETS.find((p) => modelIdForName(p.model));
    assert.match(presetHref(withModel), /^\/app\/create\?model=/);
});

test('every template carries a prompt, a unique id and a known category', () => {
    const ids = new Set();
    for (const p of PRESETS) {
        assert.ok(!ids.has(p.id), `duplicate template id ${p.id}`);
        ids.add(p.id);
        assert.match(p.id, /^[a-z0-9-]+$/);
        assert.ok(typeof p.prompt === 'string' && p.prompt.length > 10, `template "${p.id}" has no prompt`);
        assert.ok(PRESET_CATEGORIES.includes(p.category) && !['ALL', 'NEW'].includes(p.category), `template "${p.id}" has category ${p.category}`);
    }
    for (const c of PRESET_CATEGORIES) assert.ok(templatesIn(c).length > 0, `category ${c} is empty`);
});

test('a template whose model needs an upload says what to upload', () => {
    // Models with a required media slot in lib/modelCapabilities.js.
    const needsUpload = new Set(['kling-3.0-i2v', 'kling-avatar-v2', 'nano-banana-pro-edit', 'bria-bg-remove']);
    for (const p of PRESETS) {
        if (needsUpload.has(modelIdForName(p.model))) assert.ok(p.needs, `template "${p.id}" needs an upload but does not say so`);
    }
});

test('the landing tiles take their price from the catalog, not the constant', () => {
    // The feature tiles under the hero replaced ProductTilesRow; they quote
    // the catalog row their link opens.
    const src = readFileSync(new URL('../app/veyrnox/_sections/hero.js', import.meta.url), 'utf8');
    assert.match(src, /const row = rowOf\(modelOf\(f\.href\)\);/, 'tile price must resolve through the live catalog');
    assert.match(src, /`\$\{row\.credits\} cr`/);
    assert.ok(!/\{f\.credits\}/.test(src), 'must not print a hardcoded tile price');
});
