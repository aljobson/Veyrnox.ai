import { act } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { createRoot, type Root } from 'test-renderer';
import type { ApiClient } from '../src/lib/api';
import { BestCutSheet } from '../src/components/editor/BestCutSheet';

void [ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View];
jest.setTimeout(30000);
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 47, bottom: 34, left: 0, right: 0 }) }));
jest.mock('expo-crypto', () => ({ randomUUID: () => 'test-key' }));
jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn().mockResolvedValue(null), setItemAsync: jest.fn(), deleteItemAsync: jest.fn() }));
jest.mock('../src/lib/appCache', () => ({ getCacheUser: () => 'owner', subscribeCacheUser: () => () => {} }));
jest.mock('../src/lib/editorDeviceMedia', () => ({ editorDeviceMedia: {} }));
jest.mock('../src/lib/editorMediaDuration', () => ({ probeDuration: jest.fn() }));
jest.mock('../src/components/JobThumb', () => ({ JobThumb: () => null, useAssetLinks: () => ({}) }));
jest.mock('../src/components/LibraryChooser', () => ({ LibraryChooser: () => null }));

let root: Root;
beforeEach(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; root = createRoot(); });
afterEach(async () => { await act(async () => root.unmount()); });
function expectFixedInset() {
    const scroll = root.container.queryAll(n => n.props.keyboardShouldPersistTaps === 'handled')[0];
    expect(scroll).toBeDefined();
    const wrapper = StyleSheet.flatten(scroll.parent!.props.style);
    expect(wrapper?.paddingTop ?? 0).toBeGreaterThanOrEqual(47);
    expect(wrapper.paddingBottom).toBeGreaterThanOrEqual(34);
    expect(wrapper.flex).toBe(1);
    expect(wrapper.backgroundColor).toBeDefined();
    const content = StyleSheet.flatten(scroll.props.contentContainerStyle);
    expect(content.paddingTop).toBe(16);
    expect(content.paddingTop).toBeLessThan(47);
}
test('clip picker keeps the safe-area padding outside scrolling content', async () => {
    const api = { getBalance: jest.fn().mockResolvedValue({ balance: 100 }) } as unknown as ApiClient;
    await act(async () => root.render(<BestCutSheet api={api} projectId="project" quote={{ credits: 1, max_seconds: 60, languages: ['en'] }} onClose={jest.fn()} onApply={() => true} />));
    expectFixedInset();
});
test('entry consent keeps the safe-area padding outside scrolling content', async () => {
    // Load separately so the existing sheet regression still runs before this new component exists.
    const { BestCutConsent } = jest.requireActual<typeof import('../src/components/editor/BestCutConsent')>('../src/components/editor/BestCutConsent');
    await act(async () => root.render(<BestCutConsent busy={false} onClose={jest.fn()} onConfirm={jest.fn()} />));
    expectFixedInset();
});
