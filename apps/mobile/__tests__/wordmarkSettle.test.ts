import { Animated } from 'react-native';
import { settleWordmark } from '../src/lib/wordmarkSettle';

test('settling returns every hop value to the dot', () => {
    const v = { leapX: new Animated.Value(180), leapY: new Animated.Value(-90), leapScale: new Animated.Value(9), tilt: new Animated.Value(1), squash: new Animated.Value(1), stride: new Animated.Value(0.6) };
    settleWordmark(v);
    expect([v.leapX, v.leapY, v.leapScale, v.tilt, v.squash, v.stride].map((x) => (x as any).__getValue())).toEqual([0, 0, 1, 0, 0, 0]);
});
