import { act } from 'react';
import { createRoot, type Root } from 'test-renderer';
import { usePreventRemove } from 'expo-router';
import { useEditorLeaveGuard } from '../src/components/editor/useEditorLeaveGuard';
jest.mock('expo-router', () => ({ usePreventRemove: jest.fn() }));
let root: Root, disable: jest.Mock, leave: jest.Mock, back: jest.Mock;
let guard: ReturnType<typeof useEditorLeaveGuard>;
const prevented = () => jest.mocked(usePreventRemove).mock.calls.at(-1)![0];
const callback = () => jest.mocked(usePreventRemove).mock.calls.at(-1)![1]!;
function Harness() { guard = useEditorLeaveGuard(leave, back); return null; }
beforeEach(async () => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    jest.clearAllMocks(); root = createRoot(); disable = jest.fn(); back = jest.fn(); leave = jest.fn(async () => true);
    jest.mocked(usePreventRemove).mockReturnValue(disable);
    await act(async () => root.render(<Harness />));
});
afterEach(async () => { await act(async () => root.unmount()); });
test('prevention covers the whole visit and repeats only after rendering false', async () => {
    expect(prevented()).toBe(true);
    const repeat = jest.fn(() => expect(prevented()).toBe(false));
    leave.mockImplementation(async () => { expect(prevented()).toBe(true); return true; });
    await act(async () => callback()({ data: { action: { type: 'GO_BACK' } }, repeat }));
    expect(leave).toHaveBeenCalledTimes(1); expect(repeat).toHaveBeenCalledTimes(1);
    await act(async () => root.render(<Harness />)); expect(repeat).toHaveBeenCalledTimes(1);
});
test('Stay after a failed save preserves prevention and discards repeat', async () => {
    leave.mockResolvedValue(false);
    const repeat = jest.fn();
    await act(async () => callback()({ data: { action: { type: 'GO_BACK' } }, repeat }));
    expect(prevented()).toBe(true); expect(repeat).not.toHaveBeenCalled();
});
test('pending save/flush is awaited and repeated navigation cannot duplicate it', async () => {
    let finish!: (saved: boolean) => void;
    leave.mockImplementation(() => new Promise<boolean>(resolve => { finish = resolve; }));
    const repeat = jest.fn();
    await act(async () => { callback()({ data: { action: { type: 'GO_BACK' } }, repeat }); callback()({ data: { action: { type: 'GO_BACK' } }, repeat }); });
    expect(prevented()).toBe(true); expect(repeat).not.toHaveBeenCalled(); expect(leave).toHaveBeenCalledTimes(1);
    await act(async () => finish(true)); expect(repeat).toHaveBeenCalledTimes(1);
});
test('Done shares the flow; teardown disables prevention without prompting', async () => {
    await act(async () => guard.done()); expect(back).toHaveBeenCalledTimes(1); expect(leave).toHaveBeenCalledTimes(1);
    leave.mockClear(); back.mockClear();
    await act(async () => guard.teardown(back)); expect(disable).toHaveBeenCalledTimes(1); expect(leave).not.toHaveBeenCalled(); expect(back).toHaveBeenCalledTimes(1);
});
