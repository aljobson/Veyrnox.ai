import { RULER, clamp01, crossedStep, isMajorTick, nudge, offsetFor, percentOf, valueAfterDrag } from '../src/lib/liveEdit/dial';

test('dragging the ruler right lowers the value, left raises it, and both stop at the ends', () => {
    expect(valueAfterDrag(0.5, RULER * 0.1)).toBeCloseTo(0.4);
    expect(valueAfterDrag(0.5, -RULER * 0.1)).toBeCloseTo(0.6);
    expect(valueAfterDrag(0.05, RULER)).toBe(0);
    expect(valueAfterDrag(0.95, -RULER)).toBe(1);
});
test('the needle always sits over the current value at the middle of the window', () => {
    expect(offsetFor(0, 300)).toBe(150);
    expect(offsetFor(1, 300)).toBe(150 - RULER);
    expect(offsetFor(0.5, 300) + 0.5 * RULER).toBeCloseTo(150); // tick position + offset = the window middle
});
test('a haptic tick fires when the value crosses a 5% line, not while it stays inside one', () => {
    expect(crossedStep(0.51, 0.52)).toBe(false);
    expect(crossedStep(0.54, 0.56)).toBe(true);
    expect(crossedStep(0.56, 0.54)).toBe(true);
    expect(crossedStep(0, 1)).toBe(true);
});
test('values are clamped, rounded to whole percents, and bad numbers become zero', () => {
    expect([clamp01(-3), clamp01(4), clamp01(NaN), clamp01(Infinity)]).toEqual([0, 1, 0, 0]);
    expect(percentOf(0.456)).toBe(46);
    expect(percentOf(7)).toBe(100);
});
test('the screen reader steps by ten percent and stays inside the range', () => {
    expect(nudge(0.5, 'increment')).toBeCloseTo(0.6);
    expect(nudge(0.5, 'decrement')).toBeCloseTo(0.4);
    expect(nudge(0.95, 'increment')).toBe(1);
    expect(nudge(0.02, 'decrement')).toBe(0);
});
test('every fifth tick is a major tick', () => {
    expect([0, 1, 4, 5, 10, 50].map(isMajorTick)).toEqual([true, false, false, true, true, true]);
});
