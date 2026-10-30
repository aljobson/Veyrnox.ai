import { act } from 'react';
import * as RN from 'react-native';
import { createRoot, type Root } from 'test-renderer';
import { CelebrationHost, Confetti, CELEBRATION_MS, CLAP_MS, CONFETTI_COUNT, BURST_END } from '../src/components/CelebrationHost';
import { emitCelebration } from '../src/lib/veyMotion';
const mockSuccess = jest.fn();
let mockReduced = true;
let mockPath = '/';
jest.mock('../src/lib/haptics', () => ({ playSuccess: () => mockSuccess() }));
jest.mock('../src/components/ui/useReducedMotion', () => ({ useReducedMotion: () => mockReduced }));
jest.mock('../src/components/VeyCharacter', () => ({ VeyCharacter: (props: object) => require('react').createElement(require('react-native').View, { ...props, testID: 'vey' }) }));
jest.mock('expo-router', () => ({ usePathname: () => mockPath }));
jest.mock('../src/lib/appCache', () => ({ subscribeCacheUser: () => () => {} }));
void [RN.View, RN.Text, RN.Pressable, RN.Modal];
let root: Root;
beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    root = createRoot();
    mockReduced = true;
    mockPath = '/';
    mockSuccess.mockClear();
    jest.useFakeTimers();
});
afterEach(async () => {
    await act(async () => root.unmount());
    jest.useRealTimers();
});
async function show() {
    await act(async () => root.render(<CelebrationHost />));
    const onShown = jest.fn(),
        onDone = jest.fn();
    await act(async () => {
        expect(emitCelebration({ kind: 'firstCreation', onShown, onDone })).toBe(true);
    });
    await act(async () => {
        root.container.queryAll((n) => typeof n.props.onShow === 'function')[0].props.onShow();
    });
    return { onShown, onDone };
}
test('reduced motion renders no confetti, acknowledges display and resolves dismissal', async () => {
    const event = await show();
    expect(root.container.queryAll((n) => n.props.testID === 'confetti-piece')).toHaveLength(0);
    expect(root.container.queryAll((n) => n.props.testID === 'vey')[0].props.mood).toBe('cheer');
    expect(event.onShown).toHaveBeenCalledTimes(1);
    expect(mockSuccess).toHaveBeenCalledTimes(1);
    await act(async () => {
        root.container.queryAll((n) => n.props.accessibilityLabel === 'Dismiss celebration')[0].props.onClick({ nativeEvent: {}, currentTarget: 1, target: 1 });
    });
    expect(event.onDone).toHaveBeenCalledTimes(1);
});
test('full motion renders the confetti burst, changes to clap and finishes at 5 seconds', async () => {
    mockReduced = false;
    const event = await show();
    expect(root.container.queryAll((n) => n.props.testID === 'confetti-piece')).toHaveLength(CONFETTI_COUNT);
    await act(async () => jest.advanceTimersByTime(CLAP_MS));
    expect(root.container.queryAll((n) => n.props.testID === 'vey')[0].props.mood).toBe('clap');
    await act(async () => jest.advanceTimersByTime(CELEBRATION_MS - CLAP_MS - 1));
    expect(event.onDone).not.toHaveBeenCalled();
    expect(root.container.queryAll((n) => n.props.testID === 'vey')).toHaveLength(1);
    expect(root.container.queryAll((n) => n.props.testID === 'confetti-piece')).toHaveLength(CONFETTI_COUNT);
    await act(async () => jest.advanceTimersByTime(1));
    expect(event.onDone).toHaveBeenCalledTimes(1);
    expect(root.container.queryAll((n) => n.props.testID === 'confetti-piece')).toHaveLength(0);
});
test('confetti explodes from the centre in every direction, then falls below the screen and fades only in the final 600ms', async () => {
    const timing = jest.spyOn(RN.Animated, 'timing');
    const interpolate = jest.spyOn(RN.Animated.Value.prototype, 'interpolate');
    try {
        await act(async () => root.render(<Confetti />));
        expect(timing).toHaveBeenCalledTimes(1);
        expect(timing.mock.calls[0][1]).toMatchObject({ duration: CELEBRATION_MS, useNativeDriver: true });
        const { width, height } = RN.Dimensions.get('window');
        const pieces = root.container.queryAll((n) => n.props.testID === 'confetti-piece').map((n) => RN.StyleSheet.flatten(n.props.style));
        expect(pieces).toHaveLength(CONFETTI_COUNT);
        // Every piece starts at the blast point, near the mascot.
        expect(pieces.every((s) => Math.abs(s.left + s.width / 2 - width / 2) < 1 && s.top === height * 0.42)).toBe(true);
        expect(new Set(pieces.map((s) => `${s.width}x${s.height}`)).size).toBeGreaterThan(5);
        const configs = interpolate.mock.calls.map(([config]) => config);
        const xs = configs.filter((c) => c.inputRange.length === 4 && c.outputRange.length === 4);
        const ys = configs.filter((c) => c.inputRange.length === 5);
        expect(xs).toHaveLength(CONFETTI_COUNT);
        expect(ys).toHaveLength(CONFETTI_COUNT);
        // The burst reaches out left and right, up and down, within the first BURST_END of the clock.
        const bursts = xs.map((c, i) => [c.outputRange[2], ys[i].outputRange[2]]);
        expect(bursts.some(([x]) => x < -width / 4) && bursts.some(([x]) => x > width / 4)).toBe(true);
        expect(bursts.some(([, y]) => y < -height / 8) && bursts.some(([, y]) => y > height / 8)).toBe(true);
        expect(xs.every((c) => Math.abs(c.inputRange[2] - c.inputRange[0] - BURST_END) < 1e-9 && c.extrapolate === 'clamp')).toBe(true);
        // Then everything falls past the bottom edge.
        expect(ys.every((c) => c.outputRange[4] === height * 1.2 && c.inputRange[4] === 1)).toBe(true);
        const fades = configs.filter((c) => c.outputRange.join(',') === '1,1,0');
        expect(fades).toHaveLength(CONFETTI_COUNT);
        expect(fades.every((c) => Math.abs(c.inputRange[1] * CELEBRATION_MS - (CELEBRATION_MS - 600)) < 1e-6)).toBe(true);
        const animation = timing.mock.results[0].value;
        const stop = jest.spyOn(animation, 'stop');
        await act(async () => root.render(<></>));
        expect(stop).toHaveBeenCalled();
    } finally {
        timing.mockRestore();
        interpolate.mockRestore();
    }
});
test('navigation and unmount resolve pending celebrations and clear their timers', async () => {
    const event = await show();
    mockPath = '/account';
    await act(async () => root.render(<CelebrationHost />));
    expect(event.onDone).toHaveBeenCalledTimes(1);
    await act(async () => jest.advanceTimersByTime(CELEBRATION_MS));
    expect(event.onDone).toHaveBeenCalledTimes(1);
});
test('the app layout mounts one host beside AI consent', () => {
    const fs = require('fs');
    const source = fs.readFileSync(require('path').join(__dirname, '../src/app/(app)/_layout.tsx'), 'utf8');
    expect(source.match(/<CelebrationHost\s*\/>/g)).toHaveLength(1);
    expect(source).toMatch(/<AiConsentHost\s*\/>\s*<CelebrationHost/);
});
declare const __dirname: string;
