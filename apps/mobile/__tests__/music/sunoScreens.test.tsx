import { act } from 'react';
import { createRoot, type Root } from 'test-renderer';
import * as RN from 'react-native';
import { MusicSongActions } from '../../src/components/music/MusicSongActions';
import { MusicSunoControls } from '../../src/components/music/MusicSunoControls';
import { t } from '../../src/lib/i18n';
import { crunCustom, crunEntitlements } from '../fixtures/musicCreate';
import { song, version } from '../fixtures/music';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }) }));
void [RN.View, RN.Text, RN.Pressable];
let root: Root;
beforeEach(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; root = createRoot(); mockPush.mockClear(); });
afterEach(async () => { await act(async () => root.unmount()); });

const text = (value: string) => root.container.queryAll(node => node.children.includes(value));
const controls = (role: string, label?: string) => root.container.queryAll(node => node.props.accessibilityRole === role
    && (label === undefined || node.props.accessibilityLabel === label));

test('Suno custom form renders projection-driven counters, options, note and accessible controls', async () => {
    const model = crunEntitlements.models[1];
    const change = jest.fn();
    await act(async () => root.render(<MusicSunoControls input={crunCustom} model={model} rights
        onChange={change} onRights={jest.fn()} />));
    expect(text(t('music.create.counter', { count: crunCustom.lyrics.length, max: 5000 })).length).toBeGreaterThan(0);
    expect(text(t('music.create.suno.excludeNote', { count: 200 })).length).toBeGreaterThan(0);
    expect(controls('adjustable', t('music.create.suno.styleWeight'))).toHaveLength(1);
    expect(controls('adjustable', t('music.create.suno.weirdness'))).toHaveLength(1);
    expect(controls('adjustable', t('music.create.suno.duration'))).toHaveLength(1);
    expect(controls('radio')).toHaveLength(5);
    expect(root.container.queryAll(node => node.props.accessibilityRole === 'tab'
        && node.props.accessibilityLabel === 'v6_wild')[0].props.accessibilityState.selected).toBe(true);
    expect(root.container.queryAll(node => node.props.accessibilityRole === 'tab'
        && node.props.accessibilityLabel === t('music.create.suno.gender.female'))[0].props.accessibilityState.selected).toBe(true);
    const max = controls('radio', t('music.create.suno.variety.4'))[0];
    await act(async () => max.props.onClick({ nativeEvent: {} }));
    expect(change).toHaveBeenCalledWith({ variety: 100 });
});

test('instrumental Suno form hides vocal-only fields and still exposes style controls', async () => {
    await act(async () => root.render(<MusicSunoControls input={{ ...crunCustom, instrumental: true }}
        model={crunEntitlements.models[1]} rights={false} onChange={jest.fn()} onRights={jest.fn()} />));
    expect(root.container.queryAll(node => node.props.accessibilityLabel === t('music.create.lyrics'))).toHaveLength(0);
    expect(text(t('music.create.suno.vocalGender'))).toHaveLength(0);
    expect(root.container.queryAll(node => node.props.accessibilityLabel === t('music.create.rights'))).toHaveLength(0);
    expect(root.container.queryAll(node => node.props.accessibilityLabel === t('music.create.suno.style'))).toHaveLength(1);
});

test('song actions hide unavailable format edits and explain why', async () => {
    const limited = { ...song, actions: ['render', 'crop', 'stems', 'download_mp3'], current_version: { ...version, capabilities: {
        playback: true, download: true, render: false, crop: false, stems: true,
    } } };
    await act(async () => root.render(<MusicSongActions song={limited} />));
    expect(controls('button', t('musicRender.title'))).toHaveLength(0);
    expect(controls('button', t('musicActions.crop.title'))).toHaveLength(0);
    expect(controls('button', t('musicActions.stems.title'))).toHaveLength(1);
    expect(text(t('music.actions.editUnavailableForFormat')).length).toBeGreaterThan(0);
});
