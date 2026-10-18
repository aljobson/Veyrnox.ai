import { MIN_TARGET, hitSlopFor, selectedState, touchTarget } from '../src/lib/a11y';

test('hit slop brings a small view up to 44 points and leaves a big one alone', () => {
    expect(hitSlopFor(24, 24)).toEqual({ top: 10, bottom: 10, left: 10, right: 10 });
    expect(hitSlopFor(60, 44)).toEqual({ top: 0, bottom: 0, left: 0, right: 0 });
    expect(hitSlopFor(23, 50)).toEqual({ top: 0, bottom: 0, left: 11, right: 11 });
});
test('constants', () => {
    expect(MIN_TARGET).toBe(44);
    expect(touchTarget.minHeight).toBe(44);
    expect(selectedState(true)).toEqual({ selected: true });
});
