import { act } from 'react';
import { createRoot, type Root } from 'test-renderer';
import { TextInput } from 'react-native';
import { Slider } from '../src/components/editor/tools/Slider';
import { ColourField } from '../src/components/editor/tools/ColourField';
import { sliderValue, stepValue } from '../src/components/editor/tools/sliderMath';
void TextInput;
test('slider clamps, rounds without drift and snaps only within distance', () => {
    expect(sliderValue(-20, 100, 0, 8, .1)).toBe(0);
    expect(sliderValue(200, 100, 0, 8, .1)).toBe(8);
    expect(sliderValue(30, 100, 0, 1, .1)).toBe(.3);
    expect(sliderValue(11, 100, 0, 10, .1, [1])).toBe(1);
    expect(sliderValue(12, 100, 0, 10, .1, [1])).toBe(1.2);
    expect(stepValue(.2, 1, .1, 8, .1)).toBe(.3);
    expect(stepValue(8, 1, .1, 8, .1)).toBe(8);
});
let root: Root;
beforeEach(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; root = createRoot(); });
afterEach(async () => { await act(async () => root.unmount()); });
test('adjustable announces value and commits one accessible step, respecting disabled and bounds', async () => {
    const onChange = jest.fn();
    for (const [value, disabled, expected] of [[1, false, 1.1], [8, false, 8], [1, true, null]] as const) {
        onChange.mockClear();
        await act(async () => root.render(<Slider label="Speed" value={value} min={.1} max={8} step={.1}
            format={v => `${v}×`} disabled={disabled} onChange={onChange} />));
        const node = root.container.queryAll(n => n.props.accessibilityRole === 'adjustable')[0];
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
