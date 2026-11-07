import { leapTarget } from '../src/lib/splashLeap';

test('the leap carries the feet from the dot to the foot of the large Vey slot', () => {
    const leap = leapTarget({ x: 300, y: 120 }, { x: 70, y: 400, width: 240, height: 250 }, 20);
    expect(leap.dx).toBe(70 + 120 - 300);
    expect(leap.dy).toBeCloseTo(400 + 250 * 0.96 - 120);
});
test('the mascot grows from its dot height to fill most of the slot', () => {
    expect(leapTarget({ x: 0, y: 0 }, { x: 0, y: 0, width: 200, height: 250 }, 20).scale).toBeCloseTo(10.75);
});
test('a slot level with the dot needs no vertical travel beyond the foot offset', () => {
    const leap = leapTarget({ x: 100, y: 240 }, { x: 0, y: 0, width: 200, height: 250 }, 20);
    expect(leap.dx).toBe(0);
    expect(leap.dy).toBeCloseTo(0);
});
