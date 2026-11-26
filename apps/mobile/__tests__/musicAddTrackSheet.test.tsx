import { act } from 'react';
import { createRoot, type Root } from 'test-renderer';
import * as RN from 'react-native';
import { MusicAddTrackTray } from '../src/components/beats/MusicAddTrackSheet';
import { t } from '../src/lib/i18n';

void [RN.View, RN.Pressable, RN.Text];

let root: Root;
beforeEach(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; root = createRoot(); });
afterEach(async () => { await act(async () => root.unmount()); });

const callbacks = () => ({ onLibrary: jest.fn(), onDevice: jest.fn(), onRecord: jest.fn(), onInstrument: jest.fn() });
const press = async (label: string) => {
    const button = root.container.queryAll(node => node.props.accessibilityRole === 'button' && node.props.accessibilityLabel === label)[0];
    await act(async () => (button.props.onClick ?? button.props.onPress)({ nativeEvent: {} }));
};

test('offers four focused music sources inline without a duplicate drum shortcut', async () => {
    const actions = callbacks();
    await act(async () => root.render(<MusicAddTrackTray disabled={false} {...actions} />));
    for (const [title, callback] of [
        [t('beat.track.library'), actions.onLibrary], [t('beat.track.device'), actions.onDevice],
        [t('beatTakes.addTrack'), actions.onRecord], [t('beatPiano.library.add'), actions.onInstrument],
    ] as const) { await press(title); expect(callback).toHaveBeenCalledTimes(1); }
    expect(root.container.queryAll(node => node.props.testID === 'music-add-track-drums')).toHaveLength(0);
});

test('disables every track creation choice when the song cannot accept another track', async () => {
    await act(async () => root.render(<MusicAddTrackTray disabled {...callbacks()} />));
    for (const label of [t('beat.track.library'), t('beat.track.device'), t('beatTakes.addTrack'), t('beatPiano.library.add')]) {
        const button = root.container.queryAll(node => node.props.accessibilityRole === 'button' && node.props.accessibilityLabel === label)[0];
        expect(button.props.accessibilityState.disabled).toBe(true);
    }
});

test('is an inline toolbar rather than a modal or second screen', async () => {
    await act(async () => root.render(<MusicAddTrackTray disabled={false} {...callbacks()} />));
    expect(root.container.queryAll(node => node.props.testID === 'music-add-track-tray')).toHaveLength(1);
    expect(root.container.queryAll(node => node.type === RN.Modal)).toHaveLength(0);
    expect(root.container.queryAll(node => node.props.accessibilityRole === 'button')).toHaveLength(4);
});
