import { act } from 'react';
import * as RN from 'react-native';
import { createRoot, type Root } from 'test-renderer';
import { BrandGlow } from '../src/components/BrandGlow';
import { ds } from '../src/theme';

jest.mock('../src/components/ui', () => {
    const theme = require('../src/theme');
    return { themedStyles: (fn: Function) => fn(theme.tokensForScheme('dark'), theme.text, 'dark'), useThemedStyles: (s: object) => s };
});
let root: Root;
let timing: jest.SpyInstance;
beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    timing = jest.spyOn(RN.Animated, 'timing').mockImplementation(() => ({ start: jest.fn(), stop: jest.fn() }) as any);
    root = createRoot();
});
afterEach(async () => { await act(async () => root.unmount()); jest.restoreAllMocks(); });

test('the glow waits, unseen, until Vey has landed', async () => {
    await act(async () => root.render(<BrandGlow shown={false} reduced={false} />));
    expect(timing).not.toHaveBeenCalled();
});
test('the glow fades in over the sheet duration, on the native driver', async () => {
    await act(async () => root.render(<BrandGlow shown reduced={false} />));
    expect(timing).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ toValue: 1, duration: ds.motion.sheet, useNativeDriver: true }));
});
test('under Reduce Motion the glow fades in faster, without the scale', async () => {
    await act(async () => root.render(<BrandGlow shown reduced />));
    expect(timing).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ duration: ds.motion.state }));
});
