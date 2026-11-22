import { act } from 'react';
import { Pressable, Text, View } from 'react-native';
import { createRoot, type Root } from 'test-renderer';
import { ScenesPanel } from '../src/components/editor/tools/ScenesPanel';
import type { ComponentProps } from 'react';
void [Pressable, Text, View];
jest.mock('../src/components/ui/useReducedMotion', () => ({ useReducedMotion: () => true }));

let root: Root;
const onDetect = jest.fn(), onCancel = jest.fn(), onToggle = jest.fn(), onPreview = jest.fn(), onApply = jest.fn();
const base = { availability: 'available' as const, blocker: null, status: 'done' as const, progress: 1,
    rows: [{ frame: 30, time: 1, kind: 'hard' as const, ticked: true }, { frame: 75, time: 2.5, kind: 'possible' as const, ticked: false }], error: null,
    onDetect, onCancel, onToggle, onPreview, onApply };
async function render(props: Partial<ComponentProps<typeof ScenesPanel>> = {}) { await act(async () => root.render(<ScenesPanel {...base} {...props} />)); }
const control = (label: string) => root.container.queryAll(node => node.props.accessibilityLabel === label && typeof node.props.onClick === 'function')[0];
beforeEach(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; root = createRoot(); jest.clearAllMocks(); });
afterEach(async () => { await act(async () => root.unmount()); });

test('hard cuts start checked, possible dissolves stay explicit, and preview is a separate 44pt action', async () => {
    await render();
    const toggles = root.container.queryAll(node => node.props.accessibilityRole === 'checkbox');
    expect(toggles.map(node => node.props.accessibilityState.checked)).toEqual([true, false]);
    expect(toggles.map(node => node.props.accessibilityLabel)).toEqual(['Hard cut suggestion at 1.00s', 'Possible dissolve suggestion at 2.50s']);
    expect(toggles.every(node => node.parent?.props.accessible !== true)).toBe(true);
    expect(control('Preview 1.00s')).toBeDefined(); expect(control('Preview 2.50s')).toBeDefined();
    await act(async () => toggles[1].props.onClick({ nativeEvent: {}, currentTarget: 1, target: 1 }));
    await act(async () => control('Preview 2.50s').props.onClick({ nativeEvent: {}, currentTarget: 1, target: 1 }));
    expect(onToggle).toHaveBeenCalledWith(75); expect(onPreview).toHaveBeenCalledWith(75);
    expect(control('Split at 1 cuts')).toBeDefined();
});

test('progress is determinate and cancellable while unsupported devices remain discoverable', async () => {
    await render({ status: 'analyzing', progress: 0.42, rows: [] });
    const progress = root.container.queryAll(node => node.props.accessibilityRole === 'progressbar')[0];
    expect(progress.props.accessibilityValue).toMatchObject({ min: 0, max: 100, now: 42 });
    await act(async () => control('Cancel').props.onClick({ nativeEvent: {}, currentTarget: 1, target: 1 })); expect(onCancel).toHaveBeenCalled();
    await render({ availability: 'unsupported', status: 'idle', rows: [] });
    expect(root.container.queryAll(node => node.children.includes('Scene detection is not available on this device yet.'))).toHaveLength(1);
    expect(root.container.queryAll(node => node.props.accessibilityLabel === 'Detect scenes')[0].props.accessibilityState.disabled).toBe(true);
});
