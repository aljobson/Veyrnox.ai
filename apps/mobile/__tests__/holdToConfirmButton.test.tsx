import { act } from 'react';
import { createRoot, type Root } from 'test-renderer';
import { HOLD_MS, HoldToConfirmButton } from '../src/components/HoldToConfirmButton';

jest.mock('../src/lib/haptics', () => ({ playSuccess: jest.fn(async () => {}) }));

const touch = { nativeEvent: { timestamp: 0, pageX: 10, pageY: 10, locationX: 10, locationY: 10, touches: [], changedTouches: [], identifier: 1, target: 1 },
    currentTarget: 1, target: 1, persist: () => {} };
let root: Root;
const onConfirm = jest.fn();
const onTap = jest.fn();
const onAccessibilityActivate = jest.fn();

async function mount(disabled = false) {
    await act(async () => root.render(<HoldToConfirmButton label="Hold to delete" hint="Press and hold" disabled={disabled}
        onConfirm={onConfirm} onTap={onTap} onAccessibilityActivate={onAccessibilityActivate} />));
    return root.container.queryAll(node => node.props.testID === 'hold-to-confirm')[0];
}

beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    jest.useFakeTimers();
    onConfirm.mockReset(); onTap.mockReset(); onAccessibilityActivate.mockReset();
    root = createRoot();
});
afterEach(async () => { await act(async () => root.unmount()); jest.useRealTimers(); });

test('holding for the full time confirms once', async () => {
    const button = await mount();
    await act(async () => { button.props.onResponderGrant(touch); });
    await act(async () => { jest.advanceTimersByTime(HOLD_MS + 50); });
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onTap).not.toHaveBeenCalled();
});

test('letting go early does nothing, and a quick tap explains how to use it', async () => {
    const button = await mount();
    await act(async () => { button.props.onResponderGrant(touch); });
    await act(async () => { jest.advanceTimersByTime(100); button.props.onResponderRelease(touch); });
    await act(async () => { jest.advanceTimersByTime(HOLD_MS * 2); });
    expect(onConfirm).not.toHaveBeenCalled();
    expect(onTap).toHaveBeenCalledTimes(1);
});

test('releasing partway through a hold cancels without the tap hint', async () => {
    const button = await mount();
    await act(async () => { button.props.onResponderGrant(touch); });
    await act(async () => { jest.advanceTimersByTime(HOLD_MS / 2); button.props.onResponderRelease(touch); });
    await act(async () => { jest.advanceTimersByTime(HOLD_MS * 2); });
    expect(onConfirm).not.toHaveBeenCalled();
    expect(onTap).not.toHaveBeenCalled();
});

test('screen readers get a button with a hint, and "activate" takes the confirmation path', async () => {
    const button = await mount();
    expect(button.props).toMatchObject({ accessibilityRole: 'button', accessibilityLabel: 'Hold to delete', accessibilityHint: 'Press and hold' });
    await act(async () => { button.props.onAccessibilityAction({ nativeEvent: { actionName: 'activate' } }); });
    expect(onAccessibilityActivate).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
});

test('a disabled button never confirms', async () => {
    const button = await mount(true);
    await act(async () => { button.props.onResponderGrant?.(touch); button.props.onAccessibilityAction({ nativeEvent: { actionName: 'activate' } }); });
    await act(async () => { jest.advanceTimersByTime(HOLD_MS * 2); });
    expect(onConfirm).not.toHaveBeenCalled();
    expect(onAccessibilityActivate).not.toHaveBeenCalled();
});
