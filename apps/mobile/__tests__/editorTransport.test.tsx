import { act } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { createRoot, type Root } from 'test-renderer';
import { EditorTransport } from '../src/components/editor/EditorTransport';
void [Pressable, StyleSheet, Text, TextInput, View];
jest.mock('../src/components/ui/Icon', () => ({ Icon: () => null }));
let root: Root;
const onSeek = jest.fn(), onPlaying = jest.fn();
const button = (label: string) => root.container.queryAll(n => n.props.accessibilityLabel === label && typeof n.props.onClick === 'function')[0];
const input = () => root.container.queryAll(n => n.props.accessibilityLabel === 'Enter timecode' && typeof n.props.onChangeText === 'function')[0];
async function press(label: string) { await act(async () => button(label).props.onClick({ nativeEvent: {}, currentTarget: 1, target: 1 })); }
async function render(frame = 10, total = 100, playing = false) { await act(async () => root.render(<EditorTransport frame={frame} total={total} fps={30} playing={playing} onSeek={onSeek} onPlaying={onPlaying} />)); }
beforeEach(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; jest.clearAllMocks(); root = createRoot(); });
afterEach(async () => { await act(async () => root.unmount()); });
test('transport bounds and disabled states', async () => {
    await render(); await press('Previous frame'); await press('Next frame'); await press('Go to end'); await press('Go to start');
    expect(onSeek.mock.calls).toEqual([[9], [11], [99], [0]]);
    await render(0); expect(button('Previous frame').props.accessibilityState.disabled).toBe(true); expect(button('Go to start').props.accessibilityState.disabled).toBe(true);
    await render(99); expect(button('Next frame').props.accessibilityState.disabled).toBe(true); expect(button('Go to end').props.accessibilityState.disabled).toBe(true);
    await render(0, 0); for (const label of ['Previous frame', 'Next frame', 'Go to end', 'Go to start', 'Play']) expect(button(label).props.accessibilityState.disabled).toBe(true);
});
test('timecode entry seeks with clamping and pauses playback', async () => {
    await render(10, 100, true); await press('Enter timecode'); await act(async () => input().props.onChangeText('00:02:15')); await act(async () => input().props.onSubmitEditing());
    expect(onSeek).toHaveBeenLastCalledWith(75); expect(onPlaying).toHaveBeenLastCalledWith(false);
    await press('Enter timecode'); await act(async () => input().props.onChangeText('01:00')); await act(async () => input().props.onSubmitEditing()); expect(onSeek).toHaveBeenLastCalledWith(99);
});
test('invalid input alerts and blur cancels without seeking', async () => {
    await render(); await press('Enter timecode'); await act(async () => input().props.onChangeText('1:75')); await act(async () => input().props.onSubmitEditing());
    expect(root.container.queryAll(n => n.props.accessibilityRole === 'alert').length).toBeGreaterThan(0); expect(onSeek).not.toHaveBeenCalled();
    await act(async () => input().props.onBlur()); expect(input()).toBeUndefined(); expect(onSeek).not.toHaveBeenCalled();
});
