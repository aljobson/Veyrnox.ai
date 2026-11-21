import { act } from 'react';
import * as RN from 'react-native';
import { createRoot, type Root } from 'test-renderer';
import Home from '../src/app/(app)/(tabs)/index';
import { parsePresets } from '../src/lib/presets';
import { t } from '../src/lib/i18n';
const mockPush = jest.fn(); const mockFetch = jest.fn(); const mockImages = jest.fn(); const mockAudio = jest.fn();
const mockApi = { request: jest.fn() };
const entry = (id: string) => ({ id, name: id, modality: 'text-to-image', credits: 3 });
let mockCatalog: any[] | null = [];
let mockStale = false;
let mockHold: Promise<void> | null = null;
jest.mock('expo-router', () => ({ Link: ({ children }: any) => children, useRouter: () => ({ push: mockPush }), useLocalSearchParams: () => ({}), useFocusEffect: (cb: any) => require('react').useEffect(cb, [cb]) }));
jest.mock('../src/auth/AuthProvider', () => ({ useAuth: () => ({ api: mockApi, status: 'signedOut' }) }));
jest.mock('../src/lib/media', () => ({ ...jest.requireActual('../src/lib/media'), fetchCatalogCached: async (cb: any) => { if (mockCatalog === null) throw new Error('offline'); if (mockHold) await mockHold; cb(mockCatalog, { fromCache: mockStale, stale: mockStale, savedAt: 0, ageMs: 0 }); return mockCatalog; }, mediaApi: () => ({ listJobs: async () => ({ jobs: [] }) }) }));
jest.mock('../src/lib/presets', () => ({ ...jest.requireActual('../src/lib/presets'), fetchPresets: () => mockFetch() }));
jest.mock('../src/lib/imageTemplates', () => ({ ...jest.requireActual('../src/lib/imageTemplates'), fetchImageTemplates: () => mockImages() }));
jest.mock('../src/lib/audioTemplates', () => ({ ...jest.requireActual('../src/lib/audioTemplates'), fetchAudioTemplates: () => mockAudio() }));
jest.mock('../src/lib/templateFilters', () => ({ ...jest.requireActual('../src/lib/templateFilters'), fetchPopularIds: async () => [] }));
jest.mock('../src/lib/creatorProfileStore', () => ({ loadVibe: async () => null }));
jest.mock('../src/lib/useBalance', () => ({ useBalance: () => 100 }));
jest.mock('../src/components/credits/CheckInEntry', () => ({ CheckInEntry: () => null }));
jest.mock('../src/components/home/OddlingsBanner', () => ({ OddlingsBanner: () => null }));
jest.mock('expo-image', () => ({ Image: jest.requireActual('react-native').Image }));
jest.mock('expo-audio', () => ({ setAudioModeAsync: jest.fn(() => Promise.resolve()), useAudioPlayer: () => ({ play: jest.fn() }), useAudioPlayerStatus: () => ({ didJustFinish: false }) }));
void [RN.View, RN.Text, RN.Pressable, RN.ScrollView, RN.ActivityIndicator];
const video = parsePresets({ presets: Array.from({ length: 6 }, (_, i) => ({ id: `vid-${i}`, title: `Video ${i}`, modality: 'image-to-video', category: 'CINEMATIC', modelId: 'kling', modelName: 'Kling', prompt: 'p', credits: 5 })) });
const images = [
    { id: 'forest-light', name: 'Forest Light', category: 'REALISTIC', modelId: 'nano', prompt: 'A forest', previewUrl: null, previewAspect: 1, photoRequired: false },
    { id: 'pastel', name: 'Pastel Corridor', category: 'REALISTIC', modelId: 'nano', prompt: 'A corridor', previewUrl: null, previewAspect: 1, photoRequired: false },
];
const audio = [{ id: 'midnight-soul', name: 'Midnight Soul', category: 'MUSIC', modelId: 'suno', prompt: 'Soulful' }];
let root: Root;
const buttons = () => root.container.queryAll(n => n.props.accessibilityRole === 'button');
// The Audio start option shares a label with the Audio filter chip; the chip is the one that carries selected state.
const control = (label: string) => buttons().filter(n => n.props.accessibilityLabel === label).sort((a, b) => Number(b.props.accessibilityState?.selected !== undefined) - Number(a.props.accessibilityState?.selected !== undefined))[0];
// Audio cards are drawn as on the web and their open target reads "Audio, <name>"; poster cards lead with the name.
const titles = () => buttons().map(n => String(n.props.accessibilityLabel).replace(/^Audio, /, '').split(',')[0]).filter(s => /^(Video \d|Forest Light|Pastel Corridor|Midnight Soul|Red Light)$/.test(s));
const event = { nativeEvent: {}, currentTarget: 1, target: 1 };
const click = (label: string) => act(async () => control(label)!.props.onClick(event));
beforeEach(async () => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    mockCatalog = [entry('nano'), entry('suno')]; mockStale = false; mockHold = null;
    root = createRoot(); mockPush.mockReset(); mockFetch.mockReset().mockResolvedValue(video);
    mockImages.mockReset().mockResolvedValue(images); mockAudio.mockReset().mockResolvedValue(audio);
    await act(async () => root.render(<Home />));
});
afterEach(async () => { await act(async () => root.unmount()); });
test('Images lists the image templates and Audio lists the audio templates', async () => {
    await click(t('explore.type.image'));
    expect(titles()).toEqual(['Forest Light', 'Pastel Corridor']);
    await click(t('explore.type.audio'));
    expect(titles()).toEqual(['Midnight Soul']);
    expect(RN && root.container.queryAll(n => n.props.children === t('explore.audioSoon'))).toHaveLength(0);
});
test('All is a mix of video, image and audio, not video only', async () => {
    expect(titles()).toEqual(expect.arrayContaining(['Video 0', 'Forest Light', 'Midnight Soul']));
});
test('an image or audio card opens Create with the template prompt, like Create > Templates', async () => {
    await click(t('explore.type.audio'));
    await act(async () => buttons().find(n => n.props.accessibilityLabel === 'Audio, Midnight Soul, 3 credits')!.props.onClick(event));
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/create/[modelId]', params: { modelId: 'suno', prompt: 'Soulful' } });
});
test('an audio template in Explore plays its sample from the list, like the web', async () => {
    mockAudio.mockResolvedValue([{ ...audio[0], previewUrl: 'https://veyrnox.ai/a.jpg', previewAudioUrl: 'https://veyrnox.ai/a.mp3' }]);
    await act(async () => root.unmount()); root = createRoot();
    await act(async () => root.render(<Home />));
    await click(t('explore.type.audio'));
    const play = buttons().find(n => n.props.accessibilityLabel === 'Play, Midnight Soul');
    expect(play).toBeDefined();
    await act(async () => play!.props.onClick(event));
    expect(buttons().some(n => n.props.accessibilityLabel === 'Pause, Midnight Soul')).toBe(true);
    expect(mockPush).not.toHaveBeenCalled();
});
test('the header counts every kind', async () => {
    const text = root.container.queryAll(n => typeof n.props.children === 'string' && /^\d+ templates?$/.test(n.props.children)).map(n => n.props.children).join(' ');
    expect(text).toBe('9 templates');
});
test('Explore still lists video when the image and audio lists fail to load', async () => {
    mockImages.mockRejectedValue(new Error('x')); mockAudio.mockRejectedValue(new Error('x'));
    await act(async () => root.unmount()); root = createRoot();
    await act(async () => root.render(<Home />));
    expect(titles()).toContain('Video 0');
    await click(t('explore.type.audio'));
    expect(titles()).toEqual([]);
});

const IDS = ['Video 0', 'Forest Light', 'Pastel Corridor', 'Midnight Soul'];
async function rerender(models: any[] | null) {
    await act(async () => root.unmount()); mockCatalog = models; root = createRoot();
    await act(async () => root.render(<Home />));
}
const countText = () => root.container.queryAll(n => typeof n.props.children === 'string' && /^\d+ templates?$/.test(n.props.children)).map(n => n.props.children).join(' ');
test('image and audio templates whose model is not in the catalog are not listed, and the count stays honest', async () => {
    mockImages.mockResolvedValue([...images, { id: 'red-light', name: 'RED LIGHT FILTER', category: 'REALISTIC', modelId: 'nano-banana-pro-edit-grsai', prompt: 'p', previewUrl: null, previewAspect: 1, photoRequired: true }]);
    await rerender([entry('nano'), entry('suno')]);
    expect(titles()).toEqual(expect.arrayContaining(['Forest Light', 'Midnight Soul']));
    expect(root.container.queryAll(n => String(n.props.accessibilityLabel).startsWith('RED LIGHT FILTER'))).toHaveLength(0);
    expect(countText()).toBe('9 templates');
});
test('a loaded but empty catalog hides every image and audio template', async () => {
    await rerender([]);
    expect(titles().filter(x => IDS.slice(1).includes(x))).toEqual([]);
    expect(countText()).toBe('6 templates');
});
test('while the catalog is unknown (fetch failed) nothing is hidden', async () => {
    await rerender(null);
    expect(titles()).toEqual(expect.arrayContaining(['Video 0', 'Forest Light', 'Midnight Soul']));
});
test('a saved catalog copy past its freshness window does not hide templates until the network confirms it', async () => {
    mockStale = true;
    await rerender([]);
    expect(titles()).toEqual(expect.arrayContaining(['Video 0', 'Forest Light', 'Midnight Soul']));
});
test('a category chosen before the catalog arrives falls back to All when the catalog removes it', async () => {
    let deliver: () => void = () => {};
    mockImages.mockResolvedValue([...images, { id: 'red', name: 'Red Light', category: 'CINEMATIC', modelId: 'gone', prompt: 'p', previewUrl: null, previewAspect: 1, photoRequired: true }]);
    mockHold = new Promise<void>(resolve => { deliver = resolve; });
    await act(async () => root.unmount()); root = createRoot();
    await act(async () => root.render(<Home />));
    await click(t('explore.type.image'));
    await act(async () => control(t('explore.categories'))!.props.onClick(event));
    const chip = root.container.queryAll(n => n.props.accessibilityRole === 'button' && /cinematic/i.test(String(n.props.accessibilityLabel)))[0];
    await act(async () => chip.props.onClick(event));
    expect(titles()).toEqual(['Red Light']);
    await act(async () => { deliver(); await mockHold; });
    expect(titles()).toEqual(['Forest Light', 'Pastel Corridor']);
});
