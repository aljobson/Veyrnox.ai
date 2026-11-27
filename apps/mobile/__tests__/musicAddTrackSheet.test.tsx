import { act } from 'react';
import { createRoot, type Root } from 'test-renderer';
import * as RN from 'react-native';
import { MusicAddTrackTray } from '../src/components/beats/MusicAddTrackSheet';

void [RN.View, RN.Pressable, RN.Text, RN.ScrollView];

let root: Root;
beforeEach(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; root = createRoot(); });
afterEach(async () => { await act(async () => root.unmount()); });

const callbacks = () => ({ onDevice: jest.fn(), onRecord: jest.fn(), onInstrument: jest.fn(), onSounds: jest.fn() });
const press = async (testID: string) => {
    const button = root.container.queryAll(node => node.props.testID === testID && typeof (node.props.onClick ?? node.props.onPress) === 'function')[0];
    await act(async () => (button.props.onClick ?? button.props.onPress)({ nativeEvent: {} }));
};

test('offers four focused track sources inline without duplicating the dock Library or drums', async () => {
    const actions = callbacks();
    await act(async () => root.render(<MusicAddTrackTray disabled={false} {...actions} />));
    for (const [testID, callback] of [
        ['music-add-track-device', actions.onDevice], ['music-add-track-record', actions.onRecord],
        ['music-add-track-instrument', actions.onInstrument], ['music-add-track-sounds', actions.onSounds],
    ] as const) { await press(testID); expect(callback).toHaveBeenCalledTimes(1); }
    expect(root.container.queryAll(node => node.props.testID === 'music-add-track-drums')).toHaveLength(0);
});

test('disables track creation choices when the song cannot accept another track', async () => {
    const reason = 'A song can have at most 16 tracks.';
    await act(async () => root.render(<MusicAddTrackTray disabled reason={reason} {...callbacks()} />));
    for (const testID of ['music-add-track-device', 'music-add-track-record', 'music-add-track-instrument', 'music-add-track-sounds']) {
        const button = root.container.queryAll(node => node.props.testID === testID && typeof (node.props.onClick ?? node.props.onPress) === 'function')[0];
        expect(button.props.accessibilityState.disabled).toBe(true);
        expect(button.props.accessibilityHint).toBe(reason);
    }
    expect(root.container.queryAll(node => node.props.testID === 'music-add-track-disabled-reason')[0].props.children).toBe(reason);
});

test('is an inline toolbar rather than a modal or second screen', async () => {
    await act(async () => root.render(<MusicAddTrackTray disabled={false} {...callbacks()} />));
    expect(root.container.queryAll(node => node.props.testID === 'music-add-track-tray')).toHaveLength(1);
    expect(root.container.queryAll(node => node.props.transparent && node.props.presentationStyle === 'overFullScreen')).toHaveLength(0);
    expect(root.container.queryAll(node => node.props.accessibilityRole === 'button')).toHaveLength(4);
    const tray = root.container.queryAll(node => node.props.testID === 'music-add-track-tray')[0];
    expect(tray.props.nestedScrollEnabled).toBe(true);
    expect(RN.StyleSheet.flatten(tray.props.style)).toMatchObject({ flexShrink: 1, minHeight: 0 });
});

test('uses one horizontally scrollable icon row in a constrained landscape viewport', async () => {
    await act(async () => root.render(<MusicAddTrackTray disabled={false} compact {...callbacks()} />));
    const tray = root.container.queryAll(node => node.props.testID === 'music-add-track-tray')[0];
    expect(tray.props.horizontal).toBe(true);
    for (const testID of ['music-add-track-device', 'music-add-track-record', 'music-add-track-instrument', 'music-add-track-sounds']) {
        const button = root.container.queryAll(node => node.props.testID === testID && typeof (node.props.onClick ?? node.props.onPress) === 'function')[0];
        expect(RN.StyleSheet.flatten(button.props.style).minHeight).toBe(44);
        expect(button.props.accessibilityLabel).toBeTruthy();
    }
});
