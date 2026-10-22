import { A_INDEX, DOT_SCALE, HOP_MS, I_INDEX, LEAP_IN_MS, MASCOT_ASPECT, RUN, STRIDE_MS, WORD, mascotPath } from '../src/lib/mascotPath';

// One 28-wide box per letter, side by side.
const letters = WORD.map((_, i) => ({ x: 60 + i * 28, width: 28 }));
const layout = { letters, capTop: 8, stemTop: 18 };

test('the mascot comes in from off the left edge and keeps the picture proportions', () => {
    const p = mascotPath(layout, 40, 36);
    expect(p.mascotWidth).toBeCloseTo(40 * MASCOT_ASPECT);
    expect(p.start.x).toBeLessThan(letters[0].x);
});

test('it hops on each capital in turn, then on the a', () => {
    const p = mascotPath(layout, 40, 36);
    expect(p.stops.map((s) => s.letter)).toEqual([0, 1, 2, 3, 4, 5, 6, A_INDEX]);
    p.stops.forEach((s, n) => {
        expect(s.x).toBe(letters[s.letter].x + 14);
        expect(s.apexY).toBeLessThan(s.y);
        expect(s.durationMs).toBe(n === 0 ? LEAP_IN_MS : HOP_MS);
    });
    expect(p.stops[0].y).toBe(layout.capTop);
    expect(p.stops[A_INDEX - 1].y).toBe(layout.stemTop); // the a is a lowercase letter, lower than the capitals
});

test('a letter sinks a little and the last jump lands over the i stem', () => {
    const p = mascotPath(layout, 40, 36);
    expect(p.sink).toBeGreaterThan(0);
    expect(p.sink).toBeGreaterThan(36 * 0.05);
    expect(p.sink).toBeLessThan(36 * 0.2);
    expect(p.jump.x).toBe(letters[I_INDEX].x + 14);
    expect(p.jump.dotY).toBeLessThan(layout.stemTop);
    expect(p.jump.apexY).toBeLessThan(p.jump.dotY);
    expect(DOT_SCALE).toBeLessThan(1);
});

test('the run cycle stays restrained at wordmark size', () => {
    expect(STRIDE_MS).toBeGreaterThanOrEqual(500);
    expect(RUN.armSwing).toBeLessThanOrEqual(30);
    expect(RUN.bob).toBeLessThan(10);
    expect(RUN.lift).toBeLessThan(40);
});
