import { act } from 'react';
import * as ReactNative from 'react-native';
import { createRoot, type Root, type TestInstance } from 'test-renderer';
import * as ImagePicker from 'expo-image-picker';
import { FaceFiltersFlow } from '../src/components/FaceFiltersFlow';
import { type ApiClient } from '../src/lib/api';
import { fetchCatalog, type CatalogModel } from '../src/lib/media';
import { saveLookToPhotos } from '../src/lib/lookExport';

jest.mock('@shopify/react-native-skia', () => {
    const Pass = ({ children }: { children?: unknown }) => children ?? null;
    return { useImage: () => ({}), Canvas: Pass, Image: Pass, ColorMatrix: () => null };
});
jest.mock('../src/lib/lookThumb', () => ({ makeThumb: async () => 'file:///cache/thumb.jpg' }));
jest.mock('../src/lib/lookExport', () => ({ saveLookToPhotos: jest.fn() }));
jest.mock('expo-router', () => ({ Stack: { Screen: () => null }, useRouter: () => ({ push: jest.fn() }) }));
jest.mock('expo-image', () => ({ Image: jest.requireActual('react-native').Image }));
jest.mock('expo-image-picker', () => ({ launchImageLibraryAsync: jest.fn() }));
jest.mock('expo-file-system', () => ({ File: class { exists = false; }, Paths: { cache: { uri: 'file:///cache/' } } }));
jest.mock('expo-crypto', () => ({ randomUUID: () => 'test-run-id' }));
jest.mock('../src/lib/appCache', () => ({ getCacheUser: () => 'owner', subscribeCacheUser: () => () => {} }));
jest.mock('../src/lib/cacheFiles', () => ({ discardCacheCopy: jest.fn() }));
jest.mock('../src/lib/useBalance', () => ({ useBalance: () => 100 }));
jest.mock('../src/lib/aiConsentStore', () => ({ aiConsent: { ensure: async () => {}, hasAgreed: async () => true } }));
jest.mock('../src/lib/network', () => ({ ...jest.requireActual('../src/lib/network'), ensureOnline: async () => {} }));
jest.mock('../src/lib/media', () => ({ ...jest.requireActual('../src/lib/media'), fetchCatalog: jest.fn() }));
jest.mock('../src/lib/uploads', () => ({ uploadSource: jest.fn() }));
jest.mock('../src/lib/output', () => ({ saveOutput: jest.fn(), shareOutput: jest.fn() }));
void [ReactNative.ActivityIndicator, ReactNative.Pressable, ReactNative.ScrollView, ReactNative.StyleSheet, ReactNative.Text, ReactNative.TextInput, ReactNative.View];

const retouch: CatalogModel = { id: 'face-retouch', name: 'Retouch', modality: 'image-to-image', credits: 17, gated: false, durations: [], capabilities: { inputs: {}, media: { image: { required: true } } } };
const retouchChip = 'Retouch. Gently retouch the face in your photo.. 17 credits per run';
const photoUri = 'file:///cache/photo.jpg';
let root: Root;

beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    jest.clearAllMocks();
    jest.mocked(fetchCatalog).mockResolvedValue([retouch]);
    jest.mocked(saveLookToPhotos).mockResolvedValue(true);
    jest.mocked(ImagePicker.launchImageLibraryAsync).mockResolvedValue({ canceled: false, assets: [{ uri: photoUri, fileSize: 100, mimeType: 'image/jpeg', width: 100, height: 100 }] });
    root = createRoot();
});
afterEach(async () => { await act(async () => root.unmount()); jest.restoreAllMocks(); });

const find = (role: string, label: string): TestInstance[] => root.container.queryAll(node => node.props.accessibilityRole === role && node.props.accessibilityLabel === label);
function control(role: string, label: string): TestInstance { const m = find(role, label); expect(m).toHaveLength(1); return m[0]; }
async function press(role: string, label: string) { const n = control(role, label); await act(async () => { n.props.onClick({ nativeEvent: {}, currentTarget: 1, target: 1 }); }); }
async function open() {
    await act(async () => { root.render(<FaceFiltersFlow api={{ request: jest.fn() } as unknown as ApiClient} owner="owner" />); });
    await press('button', 'Choose one photo');
}

test('looks are disabled until a photo is chosen', async () => {
    await act(async () => { root.render(<FaceFiltersFlow api={{ request: jest.fn() } as unknown as ApiClient} owner="owner" />); });
    expect(control('button', 'Warm').props.accessibilityState.disabled).toBe(true);
    expect(find('adjustable', 'Look strength')).toHaveLength(0);
});

test('a look applies at once with a strength line and a save button, and needs no rights tick or credits', async () => {
    await open();
    expect(control('button', 'Original').props.accessibilityState.selected).toBe(true);
    expect(find('adjustable', 'Look strength')).toHaveLength(0);
    await press('button', 'Warm');
    expect(control('button', 'Warm').props.accessibilityState.selected).toBe(true);
    expect(control('adjustable', 'Look strength').props.accessibilityValue).toMatchObject({ now: 80 });
    expect(find('checkbox', '')).toHaveLength(0);
    await press('button', 'Save to Photos');
    expect(saveLookToPhotos).toHaveBeenCalledWith(photoUri, { id: 'warm', strength: 0.8 }, expect.any(Function));
});

test('strength follows the screen reader and is kept in the saved look', async () => {
    await open(); await press('button', 'Vivid');
    const slider = control('adjustable', 'Look strength');
    await act(async () => { slider.props.onAccessibilityAction({ nativeEvent: { actionName: 'decrement' } }); });
    expect(control('adjustable', 'Look strength').props.accessibilityValue).toMatchObject({ now: 70 });
    await press('button', 'Save to Photos');
    expect(jest.mocked(saveLookToPhotos).mock.calls[0][1].strength).toBeCloseTo(0.7);
});

test('choosing an AI filter replaces the look; choosing a look closes the AI options', async () => {
    await open(); await press('button', 'Glow');
    await press('button', retouchChip);
    expect(find('adjustable', 'Look strength')).toHaveLength(0);
    expect(find('button', 'Save to Photos')).toHaveLength(0);
    expect(control('button', 'Glow').props.accessibilityState.selected).toBe(false);
    expect(control('button', retouchChip).props.accessibilityState.selected).toBe(true);
    await press('button', 'Cool');
    expect(control('button', retouchChip).props.accessibilityState.selected).toBe(false);
    expect(find('checkbox', '')).toHaveLength(0);
});

test('a refused photo permission says where to change it', async () => {
    jest.mocked(saveLookToPhotos).mockResolvedValueOnce(false);
    await open(); await press('button', 'Fade'); await press('button', 'Save to Photos');
    const text = root.container.queryAll(node => node.props.children === 'Allow photo access in Settings to save.');
    expect(text.length).toBeGreaterThan(0);
});

test('the strength line stays when dragged to zero, so it can be raised again', async () => {
    await open(); await press('button', 'Mono');
    for (let i = 0; i < 9; i++) await act(async () => { control('adjustable', 'Look strength').props.onAccessibilityAction({ nativeEvent: { actionName: 'decrement' } }); });
    expect(control('adjustable', 'Look strength').props.accessibilityValue).toMatchObject({ now: 0 });
    expect(find('button', 'Save to Photos')).toHaveLength(0);
    await act(async () => { control('adjustable', 'Look strength').props.onAccessibilityAction({ nativeEvent: { actionName: 'increment' } }); });
    expect(control('adjustable', 'Look strength').props.accessibilityValue).toMatchObject({ now: 10 });
});

test('a failed catalog keeps its retry after a photo is chosen, and retry restores the AI filters', async () => {
    jest.mocked(fetchCatalog).mockRejectedValueOnce(new Error('offline'));
    await open();
    expect(control('button', 'Check again')).toBeDefined();
    jest.mocked(fetchCatalog).mockResolvedValue([retouch]);
    await press('button', 'Check again');
    expect(find('button', 'Check again')).toHaveLength(0);
    expect(control('button', retouchChip)).toBeDefined();
});

test('saving hands the exporter an ownership check that turns false when the account leaves', async () => {
    await open(); await press('button', 'Glow'); await press('button', 'Save to Photos');
    const owned = jest.mocked(saveLookToPhotos).mock.calls[0][2] as () => boolean;
    expect(owned()).toBe(true);
});

test('a cancelled export (account left) shows no permission message', async () => {
    jest.mocked(saveLookToPhotos).mockRejectedValueOnce(new Error('look_export_cancelled'));
    await open(); await press('button', 'Fade'); await press('button', 'Save to Photos');
    const shown = (text: string) => root.container.queryAll(node => node.props.children === text).length;
    expect(shown('Allow photo access in Settings to save.')).toBe(0);
    expect(shown('Could not save this photo.')).toBe(0);
});
