import { act, type ReactElement } from 'react';
import { createRoot, type Root, type TestInstance } from 'test-renderer';
import { AccessibilityInfo, Animated, StyleSheet } from 'react-native';
import { VeyCharacter } from '../src/components/VeyCharacter';
import { VeyLoader } from '../src/components/VeyLoader';
import { EmptyState } from '../src/components/EmptyState';
import Welcome from '../src/app/(app)/welcome';
import Vibe from '../src/app/(app)/vibe';
import Rate from '../src/app/(app)/rate';
import { playSelection } from '../src/lib/haptics';
import { t } from '../src/lib/i18n';

jest.mock('../src/lib/haptics', () => ({ playSelection: jest.fn() }));
const mockApi = { getBalance: jest.fn(async () => ({ free_credits: 10 })) };
jest.mock('../src/auth/AuthProvider', () => ({ useAuth: () => ({ api: mockApi, generation: 0 }) }));
jest.mock('expo-router', () => ({ Stack: { Screen: () => null }, Link: ({ children }: any) => children, useRouter: () => ({}), useLocalSearchParams: () => ({}) }));
jest.mock('../src/lib/analytics/events', () => ({ captureEvent: jest.fn() }));
jest.mock('../src/lib/storeReview', () => ({ markReviewAsked: jest.fn(), openRatingSheet: jest.fn() }));
jest.mock('../src/lib/creatorProfileStore', () => ({ loadVibe: async () => null }));
jest.mock('../src/lib/languageStore', () => ({ loadLanguage: async () => 'en', readLanguage: () => 'en' }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));

type Animation = Animated.CompositeAnimation & { kind: string; children: Animation[]; done?: (result: { finished: boolean }) => void; value?: Animated.Value; config?: any };
let root: Root, started: Animation[], onReact: jest.Mock;
function animation(kind: string, children: Animation[] = [], value?: Animated.Value, config?: any): Animation {
    const result: Animation = { kind, children, value, config, start: jest.fn(callback => { result.done = callback; started.push(result); }), stop: jest.fn(), reset: jest.fn() };
    return result;
}
const flatten = (a: Animation): Animation[] => [a, ...a.children.flatMap(flatten)];
const button = () => root.container.queryAll(n => n.props.accessibilityRole === 'button' && n.props.accessibilityLabel === 'Vey')[0];
const event = () => ({ nativeEvent: { pageX: 0, pageY: 0, locationX: 0, locationY: 0, timestamp: Date.now(), touches: [{}] }, currentTarget: 1, target: 1, persist: jest.fn(), stopPropagation: jest.fn() });
const tap = async () => { await act(async () => button().props.onClick(event())); };
async function render(element: ReactElement = <VeyCharacter interactive onReact={onReact} />) { await act(async () => root.render(element)); }
function reachable(node: TestInstance) {
    for (let ancestor = node.parent; ancestor; ancestor = ancestor.parent) {
        expect(ancestor.props.accessibilityElementsHidden).not.toBe(true);
        expect(ancestor.props.importantForAccessibility).not.toBe('no-hide-descendants');
        expect(ancestor.props.accessible).not.toBe(true);
    }
}
beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    jest.useFakeTimers(); started = []; onReact = jest.fn(); root = createRoot();
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(false);
    jest.spyOn(AccessibilityInfo, 'addEventListener').mockReturnValue({ remove: jest.fn() });
    jest.spyOn(Animated, 'timing').mockImplementation((v, config) => animation('timing', [], v as Animated.Value, config));
    jest.spyOn(Animated, 'spring').mockImplementation((v, config) => animation('spring', [], v as Animated.Value, config));
    jest.spyOn(Animated, 'sequence').mockImplementation(children => animation('sequence', children as Animation[]));
    jest.spyOn(Animated, 'parallel').mockImplementation(children => animation('parallel', children as Animation[]));
    jest.spyOn(Animated, 'loop').mockImplementation(child => animation('loop', [child as Animation]));
    jest.spyOn(Animated, 'delay').mockImplementation(() => animation('delay'));
    jest.mocked(playSelection).mockClear();
});
afterEach(async () => { await act(async () => root.unmount()); jest.restoreAllMocks(); jest.useRealTimers(); });

test('button has label, hint, Wave action and hidden art, with a 44pt minimum target', async () => {
    await render(<VeyCharacter interactive width={20} />);
    expect(button().props.accessibilityHint).toBe(t('vey.touch.hint'));
    expect(button().props.accessibilityActions).toEqual([{ name: 'wave', label: t('vey.touch.wave') }]);
    const size = StyleSheet.flatten(button().props.style);
    const slop = button().props.hitSlop;
    expect(size.width + slop.left + slop.right).toBe(44);
    expect(size.height + slop.top + slop.bottom).toBe(44);
    expect(StyleSheet.flatten(button().parent!.props.style)).toMatchObject({ minWidth: 44, minHeight: 44 });
    const art = button().queryAll(n => n.props.pointerEvents === 'none')[0];
    expect(art.props).toMatchObject({ accessibilityElementsHidden: true, importantForAccessibility: 'no-hide-descendants' });
    reachable(button());
});
test('default Vey remains decorative and ignores touches', async () => {
    await render(<VeyCharacter />);
    expect(button()).toBeUndefined();
    expect(root.container.queryAll(n => n.props.pointerEvents === 'none')).toHaveLength(1);
});
test('tap and VoiceOver activation give one haptic and callback each', async () => {
    await render(); await tap();
    expect(playSelection).toHaveBeenCalledTimes(1); expect(onReact).toHaveBeenLastCalledWith('tap');
    await act(async () => button().props.onAccessibilityAction({ nativeEvent: { actionName: 'activate' } }));
    expect(playSelection).toHaveBeenCalledTimes(2); expect(onReact).toHaveBeenLastCalledWith('tap');
});
test('long press starts at 400ms, does not also tap on release, and Wave invokes hold', async () => {
    await render();
    await act(async () => button().props.onResponderGrant(event()));
    await act(async () => jest.advanceTimersByTime(399)); expect(onReact).not.toHaveBeenCalled();
    await act(async () => jest.advanceTimersByTime(1));
    expect(onReact).toHaveBeenCalledWith('hold'); expect(playSelection).toHaveBeenCalledTimes(1);
    await act(async () => button().props.onResponderRelease(event())); expect(onReact).toHaveBeenCalledTimes(1);
    await act(async () => button().props.onAccessibilityAction({ nativeEvent: { actionName: 'wave' } }));
    expect(onReact).toHaveBeenLastCalledWith('hold'); expect(playSelection).toHaveBeenCalledTimes(2);
    await tap(); expect(onReact).toHaveBeenLastCalledWith('tap'); expect(playSelection).toHaveBeenCalledTimes(3);
});
test('rapid taps queue just one extra reaction, then return to working', async () => {
    await render(<VeyCharacter interactive mood="working" onReact={onReact} />); started = [];
    await tap(); await tap(); await tap(); expect(started).toHaveLength(1);
    await act(async () => started[0].done?.({ finished: true })); expect(started).toHaveLength(2);
    await act(async () => started[1].done?.({ finished: true }));
    expect(started.slice(2).filter(a => a.kind === 'loop')).toHaveLength(3);
    expect(started.slice(2).flatMap(flatten).some(a => a.config?.duration === 220)).toBe(false);
});
test('five taps in three seconds earn exactly one 360-degree giggle in the pending slot', async () => {
    await render(); started = [];
    for (let i = 0; i < 7; i++) await tap();
    expect(started).toHaveLength(1);
    await act(async () => started[0].done?.({ finished: true }));
    expect(started[1]).toMatchObject({ kind: 'timing', config: { toValue: 1, duration: 720, useNativeDriver: true } });
    await act(async () => started[1].done?.({ finished: true }));
    expect(started.filter(a => a.config?.duration === 720)).toHaveLength(1);
});
test('old taps expire before the giggle threshold', async () => {
    await render(); started = [];
    for (let i = 0; i < 4; i++) await tap();
    jest.setSystemTime(Date.now() + 3001); await tap();
    await act(async () => started[0].done?.({ finished: true }));
    expect(started[1].kind).toBe('parallel');
});
test.each(['working', 'wave'] as const)('Reduce Motion keeps %s and all reactions still with haptics', async mood => {
    jest.mocked(AccessibilityInfo.isReduceMotionEnabled).mockResolvedValue(true);
    await render(<VeyCharacter interactive mood={mood} onReact={onReact} />); await tap();
    await act(async () => button().props.onAccessibilityAction({ nativeEvent: { actionName: 'wave' } }));
    expect(playSelection).toHaveBeenCalledTimes(2); expect(onReact).toHaveBeenCalledWith('tap');
    expect(Animated.timing).not.toHaveBeenCalled(); expect(Animated.sequence).not.toHaveBeenCalled(); expect(started).toHaveLength(0);
});
test('mood change cancels the reaction, drops its queue and resets every value', async () => {
    const set = jest.spyOn(Animated.Value.prototype, 'setValue');
    await render(); const defaults = new Map<Animated.Value, number>();
    set.mock.contexts.forEach((v, i) => defaults.set(v, set.mock.calls[i][0]));
    await tap(); await tap(); const reaction = started.at(-1)!;
    await act(async () => { for (const value of defaults.keys()) value.setValue(0.37); });
    await render(<VeyCharacter interactive mood="working" onReact={onReact} />);
    expect(reaction.stop).toHaveBeenCalled();
    for (const [value, initial] of defaults) expect((value as any).__getValue()).toBe(initial);
    const count = started.length; await act(async () => reaction.done?.({ finished: true })); expect(started).toHaveLength(count);
});
test('wave mood completes once and proceeds to idle', async () => {
    await render(<VeyCharacter mood="wave" />);
    expect(started).toHaveLength(1);
    expect(flatten(started[0]).filter(a => a.config?.duration === 180)).toHaveLength(7);
    await act(async () => started[0].done?.({ finished: true }));
    expect(started.slice(1).some(a => a.kind === 'loop')).toBe(true);
    expect(started.slice(1).flatMap(flatten).filter(a => a.config?.duration === 180)).toHaveLength(0);
});

// Real PanResponder handlers consume React Native's touch history, including capture before bubble.
function moveEvent(x: number, y: number, time: number, previousX = 0, previousY = 0) {
    return { ...event(), touchHistory: { numberActiveTouches: 1, indexOfSingleActiveTouch: 0, mostRecentTimeStamp: time, touchBank: [{
        touchActive: true, startPageX: 0, startPageY: 0, startTimeStamp: 0,
        currentPageX: x, currentPageY: y, currentTimeStamp: time,
        previousPageX: previousX, previousPageY: previousY, previousTimeStamp: time - 1,
    }] } };
}
test.each(['onResponderRelease', 'onResponderTerminate'])('horizontal drag cancels the inner press and %s springs only the eyes back', async release => {
    await render(<VeyCharacter interactive width={160} onReact={onReact} />);
    const outer = button().parent!; const start = moveEvent(0, 0, 1);
    expect(outer.props.onStartShouldSetResponder(start)).toBe(false);
    await act(async () => { outer.props.onStartShouldSetResponderCapture(start); button().props.onResponderGrant(start); });
    const vertical = moveEvent(9, 30, 2);
    outer.props.onMoveShouldSetResponderCapture(vertical); expect(outer.props.onMoveShouldSetResponder(vertical)).toBe(false);
    // A fresh horizontal gesture; the vertical gesture above belongs to the parent scroll view.
    await act(async () => { button().props.onResponderTerminate(vertical); outer.props.onStartShouldSetResponderCapture(start); button().props.onResponderGrant(start); });
    const horizontal = moveEvent(20, 1, 3);
    outer.props.onMoveShouldSetResponderCapture(horizontal); expect(outer.props.onMoveShouldSetResponder(horizontal)).toBe(true);
    await act(async () => { button().props.onResponderTerminate(horizontal); outer.props.onResponderGrant(horizontal); });
    const set = jest.spyOn(Animated.Value.prototype, 'setValue');
    await act(async () => outer.props.onResponderMove(moveEvent(40, 3, 4, 20, 1)));
    expect(set).toHaveBeenCalledTimes(2);
    expect(Math.hypot(...set.mock.calls.map(c => c[0]))).toBeCloseTo(6);
    expect(outer.props.onResponderTerminationRequest(horizontal)).toBe(true);
    await act(async () => { jest.advanceTimersByTime(600); outer.props[release](horizontal); });
    expect(onReact).not.toHaveBeenCalled(); expect(playSelection).not.toHaveBeenCalled();
    expect(Animated.spring).toHaveBeenCalledTimes(2);
    for (const [, config] of jest.mocked(Animated.spring).mock.calls) expect(config).toMatchObject({ toValue: 0, useNativeDriver: true });
    expect(started.at(-1)?.kind).toBe('parallel');
    await tap(); expect(onReact).toHaveBeenCalledWith('tap'); expect(playSelection).toHaveBeenCalledTimes(1);
});
test('Reduce Motion suppresses eye drag and its return spring', async () => {
    jest.mocked(AccessibilityInfo.isReduceMotionEnabled).mockResolvedValue(true); await render();
    const outer = button().parent!;
    await act(async () => { outer.props.onResponderGrant(moveEvent(0, 0, 1)); outer.props.onResponderMove(moveEvent(50, 0, 2)); outer.props.onResponderRelease(moveEvent(50, 0, 3)); });
    expect(Animated.spring).not.toHaveBeenCalled(); expect(started).toHaveLength(0);
});
test('loader keeps its loading label on a status sibling before the reachable working Vey', async () => {
    await render(<VeyLoader />);
    const status = root.container.queryAll(n => n.props.accessibilityRole === 'progressbar')[0];
    expect(status.props).toMatchObject({ accessibilityLabel: t('common.loading'), accessibilityState: { busy: true } });
    expect(status.parent).toBe(button().parent!.parent);
    expect(status.parent!.children.indexOf(status)).toBeLessThan(status.parent!.children.indexOf(button().parent!));
    reachable(button());
    expect(started.flatMap(flatten).some(a => a.config?.duration === 440)).toBe(true);
});
test('empty state greets with an interactive one-shot wave', async () => {
    await render(<EmptyState title="Nothing yet" />); reachable(button());
    expect(started).toHaveLength(1); expect(flatten(started[0]).filter(a => a.config?.duration === 180)).toHaveLength(7);
});
test.each([['welcome', Welcome], ['vibe', Vibe], ['rate', Rate]] as const)('%s exposes Vey and its Wave action without hidden ancestors', async (_, Screen) => {
    await render(<Screen />); expect(button()).toBeDefined(); reachable(button());
    expect(button().props.accessibilityActions).toContainEqual({ name: 'wave', label: t('vey.touch.wave') });
});
test('last welcome card also exposes its Vey button', async () => {
    await render(<Welcome />);
    for (let i = 0; i < 2; i++) await act(async () => root.container.queryAll(n => n.props.accessibilityLabel === t('welcome.next') && n.props.onClick)[0].props.onClick(event()));
    expect(button()).toBeDefined(); reachable(button());
    expect(button().props.accessibilityActions).toContainEqual({ name: 'wave', label: t('vey.touch.wave') });
});


test('working alternates the arms vertically while keeping the body at rest', async () => {
    await render(<VeyCharacter width={160} mood="working" />);
    const busy = started.flatMap(flatten).find(a => a.config?.duration === 360)!.value!;
    const layer = (origin: string) => root.container.queryAll(n => StyleSheet.flatten(n.props.style)?.transformOrigin === origin)[0];
    const y = (origin: string) => StyleSheet.flatten(layer(origin).props.style).transform.find((entry: any) => 'translateY' in entry).translateY;
    const beforeLeft = y('51px 98px'), beforeRight = y('108px 67px');
    await act(async () => busy.setValue(1));
    expect(y('51px 98px') - beforeLeft).toBe(2);
    expect(y('108px 67px') - beforeRight).toBe(-2);
});
