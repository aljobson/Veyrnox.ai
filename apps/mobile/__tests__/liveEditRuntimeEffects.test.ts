import { runtimeEffect } from '../src/lib/liveEdit/runtimeEffects';
import { MATRIX, SMOOTH } from '../src/lib/liveEdit/shaders';
import { Skia } from '@shopify/react-native-skia';
jest.mock('@shopify/react-native-skia', () => ({ Skia: { RuntimeEffect: { Make: jest.fn(() => ({ dispose: jest.fn() })) } } }));
test('immutable runtime programs compile once per source; arbitrary source cannot grow the cache', () => {
    expect(runtimeEffect(MATRIX)).toBe(runtimeEffect(MATRIX));
    expect(runtimeEffect(SMOOTH)).toBe(runtimeEffect(SMOOTH));
    expect(Skia.RuntimeEffect.Make).toHaveBeenCalledTimes(2);
    expect(() => runtimeEffect('unknown source')).toThrow('live-edit-unknown-shader');
});
