import { act } from 'react';
import * as RN from 'react-native';
import { createRoot, type Root } from 'test-renderer';
import { MascotWordmark } from '../src/components/MascotWordmark';
import { settleWordmark } from '../src/lib/wordmarkSettle';

jest.mock('expo-image', () => ({ Image: 'Image' }));
jest.mock('../src/components/VeyRunner', () => ({ VeyRunner: () => null }));
jest.mock('../src/lib/wordmarkSettle', () => ({ settleWordmark: jest.fn() }));
jest.mock('../src/lib/splashLeap', () => ({
    ...jest.requireActual('../src/lib/splashLeap'),
    measureWindow: jest.fn(async () => ({ x: 20, y: 60, width: 300, height: 80 })),
}));

let root: Root;
let reduceListener: (on: boolean) => void = () => {};
let reduceNow = false;
let timings: { config: any; stop: jest.Mock; start: jest.Mock; reset: jest.Mock; _isUsingNativeDriver: () => boolean }[] = [];
const onDone = jest.fn();
const onLand = jest.fn();
const onLeapDone = jest.fn();
const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });

// Every letter reports a layout so the path exists and the run starts.
async function layOut() {
    const letters = root.container.queryAll((n) => typeof n.props.onLayout === 'function');
    await act(async () => letters.forEach((n, i) => n.props.onLayout({ nativeEvent: { layout: { x: i * 30, width: 28 } } })));
}

beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    jest.clearAllMocks();
    reduceNow = false;
    timings = [];
    jest.spyOn(RN.AccessibilityInfo, 'isReduceMotionEnabled').mockImplementation(async () => reduceNow);
    jest.spyOn(RN.AccessibilityInfo, 'addEventListener').mockImplementation(((_: string, handler: (on: boolean) => void) => { reduceListener = handler; return { remove: jest.fn() }; }) as any);
    // Nothing completes by itself, so each test decides which moment it interrupts.
    jest.spyOn(RN.Animated, 'timing').mockImplementation(((_: unknown, config: any) => {
        const entry = { config, stop: jest.fn(), start: jest.fn(), reset: jest.fn(), _isUsingNativeDriver: () => false };
        timings.push(entry);
        return entry as any;
    }) as any);
    root = createRoot();
});
afterEach(async () => {
    await act(async () => root.unmount());
    jest.restoreAllMocks();
});

test('Reduce Motion switched on during the run reports once with no rest position and settles the values', async () => {
    await act(async () => root.render(<MascotWordmark onDone={onDone} onLand={onLand} onLeapDone={onLeapDone} />));
    await flush();
    await layOut();
    await flush();
    expect(timings.some((t) => t.config.toValue === 1)).toBe(true); // the run is under way
    expect(onDone).not.toHaveBeenCalled();
    await act(async () => reduceListener(true));
    await flush();
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(onDone).toHaveBeenCalledWith(null);
    expect(settleWordmark).toHaveBeenCalled();
    expect(onLand).not.toHaveBeenCalled();
    expect(onLeapDone).not.toHaveBeenCalled();
});

test('Reduce Motion switched on during the hop stops the flight and settles the values', async () => {
    const leap = { dx: -120, dy: 260, scale: 9 };
    await act(async () => root.render(<MascotWordmark leap={leap} onDone={onDone} onLand={onLand} onLeapDone={onLeapDone} />));
    await flush();
    await layOut();
    await flush();
    const flight = timings.filter((t) => t.config.toValue === leap.scale || t.config.toValue === leap.dx);
    expect(flight.length).toBeGreaterThan(0); // the hop is under way
    await act(async () => reduceListener(true));
    await flush();
    flight.forEach((t) => expect(t.stop).toHaveBeenCalled());
    expect(settleWordmark).toHaveBeenCalled();
    expect(onLand).not.toHaveBeenCalled();
    expect(onLeapDone).not.toHaveBeenCalled();
});

test('with Reduce Motion already on there is no run and no hop', async () => {
    reduceNow = true;
    await act(async () => root.render(<MascotWordmark leap={{ dx: 1, dy: 2, scale: 3 }} onDone={onDone} onLand={onLand} onLeapDone={onLeapDone} />));
    await flush();
    await layOut();
    await flush();
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(onDone).toHaveBeenCalledWith(null);
    expect(timings.some((t) => t.config.toValue === 3)).toBe(false);
});
