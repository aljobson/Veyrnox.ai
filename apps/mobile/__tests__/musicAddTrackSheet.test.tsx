import { act } from 'react';
import { createRoot, type Root } from 'test-renderer';
import * as RN from 'react-native';
import { MusicAddTrackSheet } from '../src/components/beats/MusicAddTrackSheet';
import { t } from '../src/lib/i18n';

void [RN.View, RN.Pressable, RN.Text, RN.Modal];

let root: Root;
beforeEach(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; root = createRoot(); });
afterEach(async () => { await act(async () => root.unmount()); });

const press = async (label: string) => {
    const button = root.container.queryAll(node => node.props.accessibilityRole === 'button' && node.props.accessibilityLabel === label)[0];
    await act(async () => (button.props.onClick ?? button.props.onPress)({ nativeEvent: {} }));
};

test('offers the library, device import, recording, drums, and the shared instrument library', async () => {
    const callbacks = {
        onLibrary: jest.fn(), onDevice: jest.fn(), onRecord: jest.fn(),
        onDrums: jest.fn(), onInstrument: jest.fn(), onClose: jest.fn(),
    };
    await act(async () => root.render(<MusicAddTrackSheet disabled={false} {...callbacks} />));

    const choices = [
        [t('beat.track.library'), callbacks.onLibrary],
        [t('beat.track.device'), callbacks.onDevice],
        [t('beatTakes.addTrack'), callbacks.onRecord],
        [t('beat.kind.drums'), callbacks.onDrums],
        [t('beatPiano.library.add'), callbacks.onInstrument],
    ] as const;
    for (const [title, callback] of choices) {
        await press(title);
        expect(callback).toHaveBeenCalledTimes(1);
    }
    expect(callbacks.onClose).toHaveBeenCalledTimes(5);
});

test('disables every track creation choice when the song cannot accept another track', async () => {
    await act(async () => root.render(<MusicAddTrackSheet disabled onLibrary={() => {}} onDevice={() => {}}
        onRecord={() => {}} onDrums={() => {}} onInstrument={() => {}} onClose={() => {}} />));
    for (const label of [t('beat.track.library'), t('beat.track.device'), t('beatTakes.addTrack'), t('beat.kind.drums'), t('beatPiano.library.add')]) {
        const button = root.container.queryAll(node => node.props.accessibilityRole === 'button' && node.props.accessibilityLabel === label)[0];
        expect(button.props.accessibilityState.disabled).toBe(true);
    }
});

test('presents track choices as a clean icon grid without disclosure chevrons', async () => {
    await act(async () => root.render(<MusicAddTrackSheet disabled={false} onLibrary={() => {}} onDevice={() => {}}
        onRecord={() => {}} onDrums={() => {}} onInstrument={() => {}} onClose={() => {}} />));
    const icons = root.container.queryAll(node => node.props.accessibilityElementsHidden && node.props.style);
    expect(icons.length).toBeGreaterThanOrEqual(5);
    expect(root.container.queryAll(node => node.props.accessibilityLabel === 'caretRight')).toHaveLength(0);
});
