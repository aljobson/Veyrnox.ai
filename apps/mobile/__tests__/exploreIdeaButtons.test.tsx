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
beforeEach(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; root = createRoot(); });
afterEach(async () => { await act(async () => root.unmount()); });

test('Explore does not repeat Create with a generic idea composer', async () => {
    await act(async () => root.render(<Home />));
    const labels = root.container.queryAll(node => typeof node.props.accessibilityLabel === 'string').map(node => node.props.accessibilityLabel);
    expect(labels).not.toContain(t('explore.ideaTitle'));
    expect(labels).not.toContain(t('explore.makeVideo'));
    expect(labels).not.toContain(t('explore.makeImage'));
});
