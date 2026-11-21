import { act } from 'react';
import { createRoot } from 'test-renderer';
import { PanResponder } from 'react-native';
import { CurveEditor } from '../src/components/editor/tools/CurveEditor';
import { colourDefaults, colourProblem } from '../../../app/veyrnox/_lib/editorColour.mjs';
import { movePoint } from '../src/lib/editorCurvePoints';
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
test('curve hit testing, drag commits once, endpoints and accessible alternatives', async () => {
    const spy = jest.spyOn(PanResponder, 'create'), root = createRoot(), onChange = jest.fn();
    const points = [{ x: 0, y: 0 }, { x: .5, y: .5 }, { x: 1, y: 1 }];
    await act(async () => root.render(<CurveEditor points={points} channelLabel="Master" onChange={onChange} />));
    const plot = root.container.queryAll(n => n.props.accessibilityRole === 'image')[0];
    await act(async () => plot.props.onLayout({ nativeEvent: { layout: { width: 200 } } }));
    const responder = spy.mock.calls[0][0] as any;
    const event = (x: number, y: number) => ({ nativeEvent: { locationX: x, locationY: y } });
    expect(responder.onStartShouldSetPanResponder(event(20, 20))).toBe(false);
    expect(responder.onStartShouldSetPanResponder(event(100, 100))).toBe(true);
    await act(async () => { responder.onPanResponderGrant(event(100, 100)); responder.onPanResponderMove(event(120, 80), { dx: 20, dy: -20 }); });
    expect(onChange).not.toHaveBeenCalled(); expect(responder.onPanResponderTerminationRequest()).toBe(false);
    await act(async () => responder.onPanResponderRelease());
    expect(onChange).toHaveBeenCalledTimes(1); expect(onChange).toHaveBeenLastCalledWith(movePoint(points, 1, .6, .6));
    expect(responder.onStartShouldSetPanResponder(event(0, 200))).toBe(true);
    await act(async () => { responder.onPanResponderGrant(event(0, 200)); responder.onPanResponderMove(event(60, 140), { dx: 60, dy: -60 });
        responder.onPanResponderRelease(); });
    expect(onChange).toHaveBeenLastCalledWith(movePoint(points, 0, .3, .3));
    const button = (label: string) => root.container.queryAll(n => n.props.accessibilityLabel === label && n.props.onClick)[0];
    expect(plot.props.accessibilityLabel).toBe('Curve for Master: 3 points');
    for (const label of ['Increase Point 2 input', 'Increase Point 2 output', 'Remove point 2', 'Add point', 'Reset Master curve']) expect(button(label)).toBeDefined();
    await act(async () => button('Remove point 2').props.onClick({ nativeEvent: {}, currentTarget: 1, target: 1 })); expect(onChange).toHaveBeenLastCalledWith([points[0], points[2]]);
    for (const label of ['Increase Point 2 input', 'Increase Point 2 output', 'Add point', 'Reset Master curve']) {
        await act(async () => button(label).props.onClick({ nativeEvent: {}, currentTarget: 1, target: 1 }));
        const changed = onChange.mock.calls.at(-1)![0];
        expect(colourProblem({ ...colourDefaults(), curves: { ...colourDefaults().curves, master: changed } })).toBeNull();
    }
    await act(async () => root.render(<CurveEditor points={points} channelLabel="Master" disabled onChange={onChange} />));
    expect(responder.onStartShouldSetPanResponder(event(100, 100))).toBe(false);
    expect(button('Add point').props.accessibilityState.disabled).toBe(true);
    await act(async () => root.unmount()); spy.mockRestore();
});
