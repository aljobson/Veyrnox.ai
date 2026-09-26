// The landing wall is built from the real PRESETS, and its bento layout is
// hand-shaped for seven tiles. A grid with a hole in it (or a preset added
// without a matching layout) has to fail here, not on the live page.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PRESETS, presetHref, presetCredits, modelIdForName } from '../app/veyrnox/_lib/tokens.js';
import { wallShapes, tileClasses, LG_COLUMNS, SM_COLUMNS } from '../app/veyrnox/_lib/presetWall.js';

const cells = (shapes, colsKey, rowsKey) =>
    shapes.reduce((n, s) => n + s[colsKey] * (rowsKey ? s[rowsKey] : 1), 0);

test('every real preset gets exactly one tile', () => {
    assert.equal(wallShapes(PRESETS.length).length, PRESETS.length);
});

test('the desktop grid has no empty cell', () => {
    const shapes = wallShapes(PRESETS.length);
    assert.equal(
        cells(shapes, 'lgCols', 'lgRows') % LG_COLUMNS,
        0,
        `${PRESETS.length} presets leave a hole in the ${LG_COLUMNS}-column grid: reshape wallShapes() in _lib/presetWall.js`,
    );
});

test('the phone grid has no empty cell', () => {
    const shapes = wallShapes(PRESETS.length);
    assert.equal(
        cells(shapes, 'smCols') % SM_COLUMNS,
        0,
        `${PRESETS.length} presets leave a hole in the ${SM_COLUMNS}-column grid: reshape wallShapes() in _lib/presetWall.js`,
    );
});

test('no tile is wider than its grid', () => {
    for (const s of wallShapes(PRESETS.length)) {
        assert.ok(s.lgCols <= LG_COLUMNS);
        assert.ok(s.smCols <= SM_COLUMNS);
    }
});

test('the layout checks would catch a wrong count', () => {
    // Six tiles fall back to a uniform grid, and 6 does not fill 4 columns:
    // proof the hole check above can fail.
    const six = wallShapes(6);
    assert.equal(six.length, 6);
    assert.notEqual(cells(six, 'lgCols', 'lgRows') % LG_COLUMNS, 0);
});

test('exactly one hero tile, and it leads', () => {
    const shapes = wallShapes(PRESETS.length);
    assert.equal(shapes.filter((s) => s.kind === 'hero').length, 1);
    assert.equal(shapes[0].kind, 'hero');
});

test('a preset links to the studio with its model and its own id', () => {
    const p = PRESETS.find((x) => modelIdForName(x.model));
    assert.ok(p, 'expected at least one preset whose model is in the catalog');
    const href = presetHref(p);
    assert.ok(href.startsWith('/app/create?'));
    assert.ok(href.includes(`model=${encodeURIComponent(modelIdForName(p.model))}`));
    assert.ok(href.includes(`preset=${encodeURIComponent(p.id)}`));
});

test('a preset whose model has drifted out of the catalog links without a model', () => {
    const href = presetHref({ id: 'ghost', name: 'GHOST', model: 'No Such Model' });
    assert.equal(href, '/app/create?preset=ghost');
});

// CSS grid auto-placement without `dense`: the cursor only moves forward, so a
// tile that does not fit never backfills an earlier gap. Returns the number of
// empty cells inside the rows the tiles occupy.
function holesAfterPlacement(shapes, columns, colsKey, rowsKey) {
    const taken = new Set();
    const key = (r, c) => `${r},${c}`;
    let cursor = 0;
    let lastRow = 0;
    for (const s of shapes) {
        const w = s[colsKey];
        const h = rowsKey ? s[rowsKey] : 1;
        for (;; cursor += 1) {
            const row = Math.floor(cursor / columns);
            const col = cursor % columns;
            if (col + w > columns) continue;
            let fits = true;
            for (let dr = 0; dr < h && fits; dr += 1) {
                for (let dc = 0; dc < w; dc += 1) if (taken.has(key(row + dr, col + dc))) { fits = false; break; }
            }
            if (!fits) continue;
            for (let dr = 0; dr < h; dr += 1) for (let dc = 0; dc < w; dc += 1) taken.add(key(row + dr, col + dc));
            lastRow = Math.max(lastRow, row + h - 1);
            break;
        }
    }
    return (lastRow + 1) * columns - taken.size;
}

test('placed in order, the desktop and phone grids have no hole', () => {
    const shapes = wallShapes(PRESETS.length);
    assert.equal(holesAfterPlacement(shapes, LG_COLUMNS, 'lgCols', 'lgRows'), 0, 'desktop');
    assert.equal(holesAfterPlacement(shapes, SM_COLUMNS, 'smCols'), 0, 'phone');
});

test('the placement check catches a bad order that the cell count would pass', () => {
    // Three small tiles then a wide one: the wide tile cannot fit in the last
    // cell of the row, and the cursor never goes back, so that cell stays empty.
    // 3 + 2 + 3 = 8 cells fills two rows of 4 on paper, so the count passes.
    const TILE = { kind: 'tile', lgCols: 1, lgRows: 1, smCols: 1 };
    const WIDE = { kind: 'wide', lgCols: 2, lgRows: 1, smCols: 1 };
    const bad = [TILE, TILE, TILE, WIDE, TILE, TILE, TILE];
    assert.equal(cells(bad, 'lgCols', 'lgRows') % LG_COLUMNS, 0, 'the count alone would pass');
    assert.ok(holesAfterPlacement(bad, LG_COLUMNS, 'lgCols', 'lgRows') > 0, 'the placement check must fail');
});

test('the class strings match the layout metadata', () => {
    for (const shape of wallShapes(PRESETS.length)) {
        const { link } = tileClasses(shape);
        const has = (c) => link.split(/\s+/).includes(c);
        assert.equal(has('lg:col-span-2'), shape.lgCols === 2, `${shape.kind}: lg column span`);
        assert.equal(has('lg:row-span-2'), shape.lgRows === 2, `${shape.kind}: lg row span`);
        assert.equal(has('col-span-2'), shape.smCols === 2, `${shape.kind}: phone column span`);
    }
});

test('a wall tile prints the live catalog price, falling back to the preset figure', () => {
    const p = PRESETS.find((x) => modelIdForName(x.model));
    const id = modelIdForName(p.model);
    assert.equal(presetCredits(p, [{ id, credits: p.credits + 5 }]), p.credits + 5, 're-priced row wins');
    assert.equal(presetCredits(p, undefined), p.credits, 'no catalog');
    assert.equal(presetCredits(p, []), p.credits, 'model not in the catalog');
    assert.equal(presetCredits(p, [{ id, credits: null }]), p.credits, 'non-numeric row price');
});

test('the wall builds its links and prices through the shared helpers', () => {
    const raw = readFileSync(new URL('../app/veyrnox/_sections/showcase.js', import.meta.url), 'utf8');
    const src = raw.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
    const wall = src.slice(src.indexOf('export function PresetWall'), src.indexOf('Model shelf'));
    assert.match(wall, /presetHref\(preset\)/, 'wall links must come from presetHref');
    assert.match(wall, /presetCredits\(preset, catalog\)/, 'wall prices must resolve through the catalog');
    assert.ok(!/\{preset\.credits\}/.test(wall), 'must not print the hardcoded preset credits');
});
