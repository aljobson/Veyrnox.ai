import { act } from 'react';
import * as RN from 'react-native';
import { createRoot, type Root } from 'test-renderer';
import Home from '../src/app/(app)/(tabs)/index';
import { parsePresets } from '../src/lib/presets';
import { t } from '../src/lib/i18n';
const mockPush = jest.fn(); const mockFetch = jest.fn(); const mockImages = jest.fn(); const mockAudio = jest.fn();
const mockApi = { request: jest.fn() };
jest.mock('expo-router', () => ({ Link: ({ children }: any) => children, useRouter: () => ({ push: mockPush }), useLocalSearchParams: () => ({}), useFocusEffect: (cb: any) => require('react').useEffect(cb, [cb]) }));
jest.mock('../src/auth/AuthProvider', () => ({ useAuth: () => ({ api: mockApi, status: 'signedOut' }) }));
jest.mock('../src/lib/media', () => ({ ...jest.requireActual('../src/lib/media'), fetchCatalogCached: async (cb: any) => { cb([]); return []; }, mediaApi: () => ({ listJobs: async () => ({ jobs: [] }) }) }));
jest.mock('../src/lib/presets', () => ({ ...jest.requireActual('../src/lib/presets'), fetchPresets: () => mockFetch() }));
jest.mock('../src/lib/imageTemplates', () => ({ ...jest.requireActual('../src/lib/imageTemplates'), fetchImageTemplates: () => mockImages() }));
jest.mock('../src/lib/audioTemplates', () => ({ ...jest.requireActual('../src/lib/audioTemplates'), fetchAudioTemplates: () => mockAudio() }));
jest.mock('../src/lib/templateFilters', () => ({ ...jest.requireActual('../src/lib/templateFilters'), fetchPopularIds: async () => [] }));
jest.mock('../src/lib/creatorProfileStore', () => ({ loadVibe: async () => null }));
jest.mock('../src/lib/useBalance', () => ({ useBalance: () => 100 }));
jest.mock('../src/components/credits/CheckInEntry', () => ({ CheckInEntry: () => null }));
jest.mock('../src/components/home/OddlingsBanner', () => ({ OddlingsBanner: () => null }));
jest.mock('expo-image', () => ({ Image: jest.requireActual('react-native').Image }));
void [RN.View, RN.Text, RN.Pressable, RN.ScrollView, RN.ActivityIndicator];
const video = parsePresets({ presets: Array.from({ length: 6 }, (_, i) => ({ id: `vid-${i}`, title: `Video ${i}`, modality: 'image-to-video', category: 'CINEMATIC', modelId: 'kling', modelName: 'Kling', prompt: 'p', credits: 5 })) });
const images = [
    { id: 'forest-light', name: 'Forest Light', category: 'REALISTIC', modelId: 'nano', prompt: 'A forest', previewUrl: null, previewAspect: 1, photoRequired: false },
    { id: 'pastel', name: 'Pastel Corridor', category: 'REALISTIC', modelId: 'nano', prompt: 'A corridor', previewUrl: null, previewAspect: 1, photoRequired: false },
];
const audio = [{ id: 'midnight-soul', name: 'Midnight Soul', category: 'MUSIC', modelId: 'suno', prompt: 'Soulful' }];
let root: Root;
const buttons = () => root.container.queryAll(n => n.props.accessibilityRole === 'button');
const control = (label: string) => buttons().find(n => n.props.accessibilityLabel === label);
const titles = () => buttons().map(n => String(n.props.accessibilityLabel).split(',')[0]).filter(s => /^(Video \d|Forest Light|Pastel Corridor|Midnight Soul)$/.test(s));
const event = { nativeEvent: {}, currentTarget: 1, target: 1 };
const click = (label: string) => act(async () => control(label)!.props.onClick(event));
beforeEach(async () => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
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
    await act(async () => buttons().find(n => String(n.props.accessibilityLabel).startsWith('Midnight Soul,'))!.props.onClick(event));
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/create/[modelId]', params: { modelId: 'suno', prompt: 'Soulful' } });
});
test('the header counts every kind', async () => {
    const text = root.container.queryAll(n => typeof n.props.children === 'string' && /templates? on/.test(n.props.children)).map(n => n.props.children).join(' ');
    expect(text).toMatch(/9 templates on 3 models/);
});
test('Explore still lists video when the image and audio lists fail to load', async () => {
    mockImages.mockRejectedValue(new Error('x')); mockAudio.mockRejectedValue(new Error('x'));
    await act(async () => root.unmount()); root = createRoot();
    await act(async () => root.render(<Home />));
    expect(titles()).toContain('Video 0');
    await click(t('explore.type.audio'));
    expect(titles()).toEqual([]);
});
