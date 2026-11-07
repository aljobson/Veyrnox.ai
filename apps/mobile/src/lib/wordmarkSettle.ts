import type { Animated } from 'react-native';

export type WordmarkValues = Record<'leapX' | 'leapY' | 'leapScale' | 'tilt' | 'squash' | 'stride', Animated.Value>;

// Back to the settled dot: no hop offset, the dot's own size, upright, unsquashed and standing still. Used when Reduce Motion
// is switched on part-way through the run or the hop, after the animations have been stopped.
export function settleWordmark(v: WordmarkValues): void {
    v.leapX.setValue(0);
    v.leapY.setValue(0);
    v.leapScale.setValue(1);
    v.tilt.setValue(0);
    v.squash.setValue(0);
    v.stride.setValue(0);
}
