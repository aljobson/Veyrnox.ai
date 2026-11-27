import { act } from 'react';
import { createRoot, type Root } from 'test-renderer';
import * as RN from 'react-native';
import { BeatSaveControls } from '../src/components/beats/BeatSaveControls';

const mockSync = { id: 'sync-test' };
jest.mock('../src/lib/beatNative/useBeatSession', () => ({
    useBeatSession: () => ({ sync: mockSync, view: { state: 'off', busy: false } }),
}));
jest.mock('../src/lib/beatNative/store', () => ({ beatStore: { saveState: () => 'saved' } }));
jest.mock('../src/components/beats/BeatCloudConflictModal', () => ({ BeatCloudConflictModal: () => null }));
jest.mock('../src/components/beats/BeatVersionsSheet', () => ({ BeatVersionsSheet: () => null }));

void [RN.View, RN.ScrollView, RN.Text];

let root: Root;
beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    root = createRoot();
});
afterEach(async () => { await act(async () => root.unmount()); });

test('compact save controls stay in one bounded horizontal inline tray', async () => {
    await act(async () => root.render(<BeatSaveControls id="beat-test" apply={() => true} compact />));
    const tray = root.container.queryAll(node => node.props.testID === 'beat-save-controls-compact')[0];
    expect(tray).toBeDefined();
    expect(tray.props.horizontal).toBe(true);
    expect(RN.StyleSheet.flatten(tray.props.style).height).toBe(44);
    expect(root.container.queryAll(node => node.props.transparent && node.props.presentationStyle === 'overFullScreen')).toHaveLength(0);
});
