import { act } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { createRoot, type Root } from 'test-renderer';
import { EditorTimeline } from '../src/components/editor/EditorTimeline';
import { emptyTimeline, type Timeline } from '../src/lib/nativeEditorModel';
import { playSelection } from '../src/lib/haptics';
void [ScrollView, StyleSheet, Text, View];
jest.mock('../src/lib/haptics', () => ({ playSelection: jest.fn() }));
jest.mock('../src/components/ui/Icon', () => ({ Icon: () => null }));
jest.mock('../src/components/ui/useReducedMotion', () => ({ useReducedMotion: () => true }));
let root: Root, timeline: Timeline;
const onSeek = jest.fn(), onSelect = jest.fn(), onApply = jest.fn(), onViewport = jest.fn();
const selected = { track: 'video' as const, id: 'v1' };
const event = (pageX = 0, pageY = 0, locationX = 0, locationY = 10) => ({ nativeEvent: { pageX, pageY, locationX, locationY } });
const node = (id: string) => root.container.queryAll(n => n.props.testID === id)[0];
async function render(selections = [selected], snap = false) {
    await act(async () => root.render(<EditorTimeline timeline={timeline} selections={selections} ppf={2} total={300} frame={0} playing={false} snap={snap} onSeek={onSeek} onSelect={onSelect} onApply={onApply} onViewport={onViewport} />));
}
async function call(id: string, prop: string, value = event()) { await act(async () => node(id).props[prop](value)); }
beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; jest.useFakeTimers(); jest.clearAllMocks(); root = createRoot();
    timeline = { ...emptyTimeline(), media: { m: { id: 'm', kind: 'video', frames: 500, name: 'Shot' } }, video: [{ id: 'v1', start: 60, len: 90, in: 30, mediaId: 'm', trackId: 'video-0' }] };
    timeline.tracks.push({ ...timeline.tracks[0], id: 'video-2', name: 'Video 2' });
});
afterEach(async () => { await act(async () => root.unmount()); jest.useRealTimers(); });
test('positions clips and playhead in a single scroller and scrubs on grant and move', async () => {
    await render(); expect(StyleSheet.flatten(node('clip-v1').props.style)).toMatchObject({ left: 120, width: 178, height: 44 });
    expect(StyleSheet.flatten(node('timeline-playhead').props.style)).toMatchObject({ left: 0, width: 2, height: 256 });
    await call('timeline-ruler', 'onResponderGrant', event(100, 0, 120)); await call('timeline-ruler', 'onResponderMove', event(140));
    expect(onSeek.mock.calls).toEqual([[60], [80]]); expect(node('timeline-ruler').props.onResponderTerminationRequest()).toBe(false);
    await call('timeline-ruler', 'onResponderRelease'); expect(onApply).not.toHaveBeenCalled();
});
test('taps select while movement before hold yields to scrolling', async () => {
    await render([]); await call('clip-v1', 'onResponderGrant'); await call('clip-v1', 'onResponderRelease'); expect(onSelect).toHaveBeenCalledWith(selected);
    onSelect.mockClear(); await call('clip-v1', 'onResponderGrant'); await call('clip-v1', 'onResponderMove', event(9));
    expect(node('clip-v1').props.onResponderTerminationRequest()).toBe(true);
    await act(async () => jest.advanceTimersByTime(300)); await call('clip-v1', 'onResponderTerminate');
    expect(onApply).not.toHaveBeenCalled(); expect(playSelection).not.toHaveBeenCalled(); expect(onSelect).not.toHaveBeenCalled();
});
test.each([[6, 100], [7, 93]])('hold move snaps at distance %s and commits once', async (distance, expected) => {
    timeline.video.push({ ...timeline.video[0], id: 'v2', start: 100, len: 10 });
    await render([], true); await call('clip-v1', 'onResponderGrant'); await act(async () => jest.advanceTimersByTime(300));
    expect(onSelect).toHaveBeenCalledWith(selected); expect(node('clip-v1').props.onResponderTerminationRequest()).toBe(false);
    const move = event((40 - distance) * 2);
    await call('clip-v1', 'onResponderMove', move); await call('clip-v1', 'onResponderMove', move);
    expect(onApply).not.toHaveBeenCalled(); expect(playSelection).toHaveBeenCalledTimes(distance === 6 ? 2 : 1);
    await call('clip-v1', 'onResponderRelease', move);
    expect(onApply).toHaveBeenCalledTimes(1); expect(onApply.mock.calls[0][0].video[0].start).toBe(expected);
});
test.each([[56, false, 'video-0'], [168, false, 'video-2'], [168, true, 'video-0']])('resolves interleaved row at dy %s with target locked %s', async (dy, locked, expected) => {
    timeline.tracks[3].locked = locked; await render(); await call('clip-v1', 'onResponderGrant'); await act(async () => jest.advanceTimersByTime(300));
    await call('clip-v1', 'onResponderMove', event(20, dy)); await call('clip-v1', 'onResponderRelease', event(20, dy));
    expect(onApply.mock.calls[0][0].video[0]).toMatchObject({ start: 70, trackId: expected });
});
test('trim gestures commit once and cancel discards the ghost', async () => {
    await render(); await call('trim-v1-in', 'onResponderGrant'); await call('trim-v1-in', 'onResponderMove', event(20));
    expect(onApply).not.toHaveBeenCalled(); await call('trim-v1-in', 'onResponderRelease', event(20));
    expect(onApply).toHaveBeenCalledTimes(1); expect(onApply.mock.calls[0][0].video[0]).toMatchObject({ start: 70, in: 40, len: 80 });
    onApply.mockClear(); await call('trim-v1-out', 'onResponderGrant'); await call('trim-v1-out', 'onResponderMove', event(20)); await call('trim-v1-out', 'onResponderTerminate'); expect(onApply).not.toHaveBeenCalled();
});
test('locked tracks can select but have no trim handles or hold move', async () => {
    timeline.tracks[0].locked = true; await render(); expect(node('trim-v1-in')).toBeUndefined();
    await call('clip-v1', 'onResponderGrant'); await act(async () => jest.advanceTimersByTime(300)); await call('clip-v1', 'onResponderRelease');
    expect(onSelect).toHaveBeenCalledWith(selected); expect(onApply).not.toHaveBeenCalled(); expect(playSelection).not.toHaveBeenCalled();
});
test('accessibility actions move one second and trim one frame, protected clips hide handles', async () => {
    await render(); await call('clip-v1', 'onAccessibilityAction', { nativeEvent: { actionName: 'moveLater' } } as any);
    expect(onApply.mock.calls[0][0].video[0].start).toBe(90);
    await call('trim-v1-out', 'onAccessibilityAction', { nativeEvent: { actionName: 'increment' } } as any);
    expect(onApply.mock.calls[1][0].video[0].len).toBe(91);
    Object.assign(timeline.video[0], { words: [] }); await render(); expect(node('trim-v1-out')).toBeUndefined();
});
test('tapping empty lane space seeks without an edit', async () => {
    await render(); await call('lane-audio-0', 'onResponderGrant', event(10, 10, 120)); await call('lane-audio-0', 'onResponderRelease', event(10, 10)); expect(onSeek).toHaveBeenCalledWith(60); expect(onApply).not.toHaveBeenCalled();
});
