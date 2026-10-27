import { act } from 'react';
import * as RN from 'react-native';
import { createRoot, type Root } from 'test-renderer';
import { CelebrationHost, Confetti, CELEBRATION_MS } from '../src/components/CelebrationHost';
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
test('full motion renders 80 pieces, changes to clap and finishes at 2.6 seconds', async () => {
    mockReduced = false;
    const event = await show();
    expect(root.container.queryAll((n) => n.props.testID === 'confetti-piece')).toHaveLength(80);
    await act(async () => jest.advanceTimersByTime(500));
    expect(root.container.queryAll((n) => n.props.testID === 'vey')[0].props.mood).toBe('clap');
    await act(async () => jest.advanceTimersByTime(CELEBRATION_MS - 501));
    expect(event.onDone).not.toHaveBeenCalled();
    expect(root.container.queryAll((n) => n.props.testID === 'vey')).toHaveLength(1);
    expect(root.container.queryAll((n) => n.props.testID === 'confetti-piece')).toHaveLength(80);
    await act(async () => jest.advanceTimersByTime(1));
    expect(event.onDone).toHaveBeenCalledTimes(1);
    expect(root.container.queryAll((n) => n.props.testID === 'confetti-piece')).toHaveLength(0);
});
test('confetti spans the width, falls below the screen, staggers over 400ms and fades only in the final 600ms', async () => {
    const timing = jest.spyOn(RN.Animated, 'timing');
    const interpolate = jest.spyOn(RN.Animated.Value.prototype, 'interpolate');
    try {
        await act(async () => root.render(<Confetti />));
        expect(timing).toHaveBeenCalledTimes(1);
        expect(timing.mock.calls[0][1]).toMatchObject({ duration: 2600, useNativeDriver: true });
        const { width, height } = RN.Dimensions.get('window');
        const pieces = root.container.queryAll((n) => n.props.testID === 'confetti-piece').map((n) => RN.StyleSheet.flatten(n.props.style));
        expect(pieces).toHaveLength(80);
        expect(Math.min(...pieces.map((s) => s.left))).toBeLessThan(width * 0.05);
        expect(Math.max(...pieces.map((s) => s.left))).toBeGreaterThan(width * 0.95);
        expect(pieces.every((s) => s.top + s.height < 0)).toBe(true);
        const configs = interpolate.mock.calls.map(([config]) => config);
        const falls = configs.filter((c) => c.outputRange[2] === height + 48);
        expect(falls).toHaveLength(80);
        expect(falls.every((c) => c.outputRange[0] === 0 && c.inputRange[2] === 1 && c.extrapolate === 'clamp')).toBe(true);
        expect(Math.min(...falls.map((c) => c.inputRange[0])) * CELEBRATION_MS).toBe(0);
        expect(Math.max(...falls.map((c) => c.inputRange[0])) * CELEBRATION_MS).toBeCloseTo(400);
        const fades = configs.filter((c) => c.outputRange.join(',') === '1,1,0');
        expect(fades).toHaveLength(80);
        expect(fades.every((c) => c.inputRange[1] * CELEBRATION_MS === 2000)).toBe(true);
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
