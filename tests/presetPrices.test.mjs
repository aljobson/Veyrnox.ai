// The catalog is normative for prices (CLAUDE.md). A preset carries its own
// `credits` figure only as a fallback, so every surface that quotes a preset
// price has to resolve it through presetCredits(preset, catalog), the way the
// landing wall and ProductTilesRow do. Printing the constant directly quotes a
// re-priced model at the old price while the studio charges the new one.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');
// Comments explain what the code used to do; matching them would fail on the
// explanation, not the code.
const code = (rel) => read(rel).split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');

test('PresetCard prints the catalog price, not the preset constant', () => {
    const src = code('app/veyrnox/_components/PresetCard.js');
    assert.match(src, /presetCredits\(preset, catalog\)/, 'price must resolve through the catalog');
    assert.ok(!/\{preset\.credits\}/.test(src), 'must not print preset.credits directly');
});

for (const page of [
    'app/veyrnox/presets/page.js',
    'app/veyrnox/app/page.js',
    'app/veyrnox/m/explore/page.js',
]) {
    test(`${page} reads the live catalog once and hands it to every card`, () => {
        const src = code(page);
        assert.match(src, /useCatalog\(\)/, 'must read the catalog');
        assert.match(src, /<PresetCard[^>]*catalog=\{/, 'every PresetCard must receive the catalog');
    });
}

test('site search quotes preset prices through the catalog it already loads', () => {
    const src = code('app/veyrnox/_components/SiteSearch.js');
    assert.match(src, /presetCredits\(p, /, 'preset detail must resolve through the catalog');
    assert.ok(!/\$\{p\.credits\} cr/.test(src), 'must not print p.credits directly');
});
