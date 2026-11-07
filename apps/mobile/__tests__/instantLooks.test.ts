import { DEFAULT_STRENGTH, IDENTITY, LOOK_IDS, chain, isUnchanged, lookMatrix } from '../src/lib/instantLooks';

test('original and zero strength leave the photo untouched', () => {
    expect(lookMatrix({ id: 'original', strength: 1 })).toEqual([...IDENTITY]);
    expect(lookMatrix({ id: 'vivid', strength: 0 })).toEqual([...IDENTITY]);
    expect(isUnchanged({ id: 'warm', strength: 0 })).toBe(true);
    expect(isUnchanged({ id: 'warm', strength: DEFAULT_STRENGTH })).toBe(false);
});

test('every look is a 4x5 matrix of finite numbers that keeps alpha', () => {
    for (const id of LOOK_IDS) for (const strength of [0, 0.5, 1]) {
        const m = lookMatrix({ id, strength });
        expect(m).toHaveLength(20);
        expect(m.every(Number.isFinite)).toBe(true);
        expect(m.slice(15)).toEqual([0, 0, 0, 1, 0]);
    }
});

test('strength moves the matrix smoothly from identity to the full look', () => {
    const half = lookMatrix({ id: 'vivid', strength: 0.5 });
    const full = lookMatrix({ id: 'vivid', strength: 1 });
    expect(half[0]).toBeGreaterThan(1);
    expect(half[0]).toBeLessThan(full[0]);
    expect(lookMatrix({ id: 'vivid', strength: 5 })).toEqual(full);
    expect(lookMatrix({ id: 'vivid', strength: Number.NaN })).toEqual([...IDENTITY]);
});

test('mono removes colour: equal red, green and blue rows', () => {
    const m = lookMatrix({ id: 'mono', strength: 1 });
    for (let col = 0; col < 3; col++) {
        expect(m[col]).toBeCloseTo(m[5 + col]);
        expect(m[col]).toBeCloseTo(m[10 + col]);
    }
});

test('chain applies the first matrix before the second', () => {
    const double = [2, 0, 0, 0, 0, 0, 2, 0, 0, 0, 0, 0, 2, 0, 0, 0, 0, 0, 1, 0];
    const lift = [1, 0, 0, 0, 0.1, 0, 1, 0, 0, 0.1, 0, 0, 1, 0, 0.1, 0, 0, 0, 1, 0];
    expect(chain(double, lift)[4]).toBeCloseTo(0.1);
    expect(chain(lift, double)[4]).toBeCloseTo(0.2);
});
