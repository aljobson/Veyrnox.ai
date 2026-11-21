import { createHoldDrag } from '../src/lib/beatNative/holdDrag';

test.each(['move', 'resize', 'velocity'] as const)('%s never captures a swipe before a long press', kind => {
    const drag = createHoldDrag<typeof kind>();
    drag.begin(kind);
    expect(drag.canCapture(0, 100, 1, false, kind === 'velocity')).toBe(false);
    expect(drag.capture()).toBeNull();
    drag.arm();
    expect(drag.isCaptured()).toBe(false);
    expect(drag.canCapture(0, 0, 1, false)).toBe(false);
    expect(drag.canCapture(0, 100, 2, false)).toBe(false);
    expect(drag.canCapture(0, 100, 1, true)).toBe(false);
    expect(drag.canCapture(0, 100, 1, false, kind === 'velocity')).toBe(true);
    expect(drag.capture()).toBe(kind);
    expect(drag.isCaptured()).toBe(true);
    expect(drag.canCapture(0, 100, 1, false)).toBe(false);
    expect(drag.finish()).toBe(kind);
    expect(drag.finish()).toBeNull();
    expect(drag.canCapture(0, 100, 1, false)).toBe(false);
});
test('velocity requires vertical intent after arming, allowing horizontal scrolling', () => {
    const drag = createHoldDrag<'velocity'>(); drag.begin('velocity'); drag.arm();
    expect(drag.canCapture(20, 10, 1, false, true)).toBe(false);
    expect(drag.canCapture(2, 10, 1, false, true)).toBe(true);
});
test.each(['releaseTouch', 'cancel', 'finish'] as const)('%s clears a stationary hold without committing or selecting', end => {
    const drag = createHoldDrag<'resize'>(); drag.begin('resize'); drag.arm(); drag[end]();
    expect(drag.capture()).toBeNull(); expect(drag.canCapture(50, 0, 1, false)).toBe(false);
    expect(drag.suppressesTap()).toBe(true);
    drag.begin('resize'); expect(drag.suppressesTap()).toBe(false);
    expect(drag.canCapture(50, 0, 1, false)).toBe(false);
});
test('touch-end preserves a captured operation until responder release, while cancel/terminate discards it', () => {
    const drag = createHoldDrag<'move'>(); drag.begin('move'); drag.arm(); drag.capture();
    drag.releaseTouch(); expect(drag.finish()).toBe('move');
    drag.begin('move'); drag.arm(); drag.capture(); drag.cancel();
    expect(drag.isCaptured()).toBe(false); expect(drag.finish()).toBeNull();
    expect(drag.canCapture(50, 0, 1, false)).toBe(false);
});
