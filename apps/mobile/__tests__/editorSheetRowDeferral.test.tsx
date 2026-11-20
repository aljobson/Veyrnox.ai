import { act } from 'react';
import { createRoot, type Root } from 'test-renderer';
import { SimpleEditorSheet, type SheetRow } from '../src/components/editor/SimpleEditorChrome';
import { SHEET_CLOSE_MS, runAfterSheetCloses } from '../src/components/editor/runAfterSheetCloses';

let root: Root;
beforeEach(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; jest.useFakeTimers(); root = createRoot(); });
afterEach(() => { jest.useRealTimers(); });

describe('runAfterSheetCloses', () => {
    test('does not run at once, runs once after the close delay', () => {
        const action = jest.fn();
        runAfterSheetCloses(action);
        expect(action).not.toHaveBeenCalled();
        jest.advanceTimersByTime(SHEET_CLOSE_MS - 1);
        expect(action).not.toHaveBeenCalled();
        jest.advanceTimersByTime(5000);
        expect(action).toHaveBeenCalledTimes(1);
    });
});

async function pressRow(rows: SheetRow[], order: string[], label: string) {
    await act(async () => root.render(<SimpleEditorSheet title="Add" rows={rows} onClose={() => order.push('close')} />));
    const nodes = root.container.queryAll(node => node.props.accessibilityLabel === label && typeof node.props.onClick === 'function');
    expect(nodes).toHaveLength(1);
    await act(async () => nodes[0].props.onClick({ nativeEvent: {} }));
}

describe('SimpleEditorSheet row actions', () => {
    test('a picker row closes the sheet first, then runs once after the close delay (the sheet never reports a dismissal)', async () => {
        const order: string[] = [];
        const onPress = jest.fn(() => { order.push('action'); });
        await pressRow([{ id: 'photos', icon: '▤', label: 'Photos', afterClose: true, onPress }], order, 'Photos');
        expect(order).toEqual(['close']);
        expect(onPress).not.toHaveBeenCalled();
        act(() => { jest.advanceTimersByTime(SHEET_CLOSE_MS); });
        act(() => { jest.advanceTimersByTime(5000); });
        expect(order).toEqual(['close', 'action']);
        expect(onPress).toHaveBeenCalledTimes(1);
    });
    test('an ordinary row still runs at once, once', async () => {
        const order: string[] = [];
        const onPress = jest.fn(() => { order.push('action'); });
        await pressRow([{ id: 'library-video', icon: '▣', label: 'Library video', onPress }], order, 'Library video');
        expect(order).toEqual(['close', 'action']);
        act(() => { jest.advanceTimersByTime(5000); });
        expect(onPress).toHaveBeenCalledTimes(1);
    });
});
