import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mixedShapes, shapeMismatch, shapeValue, shapeLabelParts, shapeOrientation, requestedMismatch, matchingOption } from '../lib/videoShape.mjs';
import { validateEdit } from '../lib/clipEdit.js';
const vectors = JSON.parse(readFileSync(new URL('./fixtures/videoShapeVectors.json', import.meta.url)));
for (const vector of vectors) test(vector.name + ': web matches the server', () => {
    assert.equal(mixedShapes(vector.items), vector.mixed);
    const clips = vector.items.map((item, i) => ({ key: `clip-${i}`, in_s: 0, out_s: 2, duration_s: 4, aspect: item.shape_ambiguous ? null : item.width && item.height ? (item.width / item.height).toFixed(2) : item.aspect ?? null }));
    assert.equal(validateEdit({ clips }).error === 'mixed_aspect', vector.mixed);
});
test('labels are advisory; matching is relative to the first clip and updates on reorder', () => {
    const a = { width: 1740, height: 1000 }, b = { width: 1820, height: 1000 };
    assert.deepEqual(shapeLabelParts(a), { orientation: 'landscape', ratio: '16:9' });
    assert.deepEqual(shapeLabelParts(a), shapeLabelParts(b));
    assert.equal(shapeMismatch(b, a), true);
    assert.equal(shapeMismatch(a, a), false);
    const items = [{ aspect: 1.03 }, { aspect: 1 }, { aspect: 1.06 }];
    assert.equal(mixedShapes(items), false);
    assert.equal(mixedShapes([items[1], items[0], items[2]]), true);
    assert.equal(mixedShapes([a]), false);
});
test('dimension validation, labels, and generation hints never invent a shape', () => {
    for (const invalid of [0, -1, 16385, 1.5, '1080', NaN, Infinity, null]) assert.equal(shapeValue(invalid, 1920), null);
    assert.equal(shapeValue(1088, 1920), '0.57');
    assert.equal(shapeOrientation({}), null);
    assert.equal(shapeOrientation(1000, 1000), 'square');
    assert.equal(shapeLabelParts({ width: 1000, height: 8000 }).ratio, null);
    const portrait = { width: 1080, height: 1920 };
    assert.equal(requestedMismatch(portrait, '16:9'), true);
    assert.equal(requestedMismatch(portrait, 'auto'), false);
    assert.equal(requestedMismatch({}, '16:9'), false);
    assert.equal(matchingOption(portrait, ['1:1', '9:16']), '9:16');
    assert.equal(matchingOption(portrait, ['1:1', '16:9']), null);
});
