import { act } from 'react';
import { Text } from 'react-native';
import { createRoot, type Root } from 'test-renderer';
import { ACTION_WIDTH, SwipeRow, settleTarget } from '../src/components/SwipeRow';

describe('where a release leaves the row', () => {
    const reveal = ACTION_WIDTH * 2;
    test('a short, slow drag springs back', () => {
        expect(settleTarget(20, 0, reveal, 360, true)).toBe('closed');
    });
    test('past half the buttons, or a quick flick, opens it', () => {
        expect(settleTarget(reveal / 2 + 1, 0, reveal, 360, false)).toBe('open');
        expect(settleTarget(30, 0.9, reveal, 360, false)).toBe('open');
        expect(settleTarget(5, 0.9, reveal, 360, false)).toBe('closed');
    });
    test('a long swipe runs the first action only when that is switched on', () => {
        expect(settleTarget(360 * 0.7, 0, reveal, 360, true)).toBe('full');
        expect(settleTarget(360 * 0.7, 0, reveal, 360, false)).toBe('open');
    });
    test('before the row is measured, a long swipe never runs an action', () => {
        expect(settleTarget(500, 0, reveal, 0, true)).toBe('open');
    });
});

describe('the row', () => {
    let root: Root;
    beforeEach(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; root = createRoot(); });
    afterEach(async () => { await act(async () => root.unmount()); });

    test('with no actions it is just its content', async () => {
        await act(async () => root.render(<SwipeRow actions={[]}><Text>Plain</Text></SwipeRow>));
        expect(root.container.queryAll(n => n.props.accessibilityRole === 'button')).toHaveLength(0);
    });

    test('screen readers get every action by name, and pressing one runs it', async () => {
        const onDelete = jest.fn();
        await act(async () => root.render(
            <SwipeRow actions={[{ key: 'delete', label: 'Delete', accessibilityLabel: 'Delete the chat Plans', tone: 'danger', onPress: onDelete }]}>
                <Text>Plans</Text>
            </SwipeRow>,
        ));
        const holder = root.container.queryAll(n => Array.isArray(n.props.accessibilityActions))[0];
        expect(holder.props.accessibilityActions).toEqual([{ name: 'delete', label: 'Delete the chat Plans' }]);
        await act(async () => holder.props.onAccessibilityAction({ nativeEvent: { actionName: 'delete' } }));
        expect(onDelete).toHaveBeenCalledTimes(1);
    });

    test('a disabled row offers no actions to screen readers', async () => {
        await act(async () => root.render(
            <SwipeRow disabled actions={[{ key: 'delete', label: 'Delete', onPress: jest.fn() }]}><Text>Plans</Text></SwipeRow>,
        ));
        expect(root.container.queryAll(n => Array.isArray(n.props.accessibilityActions))).toHaveLength(0);
    });
});
