import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { MODELS, PRESETS, modelIdForName } from '../app/veyrnox/_lib/tokens.js';

test('every preset names a model that still exists in the catalog list', () => {
    // A drifted name makes the card link without a model — not broken, but it
    // silently stops preselecting, which is the kind of thing nobody notices.
    for (const p of PRESETS) {
        assert.ok(modelIdForName(p.model), `preset "${p.id}" names "${p.model}", which is not in MODELS`);
    }
});

test('model names resolve to ids, and a drifted name resolves to null', () => {
    assert.equal(modelIdForName('Wan 2.5'), 'wan-2.5');
    assert.equal(modelIdForName('  wan 2.5  '), 'wan-2.5', 'case and padding insensitive');
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

test('the preset card navigates rather than being an inert button', () => {
    const raw = readFileSync(new URL('../app/veyrnox/_components/PresetCard.js', import.meta.url), 'utf8');
    // Strip comments first: this file's own comment explains the button it
    // replaced, and matching that would fail on the explanation, not the code.
    const src = raw.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
    assert.match(src, /<Link/, 'must render a Link');
    assert.match(src, /\/app\/create\?model=/, 'must carry the model Create reads on mount');
    assert.ok(!/<button[\s>]/.test(src), 'must not go back to a button every caller forgets to wire');
});

test('the landing tiles take their price from the catalog, not the constant', () => {
    // ProductTilesRow lives in the showcase section since the landing page was
    // split to stay under the 500-line limit.
    const src = readFileSync(new URL('../app/veyrnox/_sections/showcase.js', import.meta.url), 'utf8');
    assert.match(src, /priceOf\(p\.key, p\.credits\)/, 'tile price must resolve through the live catalog');
    assert.ok(!/\{p\.credits\}\s*cr/.test(src), 'must not print the hardcoded tile credits directly');
});
