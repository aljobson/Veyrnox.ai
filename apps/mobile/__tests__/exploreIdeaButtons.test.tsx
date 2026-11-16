import { act } from 'react';
import * as RN from 'react-native';
import { createRoot, type Root } from 'test-renderer';
import Home from '../src/app/(app)/(tabs)/index';
import { t } from '../src/lib/i18n';
jest.mock('expo-router', () => ({ Link: ({ children }: any) => children, useRouter: () => mockRouter, useLocalSearchParams: () => ({}), useFocusEffect: (cb: any) => require('react').useEffect(cb, [cb]) }));
const mockRouter = { push: jest.fn() };
const mockAuth = { api: { request: jest.fn() }, status: 'signedOut' };
jest.mock('../src/auth/AuthProvider', () => ({ useAuth: () => mockAuth }));
jest.mock('../src/lib/media', () => ({ ...jest.requireActual('../src/lib/media'), fetchCatalogCached: async (cb: any) => { cb([]); return []; }, mediaApi: () => ({ listJobs: async () => ({ jobs: [] }) }) }));
jest.mock('../src/lib/presets', () => ({ ...jest.requireActual('../src/lib/presets'), fetchPresets: async () => require('../src/lib/presets').parsePresets({ presets: [{ id: 'a', title: 'A', modality: 'text-to-image', isNew: false, category: 'CINEMATIC', modelId: 'model', modelName: 'Model', prompt: 'p', credits: 3 }] }) }));
jest.mock('../src/lib/templateFilters', () => ({ ...jest.requireActual('../src/lib/templateFilters'), fetchPopularIds: async () => ['a'] }));
jest.mock('../src/lib/creatorProfileStore', () => ({ loadVibe: async () => null }));
jest.mock('../src/lib/useBalance', () => ({ useBalance: () => 100 }));
jest.mock('../src/components/credits/CheckInEntry', () => ({ CheckInEntry: () => null }));
jest.mock('../src/components/home/OddlingsBanner', () => ({ OddlingsBanner: () => null }));
jest.mock('expo-image', () => ({ Image: jest.requireActual('react-native').Image }));
void [RN.View, RN.Text, RN.Pressable, RN.ScrollView, RN.ActivityIndicator];

let root: Root;
const button = (label: string) => root.container.queryAll(n => n.props.accessibilityRole === 'button').find(n => n.props.accessibilityLabel === label);
const idle = (n: any) => typeof n.props.style === 'function' ? n.props.style({ pressed: false }) : n.props.style;
const flat = (style: any): Record<string, unknown> => Object.assign({}, ...[style].flat(9).filter(Boolean));
beforeEach(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; root = createRoot(); });
afterEach(async () => { await act(async () => root.unmount()); });

// QA 2.2: with nothing typed, Make a video was greyed but Make an image still looked ready.
test('with an empty idea both Make buttons are disabled and look the same', async () => {
    await act(async () => root.render(<Home />));
    const video = button(t('explore.makeVideo'))!, image = button(t('explore.makeImage'))!;
    expect(video.props.accessibilityState.disabled).toBe(true);
    expect(image.props.accessibilityState.disabled).toBe(true);
    const a = flat(idle(video)), b = flat(idle(image));
    expect(b.backgroundColor).toBe(a.backgroundColor);
    expect(b.opacity).toBe(a.opacity);
});
