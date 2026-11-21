import { mixedShapes, shapeLabelParts, shapeMismatch, shapeValue, type ShapeItem } from '../src/lib/videoShape';
const vectors = require('../../../tests/fixtures/videoShapeVectors.json') as { name: string; items: ShapeItem[]; mixed: boolean }[];
test.each(vectors)('$name: phone uses the shared server vectors', ({ items, mixed }) => expect(mixedShapes(items)).toBe(mixed));
test('labels never decide compatibility and live dimensions cannot unblock an ambiguous job', () => {
    const a = { width: 1740, height: 1000 }, b = { width: 1820, height: 1000 };
    expect(shapeLabelParts(a)).toEqual(shapeLabelParts(b));
    expect(shapeMismatch(b, a)).toBe(true);
    expect(shapeMismatch({ ...b, shape_ambiguous: true }, a)).toBe(false);
    expect(shapeValue(1088, 1920)).toBe('0.57');
});
