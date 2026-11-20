import { act } from 'react';
import { createRoot, type Root } from 'test-renderer';
import { PanResponder, View, type PanResponderCallbacks } from 'react-native';
import { useRegionHold } from '../src/lib/beatNative/useRegionHold';
import { t } from '../src/lib/i18n';
let root: Root, responder: PanResponderCallbacks;
const commit = jest.fn(), select = jest.fn(), preview = jest.fn(), lock = jest.fn(), announce = jest.fn();
function Harness() {
    const handlers = useRegionHold({ value: (dx, dy) => ({ dx, dy }), commit, select, preview, lock, announce });
    return <View testID="hold" {...handlers} />;
}
const touch = (x = 0, y = 0) => ({ nativeEvent: { pageX: x, pageY: y, identifier: 1 }, stopPropagation: jest.fn() } as never);
const props = () => root.container.queryAll(n => n.props.testID === 'hold')[0].props;
beforeEach(async () => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    jest.useFakeTimers(); jest.clearAllMocks(); root = createRoot();
    jest.spyOn(PanResponder, 'create').mockImplementation(config => { responder = config; return { panHandlers: {} } as never; });
    await act(async () => root.render(<Harness />));
});
afterEach(async () => { await act(async () => root.unmount()); jest.restoreAllMocks(); jest.useRealTimers(); });
const run = async (fn: () => void) => act(async () => { fn(); });
test.each([100, 350])('raw touch start/end after %i ms without responder grant selects and unlocks', async delay => {
    await run(() => { props().onTouchStart(touch()); jest.advanceTimersByTime(delay); });
    await run(() => props().onTouchEnd(touch()));
    expect(select).toHaveBeenCalledTimes(1); expect(commit).not.toHaveBeenCalled();
    // A held touch clears what it set; a quick tap never touched the shared preview or lock.
    if (delay >= 350) { expect(preview).toHaveBeenLastCalledWith(null); expect(lock).toHaveBeenLastCalledWith(false); }
    else { expect(preview).not.toHaveBeenCalled(); expect(lock).not.toHaveBeenCalled(); }
    await run(() => responder.onPanResponderRelease?.(touch(), {} as never));
    expect(select).toHaveBeenCalledTimes(1); expect(commit).not.toHaveBeenCalled();
});
test('pre-hold movement yields scrolling, clears timer, never claims or edits', async () => {
    await run(() => props().onTouchStart(touch()));
    expect(responder.onStartShouldSetPanResponder?.(touch(), {} as never)).toBe(false);
    await run(() => props().onTouchMove(touch(9)));
    expect(responder.onMoveShouldSetPanResponder?.(touch(9), {} as never)).toBe(false);
    await run(() => { jest.advanceTimersByTime(400); props().onTouchEnd(touch(9)); });
    expect(lock).not.toHaveBeenCalledWith(true); expect(commit).not.toHaveBeenCalled(); expect(select).not.toHaveBeenCalled();
});
test('held movement claims, rejects termination requests, and commits once after raw end plus release', async () => {
    await run(() => { props().onTouchStart(touch()); jest.advanceTimersByTime(350); props().onTouchMove(touch(12, 100)); });
    expect(lock).toHaveBeenCalledWith(true); expect(announce).toHaveBeenCalledWith(t('beat.drag.moving'));
    expect(responder.onMoveShouldSetPanResponder?.(touch(12, 100), {} as never)).toBe(true);
    expect(responder.onPanResponderTerminationRequest?.(touch(), {} as never)).toBe(false);
    await run(() => { props().onTouchEnd(touch(12, 100)); responder.onPanResponderRelease?.(touch(), {} as never); });
    expect(commit).toHaveBeenCalledTimes(1); expect(commit).toHaveBeenCalledWith({ dx: 12, dy: 100 });
    expect(preview).toHaveBeenLastCalledWith(null); expect(lock).toHaveBeenLastCalledWith(false);
});
test.each(['terminate', 'reject', 'rawCancel', 'unmount'])('%s clears preview and lock without an edit', async kind => {
    await run(() => { props().onTouchStart(touch()); jest.advanceTimersByTime(350); props().onTouchMove(touch(12)); });
    await run(() => {
        if (kind === 'terminate') responder.onPanResponderTerminate?.(touch(), {} as never);
        if (kind === 'reject') responder.onPanResponderReject?.(touch(), {} as never);
        if (kind === 'rawCancel') props().onTouchCancel(touch());
        if (kind === 'unmount') root.unmount();
    });
    expect(commit).not.toHaveBeenCalled(); expect(preview).toHaveBeenLastCalledWith(null); expect(lock).toHaveBeenLastCalledWith(false);
    expect(announce).toHaveBeenLastCalledWith(t('beat.drag.cancelled'));
});
test('unmount before timeout cannot lock a discarded view', async () => {
    await run(() => { props().onTouchStart(touch()); root.unmount(); });
    await run(() => jest.advanceTimersByTime(400)); expect(lock).not.toHaveBeenCalledWith(true);
});
test('a caller-supplied held message replaces the region wording', async () => {
    function Cycle() { return <View testID="cycle" {...useRegionHold({ value: dx => dx, commit, select, preview, lock, announce, heldMessage: t('beat.cycle.moving') })} />; }
    await act(async () => root.render(<Cycle />));
    const cycle = root.container.queryAll(n => n.props.testID === 'cycle')[0].props;
    await run(() => { cycle.onTouchStart(touch()); jest.advanceTimersByTime(350); });
    expect(announce).toHaveBeenCalledWith(t('beat.cycle.moving')); expect(announce).not.toHaveBeenCalledWith(t('beat.drag.moving'));
    await run(() => cycle.onTouchCancel(touch()));
});
test('a second finger cannot clear or steal the held drag', async () => {
    const other = { preview: jest.fn(), lock: jest.fn(), select: jest.fn(), commit: jest.fn() };
    function Two() {
        const a = useRegionHold({ value: (dx, dy) => ({ dx, dy }), commit, select, preview, lock, announce });
        const b = useRegionHold({ value: () => 'b', announce, ...other });
        return <><View testID="hold" {...a} /><View testID="b" {...b} /></>;
    }
    await act(async () => root.render(<Two />));
    const b = () => root.container.queryAll(n => n.props.testID === 'b')[0].props;
    const touchB = (x = 0) => ({ nativeEvent: { pageX: x, pageY: 0, identifier: 2 }, stopPropagation: jest.fn() } as never);
    await run(() => { props().onTouchStart(touch()); jest.advanceTimersByTime(350); });
    expect(lock).toHaveBeenLastCalledWith(true);
    await run(() => { b().onTouchStart(touchB()); b().onTouchEnd(touchB()); });           // quick tap
    await run(() => { b().onTouchStart(touchB()); b().onTouchMove(touchB(20)); });         // pre-hold cancel
    await run(() => { b().onTouchStart(touchB()); jest.advanceTimersByTime(350); b().onTouchEnd(touchB()); }); // competing hold
    expect(other.lock).not.toHaveBeenCalled(); expect(other.preview).not.toHaveBeenCalled(); expect(other.commit).not.toHaveBeenCalled();
    expect(other.select).not.toHaveBeenCalled();
    expect(lock).not.toHaveBeenCalledWith(false); expect(preview).not.toHaveBeenCalledWith(null);
    await run(() => { props().onTouchMove(touch(12, 0)); props().onTouchEnd(touch(12, 0)); });
    expect(commit).toHaveBeenCalledWith({ dx: 12, dy: 0 }); expect(lock).toHaveBeenLastCalledWith(false);
});
test('a touch already pending when another finger takes the hold does not select on lift', async () => {
    const other = { preview: jest.fn(), lock: jest.fn(), select: jest.fn(), commit: jest.fn() };
    function Two() {
        const a = useRegionHold({ value: (dx, dy) => ({ dx, dy }), commit, select, preview, lock, announce });
        const b = useRegionHold({ value: () => 'b', announce, ...other });
        return <><View testID="hold" {...a} /><View testID="b" {...b} /></>;
    }
    await act(async () => root.render(<Two />));
    const b = root.container.queryAll(n => n.props.testID === 'b')[0].props;
    const touchB = { nativeEvent: { pageX: 0, pageY: 0, identifier: 2 }, stopPropagation: jest.fn() } as never;
    await run(() => { props().onTouchStart(touch()); jest.advanceTimersByTime(200); b.onTouchStart(touchB); jest.advanceTimersByTime(150); });
    expect(lock).toHaveBeenLastCalledWith(true);
    await run(() => b.onTouchEnd(touchB));
    expect(other.select).not.toHaveBeenCalled(); expect(lock).not.toHaveBeenCalledWith(false);
    await run(() => props().onTouchCancel(touch()));
});
