import { act } from 'react';
import * as RN from 'react-native';
import { createRoot, type Root } from 'test-renderer';
import { BrandSplash, SLOT_HEIGHT, SLOT_WIDTH } from '../src/components/BrandSplash';
import { playLanding } from '../src/lib/haptics';

let mockReduced = false;
let intro: any = {};
let listeners: Record<string, (on: boolean) => void> = {};
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) }));
jest.mock('../src/lib/haptics', () => ({ playLanding: jest.fn(async () => {}) }));
jest.mock('../src/components/ui/useReducedMotion', () => ({ useReducedMotion: () => mockReduced }));
jest.mock('../src/components/BrandIntro', () => ({
    BrandIntro: (props: any) => { intro = props; return require('react').createElement('intro', props); },
}));
jest.mock('../src/components/VeyCharacter', () => ({ VeyCharacter: (props: any) => require('react').createElement('vey', props) }));
jest.mock('../src/components/BrandGlow', () => ({ BrandGlow: (props: any) => require('react').createElement('glow', props) }));
jest.mock('../src/components/ui', () => {
    const theme = require('../src/theme');
    return { themedStyles: (fn: Function) => fn(theme.tokensForScheme('dark'), theme.text, 'dark'), useThemedStyles: (s: object) => s };
});
// The slot is measured through this helper; the real one needs a native view.
jest.mock('../src/lib/splashLeap', () => ({
    ...jest.requireActual('../src/lib/splashLeap'),
    measureWindow: jest.fn(async () => ({ x: 70, y: 400, width: 220, height: 240 })),
}));
const { measureWindow } = jest.requireMock('../src/lib/splashLeap');

let root: Root;
const onFadeStart = jest.fn();
const onFinish = jest.fn();
const render = (element = <BrandSplash onFadeStart={onFadeStart} onFinish={onFinish} />) => act(async () => root.render(element));
const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });
const advance = (ms: number) => act(async () => { jest.advanceTimersByTime(ms); await Promise.resolve(); });
const kinds = (type: string) => root.container.queryAll((n) => n.type === type);

beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    jest.useFakeTimers();
    jest.clearAllMocks();
    mockReduced = false;
    intro = {};
    // Animations complete at once, so a fade or an arrival never waits on a frame clock.
    jest.spyOn(RN.Animated, 'timing').mockImplementation(() => ({ start: (done?: (r: { finished: boolean }) => void) => done?.({ finished: true }), stop: jest.fn(), reset: jest.fn() }) as any);
    jest.spyOn(RN.AccessibilityInfo, 'isScreenReaderEnabled').mockResolvedValue(false);
    listeners = {};
    jest.spyOn(RN.AccessibilityInfo, 'addEventListener').mockImplementation(((name: string, handler: (on: boolean) => void) => { listeners[name] = handler; return { remove: jest.fn() }; }) as any);
    root = createRoot();
});
afterEach(async () => {
    await act(async () => root.unmount());
    jest.useRealTimers();
    jest.restoreAllMocks();
});

test('a screen reader skips the page at once', async () => {
    (RN.AccessibilityInfo.isScreenReaderEnabled as jest.Mock).mockResolvedValue(true);
    await render();
    await flush();
    expect(onFadeStart).toHaveBeenCalledTimes(1);
    expect(onFinish).toHaveBeenCalledTimes(1);
});

test('a tap anywhere moves on once', async () => {
    await render();
    const tap = root.container.queryAll((n) => typeof n.props.onClick === 'function')[0];
    await act(async () => { tap.props.onClick({}); tap.props.onClick({}); });
    expect(onFadeStart).toHaveBeenCalledTimes(1);
    expect(onFinish).toHaveBeenCalledTimes(1);
});

test('the large Vey slot has a real size before Vey is in it', async () => {
    await render();
    const slot = root.container.queryAll((n) => n.props.collapsable === false && (RN.StyleSheet.flatten(n.props.style) as { width?: number })?.width !== undefined)[0];
    const style = RN.StyleSheet.flatten(slot.props.style) as { width: number; height: number };
    expect(style.width).toBe(SLOT_WIDTH);
    expect(style.height).toBe(SLOT_HEIGHT);
    expect(style.width).toBeGreaterThan(0);
    expect(kinds('vey')).toHaveLength(0);
});

test('a measured rest position produces a hop to the slot, not the fallback', async () => {
    await render();
    await act(async () => intro.onDone({ feetX: 300, feetY: 120 }));
    expect(intro.leap).toBeNull();
    await advance(500);
    await flush();
    expect(measureWindow).toHaveBeenCalledTimes(1);
    expect(intro.leap).toMatchObject({ dx: 70 + 110 - 300 });
    expect(kinds('vey')).toHaveLength(0);
});

test('the haptic fires once, at touchdown, and not when the hop is handed off', async () => {
    await render();
    await act(async () => intro.onDone({ feetX: 300, feetY: 120 }));
    await advance(500);
    await flush();
    await act(async () => intro.onLand());
    expect(playLanding).toHaveBeenCalledTimes(1);
    await act(async () => intro.onLeapDone());
    expect(playLanding).toHaveBeenCalledTimes(1);
    expect(kinds('vey')).toHaveLength(1);
    expect(kinds('glow')[0].props.shown).toBe(true);
});

test('when the position cannot be measured the large Vey just appears', async () => {
    await render();
    await act(async () => intro.onDone(null));
    expect(kinds('vey')).toHaveLength(1);
    expect(intro.leap).toBeNull();
    expect(playLanding).not.toHaveBeenCalled();
});

test('Reduce Motion shows the large Vey still, with no hop and no haptic', async () => {
    mockReduced = true;
    await render();
    await act(async () => intro.onDone({ feetX: 300, feetY: 120 }));
    expect(kinds('vey')).toHaveLength(1);
    await advance(600);
    expect(intro.leap).toBeNull();
    await act(async () => intro.onLand());
    expect(playLanding).not.toHaveBeenCalled();
});

test('Reduce Motion switched on during the pause cancels the hop', async () => {
    await render();
    await act(async () => intro.onDone({ feetX: 300, feetY: 120 }));
    mockReduced = true;
    await render(<BrandSplash onFadeStart={onFadeStart} onFinish={onFinish} />);
    expect(kinds('vey')).toHaveLength(1);
    await advance(600);
    await flush();
    expect(intro.leap).toBeNull();
    expect(measureWindow).not.toHaveBeenCalled();
    await act(async () => intro.onLand());
    expect(playLanding).not.toHaveBeenCalled();
});

test('Reduce Motion switched on during the hop settles and silences the haptic', async () => {
    await render();
    await act(async () => intro.onDone({ feetX: 300, feetY: 120 }));
    await advance(500);
    await flush();
    expect(intro.leap).not.toBeNull();
    mockReduced = true;
    await render(<BrandSplash onFadeStart={onFadeStart} onFinish={onFinish} />);
    expect(intro.leap).toBeNull();
    expect(kinds('vey')).toHaveLength(1);
    await act(async () => intro.onLand());
    expect(playLanding).not.toHaveBeenCalled();
});

test('the large Vey waves for a moment, then the page fades away on its own', async () => {
    await render();
    await act(async () => intro.onDone(null));
    expect(onFadeStart).not.toHaveBeenCalled();
    await advance(1500);
    expect(onFadeStart).toHaveBeenCalledTimes(1);
    expect(onFinish).toHaveBeenCalledTimes(1);
});

test('it moves on even if the animation never reports in', async () => {
    await render();
    await advance(9000);
    expect(onFinish).toHaveBeenCalledTimes(1);
});

test('a skip just before touchdown cancels the hop: no landing haptic and no arrival', async () => {
    await render();
    await act(async () => intro.onDone({ feetX: 300, feetY: 120 }));
    await advance(500);
    await flush();
    expect(intro.leap).not.toBeNull();
    const tap = root.container.queryAll((n) => typeof n.props.onClick === 'function')[0];
    await act(async () => tap.props.onClick({}));
    expect(intro.leap).toBeNull();
    await act(async () => intro.onLand());
    await act(async () => intro.onLeapDone());
    expect(playLanding).not.toHaveBeenCalled();
    expect(kinds('vey')).toHaveLength(0);
});

test('a screen reader switched on while the page plays ends it at once', async () => {
    await render();
    await act(async () => intro.onDone(null));
    expect(onFinish).not.toHaveBeenCalled();
    await act(async () => listeners.screenReaderChanged(true));
    expect(onFadeStart).toHaveBeenCalledTimes(1);
    expect(onFinish).toHaveBeenCalledTimes(1);
});

test('a screen reader switched on during the hop cancels it: no landing feedback, no arrival', async () => {
    await render();
    await act(async () => intro.onDone({ feetX: 300, feetY: 120 }));
    await advance(500);
    await flush();
    expect(intro.leap).not.toBeNull();
    await act(async () => listeners.screenReaderChanged(true));
    expect(intro.leap).toBeNull();
    expect(onFinish).toHaveBeenCalledTimes(1);
    await act(async () => intro.onLand());
    await act(async () => intro.onLeapDone());
    expect(playLanding).not.toHaveBeenCalled();
    expect(kinds('vey')).toHaveLength(0);
});

test('turning a screen reader off does nothing', async () => {
    await render();
    await act(async () => listeners.screenReaderChanged(false));
    expect(onFinish).not.toHaveBeenCalled();
});
