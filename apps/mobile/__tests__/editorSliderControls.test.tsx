import { act } from 'react';
import { createRoot, type Root } from 'test-renderer';
import { AccessibilityInfo, PanResponder, TextInput } from 'react-native';
import { Slider } from '../src/components/editor/tools/Slider';
import { ColourField } from '../src/components/editor/tools/ColourField';
import { sliderValue, stepValue } from '../src/components/editor/tools/sliderMath';
void TextInput;
test('slider clamps, rounds without drift and snaps only within distance', () => {
    expect(sliderValue(-20, 100, 0, 8, .1)).toBe(0);
    expect(sliderValue(200, 100, 0, 8, .1)).toBe(8);
    expect(sliderValue(30, 100, 0, 1, .1)).toBe(.3);
    expect(sliderValue(11, 100, 0, 10, .1, [1])).toBe(1.1);
    expect(sliderValue(10.4, 100, 0, 10, .1, [1])).toBe(1);
    expect(sliderValue(31, 100, 0, 100, 1, [30])).toBe(31);
    expect(sliderValue(1, 1, 0, 1, 1, [.5])).toBe(1);
    expect(sliderValue(30, 100, 0, 1, .1, [.25])).toBe(.3);
    expect(sliderValue(12, 100, 0, 10, .1, [1])).toBe(1.2);
    expect(stepValue(.2, 1, .1, 8, .1)).toBe(.3);
    expect(stepValue(8, 1, .1, 8, .1)).toBe(8);
});
let root: Root;
beforeEach(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; root = createRoot(); });
afterEach(async () => { await act(async () => root.unmount()); });
test('adjustable announces value and commits one accessible step, respecting disabled and bounds', async () => {
    const onChange = jest.fn();
    for (const [value, disabled, expected] of [[1, false, 1.1], [8, false, null], [1, true, null]] as const) {
        onChange.mockClear();
        await act(async () => root.render(<Slider label="Speed" value={value} min={.1} max={8} step={.1}
            format={v => `${v}×`} disabled={disabled} onChange={onChange} />));
        const node = root.container.queryAll(n => n.props.accessibilityRole === 'adjustable')[0];
        expect(node.props.accessible).toBe(true);
        expect(node.props.accessibilityLabel).toBe('Speed');
        expect(node.props.accessibilityValue).toEqual({ min: .1, max: 8, now: value, text: `${value}×` });
        expect(node.props.accessibilityActions).toEqual([{ name: 'increment' }, { name: 'decrement' }]);
        await act(async () => node.props.onAccessibilityAction({ nativeEvent: { actionName: 'increment' } }));
        if (expected === null) expect(onChange).not.toHaveBeenCalled();
        else { expect(onChange).toHaveBeenCalledTimes(1); expect(onChange).toHaveBeenCalledWith(expected); }
    }
});
test('colour commits only valid end edits and swatch presses', async () => {
    const onChange = jest.fn();
    await act(async () => root.render(<ColourField label="Canvas colour" value="#000000" swatches={['#ffffff']} onChange={onChange} />));
    for (const value of ['#12345', 'red', '#1a2b3c']) {
        onChange.mockClear();
        const input = root.container.queryAll(n => typeof n.props.onEndEditing === 'function')[0];
        await act(async () => input.props.onChangeText(value));
        expect(onChange).not.toHaveBeenCalled();
        await act(async () => input.props.onEndEditing({ nativeEvent: { text: value } }));
        if (value === '#1a2b3c') { expect(onChange).toHaveBeenCalledTimes(1); expect(onChange).toHaveBeenCalledWith(value); }
        else {
            expect(onChange).not.toHaveBeenCalled();
            expect(root.container.queryAll(n => n.props.children === 'Use a colour like #1a2b3c.').length).toBeGreaterThan(0);
        }
    }
    const swatch = root.container.queryAll(n => n.props.accessibilityLabel === 'Colour #ffffff' && typeof n.props.onClick === 'function')[0];
    await act(async () => swatch.props.onClick({ nativeEvent: {}, currentTarget: 1, target: 1 }));
    expect(onChange).toHaveBeenLastCalledWith('#ffffff');
});

test('horizontal colour palette deduplicates choices and commits a complete valid hex while typing', async () => {
    const onChange = jest.fn(), onOpenPicker = jest.fn().mockResolvedValue('#34C759');
    await act(async () => root.render(<ColourField label="Text Color" value="#000000"
        swatches={['#000000', '#000000', '#AF52DE']} presentation="horizontal" commitValidOnChange onChange={onChange} onOpenPicker={onOpenPicker} />));
    expect(root.container.queryAll(n => n.props.accessibilityRole === 'button')).toHaveLength(3);
    const selected = root.container.queryAll(n => n.props.accessibilityLabel === 'Colour #000000')[0];
    expect(selected.props.accessibilityState).toEqual({ selected: true });
    const input = root.container.queryAll(n => n.props.accessibilityLabel === 'Text Color hex colour')[0];
    await act(async () => input.props.onChangeText('#12ab34'));
    expect(onChange).toHaveBeenLastCalledWith('#12AB34');
    onChange.mockClear();
    const finalSwatch = root.container.queryAll(n => n.props.accessibilityLabel === 'Colour #AF52DE')[0];
    await act(async () => finalSwatch.props.onClick({ nativeEvent: {}, currentTarget: 1, target: 1 }));
    expect(onChange).toHaveBeenCalledWith('#AF52DE');
    onChange.mockClear();
    const picker = root.container.queryAll(n => n.props.accessibilityLabel === 'Open Text Color picker')[0];
    await act(async () => picker.props.onClick({ nativeEvent: {}, currentTarget: 1, target: 1 }));
    expect(onOpenPicker).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('#34C759');
});

test('horizontal drag keeps a live value, refuses termination and commits once on release', async () => {
    const { PanResponder } = require('react-native');
    const spy = jest.spyOn(PanResponder, 'create');
    const onChange = jest.fn();
    try {
        await act(async () => root.render(<Slider label="Speed" value={1} min={0} max={8} step={.1} format={v => `${v}×`} onChange={onChange} />));
        const callbacks = spy.mock.calls[0][0] as any;
        const node = root.container.queryAll(n => n.props.accessibilityRole === 'adjustable')[0];
        await act(async () => node.props.onLayout({ nativeEvent: { layout: { width: 100 } } }));
        expect(callbacks.onMoveShouldSetPanResponder({}, { dx: 2, dy: 10 })).toBe(false);
        expect(callbacks.onMoveShouldSetPanResponder({}, { dx: 10, dy: 2 })).toBe(true);
        await act(async () => callbacks.onPanResponderGrant({ nativeEvent: { locationX: 20 } }, { dx: 0 }));
        expect(callbacks.onPanResponderTerminationRequest()).toBe(false);
        await act(async () => callbacks.onPanResponderMove({}, { dx: 30 }));
        expect(root.container.queryAll(n => n.props.accessibilityRole === 'adjustable')[0].props.accessibilityValue.now).toBe(4);
        expect(onChange).not.toHaveBeenCalled();
        await act(async () => callbacks.onPanResponderRelease());
        expect(onChange).toHaveBeenCalledTimes(1); expect(onChange).toHaveBeenCalledWith(4);
        await act(async () => callbacks.onPanResponderRelease()); expect(onChange).toHaveBeenCalledTimes(1);
    } finally { spy.mockRestore(); }
});

test.each([[-10, -1], [400, 1]] as const)('out-of-range value %s never steps in the opposite direction', (value, dir) => {
    expect((stepValue(value, dir, 1, 300, 1) - value) * dir).toBeGreaterThanOrEqual(0);
});
test.each([[400, -1], [-10, 1]] as const)('out-of-range value %s can step back toward the range', (value, dir) => {
    expect(stepValue(value, dir, 1, 300, 1)).toBe(value + dir);
});
test.each([[400, 10], [-10, -10]] as const)('out-of-range value %s never drags in the opposite direction', async (value, dx) => {
    const { PanResponder } = require('react-native');
    const spy = jest.spyOn(PanResponder, 'create'), onChange = jest.fn();
    try {
        await act(async () => root.render(<Slider label="Length" value={value} min={1} max={300} step={1} format={String} onChange={onChange} />));
        const callbacks = spy.mock.calls[0][0] as any;
        const node = root.container.queryAll(n => n.props.accessibilityRole === 'adjustable')[0];
        await act(async () => node.props.onLayout({ nativeEvent: { layout: { width: 100 } } }));
        await act(async () => callbacks.onPanResponderGrant({ nativeEvent: { locationX: dx > 0 ? 100 : 0 } }, { dx }));
        await act(async () => callbacks.onPanResponderMove({}, { dx: dx * 2 }));
        await act(async () => callbacks.onPanResponderRelease());
        expect(node.props.accessibilityValue.now).toBe(value);
        expect(onChange).not.toHaveBeenCalled();
    } finally { spy.mockRestore(); }
});

test('dragging away and back to the controlled value releases without a change', async () => {
    const spy = jest.spyOn(PanResponder, 'create'), onChange = jest.fn();
    try {
        await act(async () => root.render(<Slider label="Speed" value={1} min={0} max={8} step={.1} format={String} onChange={onChange} />));
        const callbacks = spy.mock.calls[0][0] as any;
        const node = root.container.queryAll(n => n.props.accessibilityRole === 'adjustable')[0];
        await act(async () => node.props.onLayout({ nativeEvent: { layout: { width: 80 } } }));
        await act(async () => callbacks.onPanResponderGrant({ nativeEvent: { locationX: 10 } }, { dx: 0 }));
        await act(async () => callbacks.onPanResponderMove({}, { dx: 10 }));
        expect(node.props.accessibilityValue.now).toBe(2);
        await act(async () => callbacks.onPanResponderMove({}, { dx: 0 }));
        expect(node.props.accessibilityValue.now).toBe(1);
        await act(async () => callbacks.onPanResponderRelease());
        expect(onChange).not.toHaveBeenCalled();
    } finally { spy.mockRestore(); }
});

test.each([[1.1, .1, 1, 1.1], [1.04, .1, 1, 1], [31, 1, 30, 31], [.3, .1, .25, .3]])(
    'slider gesture at %s uses a strict half-step snap distance', async (position, step, snap, expected) => {
        const spy = jest.spyOn(PanResponder, 'create'), onChange = jest.fn();
        try {
            await act(async () => root.render(<Slider label="Value" value={0} min={0} max={100} step={step} snaps={[snap]}
                format={String} onChange={onChange} />));
            const callbacks = spy.mock.calls[0][0] as any;
            const node = root.container.queryAll(n => n.props.accessibilityRole === 'adjustable')[0];
            await act(async () => node.props.onLayout({ nativeEvent: { layout: { width: 100 } } }));
            await act(async () => callbacks.onPanResponderGrant({ nativeEvent: { locationX: position } }, { dx: 0 }));
            expect(node.props.accessibilityValue.now).toBe(expected);
            await act(async () => callbacks.onPanResponderMove({}, { dx: 0 }));
            expect(node.props.accessibilityValue.now).toBe(expected);
            await act(async () => callbacks.onPanResponderRelease());
            expect(onChange).toHaveBeenCalledTimes(1);
            expect(onChange).toHaveBeenCalledWith(expected);
        } finally { spy.mockRestore(); }
    },
);

test('colour error announces once on iOS and announces again after correction', async () => {
    const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => {}).mockClear();
    try {
        await act(async () => root.render(<ColourField label="Canvas colour" value="#000000" swatches={[]} onChange={jest.fn()} />));
        expect(announce).not.toHaveBeenCalled();
        const endEdit = async (text: string) => {
            const input = root.container.queryAll(n => typeof n.props.onEndEditing === 'function')[0];
            await act(async () => input.props.onEndEditing({ nativeEvent: { text } }));
        };
        await endEdit('red');
        expect(announce.mock.calls).toEqual([['Use a colour like #1a2b3c.']]);
        await endEdit('blue');
        expect(announce).toHaveBeenCalledTimes(1);
        await endEdit('#1a2b3c');
        await endEdit('red');
        expect(announce.mock.calls).toEqual([['Use a colour like #1a2b3c.'], ['Use a colour like #1a2b3c.']]);
    } finally { announce.mockRestore(); }
});

test.each([[2, 1], [1, 1]])('empty slider interval %s..%s blocks drag and accessibility edits', async (min, max) => {
    const { PanResponder } = require('react-native');
    const spy = jest.spyOn(PanResponder, 'create'), onChange = jest.fn();
    try {
        await act(async () => root.render(<Slider label="Position" value={1} min={min} max={max} step={.1} format={String} onChange={onChange} />));
        const callbacks = spy.mock.calls[0][0] as any;
        const node = root.container.queryAll(n => n.props.accessibilityRole === 'adjustable')[0];
        expect(node.props.accessibilityState.disabled).toBe(true);
        expect(callbacks.onMoveShouldSetPanResponder({}, { dx: 10, dy: 0 })).toBe(false);
        await act(async () => {
            node.props.onAccessibilityAction({ nativeEvent: { actionName: 'increment' } });
            callbacks.onPanResponderGrant({ nativeEvent: { locationX: 20 } }, { dx: 10 });
            callbacks.onPanResponderMove({}, { dx: 30 });
            callbacks.onPanResponderRelease();
        });
        expect(onChange).not.toHaveBeenCalled();
    } finally { spy.mockRestore(); }
});

test.each([[0, 'decrement'], [1, 'increment']] as const)('accessibility action at bound %s does not call onChange', async (value, actionName) => {
    const onChange = jest.fn();
    await act(async () => root.render(<Slider label="Bound" value={value} min={0} max={1} step={.1} format={String} onChange={onChange} />));
    const node = root.container.queryAll(n => n.props.accessibilityRole === 'adjustable')[0];
    await act(async () => node.props.onAccessibilityAction({ nativeEvent: { actionName } }));
    expect(onChange).not.toHaveBeenCalled();
});
