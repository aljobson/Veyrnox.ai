import { act } from 'react';
import { createRoot, type Root } from 'test-renderer';
import * as RN from 'react-native';
import { MusicInstrumentTray } from '../src/components/beats/MusicInstrumentTray';

void [RN.View, RN.Pressable, RN.Text, RN.ScrollView];

let root: Root;
beforeEach(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; root = createRoot(); });
afterEach(async () => { await act(async () => root.unmount()); });

test('starts with drums and adds a preset without preview or per-row plus controls', async () => {
    const apply = jest.fn(() => true), onAdded = jest.fn();
    await act(async () => root.render(<MusicInstrumentTray apply={apply} disabled={false} onBack={() => {}} onAdded={onAdded} />));
    const drums = root.container.queryAll(node => node.props.testID === 'music-instrument-group-drums')[0];
    expect(drums.props.accessibilityState.selected).toBe(true);
    expect(root.container.queryAll(node => node.props.accessibilityLabel?.toLowerCase().includes('audition'))).toHaveLength(0);
    expect(root.container.queryAll(node => node.props.icon === 'play')).toHaveLength(0);
    const preset = root.container.queryAll(node => String(node.props.testID).startsWith('music-instrument-add-'))[0];
    await act(async () => (preset.props.onClick ?? preset.props.onPress)({ nativeEvent: {} }));
    expect(apply).toHaveBeenCalledTimes(1);
    expect(onAdded).toHaveBeenCalledTimes(1);
});

test('keeps instrument categories and presets inline and disables additions when locked', async () => {
    const reason = 'Recording is in progress. Stop recording to add a track.';
    await act(async () => root.render(<MusicInstrumentTray apply={() => true} disabled reason={reason} onBack={() => {}} onAdded={() => {}} />));
    expect(root.container.queryAll(node => node.props.testID === 'music-instrument-groups')).toHaveLength(1);
    const presets = root.container.queryAll(node => String(node.props.testID).startsWith('music-instrument-add-'));
    expect(presets.length).toBeGreaterThan(0);
    expect(presets.every(node => node.props.accessibilityState.disabled)).toBe(true);
    expect(presets.every(node => node.props.accessibilityHint === reason)).toBe(true);
    expect(root.container.queryAll(node => node.props.testID === 'music-instrument-disabled-reason')[0].props.children).toBe(reason);
    const tray = root.container.queryAll(node => node.props.testID === 'music-instrument-tray')[0];
    expect(tray.props.horizontal).not.toBe(true);
    expect(tray.props.nestedScrollEnabled).toBe(true);
    expect(RN.StyleSheet.flatten(tray.props.style)).toMatchObject({ flexShrink: 1, minHeight: 0 });
});

test('flattens categories and presets into one accessible horizontal row when height is constrained', async () => {
    await act(async () => root.render(<MusicInstrumentTray apply={() => true} disabled={false} compact onBack={() => {}} onAdded={() => {}} />));
    const row = root.container.queryAll(node => node.props.testID === 'music-instrument-groups')[0];
    expect(row.props.horizontal).toBe(true);
    expect(root.container.queryAll(node => String(node.props.testID).startsWith('music-instrument-presets-'))).toHaveLength(0);
    const preset = root.container.queryAll(node => String(node.props.testID).startsWith('music-instrument-add-'))[0];
    expect(RN.StyleSheet.flatten(preset.props.style).minHeight).toBe(44);
    expect(preset.props.accessibilityLabel).toBeTruthy();
    const visibleLabels = root.container.queryAll(node => node.props.numberOfLines === 1)
        .map(node => node.props.children)
        .filter(value => typeof value === 'string');
    expect(visibleLabels).toContain('Drum kits');
    expect(visibleLabels).toContain('Acoustic kit');
});
