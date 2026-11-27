import { act } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { createRoot, type Root } from 'test-renderer';
import type { ApiClient } from '../src/lib/api';
import { BestCutSheet } from '../src/components/editor/BestCutSheet';

void [ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View];
jest.setTimeout(30000);
let mockInsets = { top: 0, bottom: 21, left: 59, right: 59 };
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => mockInsets }));
jest.mock('../src/lib/safeArea', () => ({
    useOptionalSafeAreaInsets: () => mockInsets,
    ZERO_SAFE_AREA_INSETS: { top: 0, right: 0, bottom: 0, left: 0 },
}));
jest.mock('expo-crypto', () => ({ randomUUID: () => 'test-key' }));
jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn().mockResolvedValue(null), setItemAsync: jest.fn(), deleteItemAsync: jest.fn() }));
jest.mock('../src/lib/appCache', () => ({ getCacheUser: () => 'owner', subscribeCacheUser: () => () => {} }));
jest.mock('../src/lib/editorDeviceMedia', () => ({ editorDeviceMedia: {} }));
jest.mock('../src/lib/editorMediaDuration', () => ({ probeDuration: jest.fn() }));
jest.mock('../src/components/JobThumb', () => ({ JobThumb: () => null, useAssetLinks: () => ({}) }));
jest.mock('../src/components/LibraryChooser', () => ({ LibraryChooser: () => null }));

let root: Root;
beforeEach(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; mockInsets = { top: 0, bottom: 21, left: 59, right: 59 }; root = createRoot(); });
afterEach(async () => { await act(async () => root.unmount()); });
function scroll() {
    return root.container.queryAll(n => n.props.keyboardShouldPersistTaps === 'handled')[0];
}
function expectFixedInset() {
    const form = scroll();
    expect(form).toBeDefined();
    const wrapper = StyleSheet.flatten(form.parent!.props.style);
    expect(wrapper.paddingTop).toBe(62);
    expect(wrapper.paddingBottom).toBe(34);
    expect(wrapper.flex).toBe(1);
    expect(wrapper.backgroundColor).toBeDefined();
    const content = StyleSheet.flatten(form.props.contentContainerStyle);
    expect(content.paddingTop).toBe(16);
}
function expectKeyboardSafeLandscapeContent() {
    const form = scroll();
    expect(form).toBeDefined();
    const content = StyleSheet.flatten(form.props.contentContainerStyle);
    expect(content.paddingLeft).toBe(75);
    expect(content.paddingRight).toBe(75);
    expect(content.paddingBottom).toBe(37);
    expect(content.paddingTop).toBe(16);
    expect(form.props.keyboardDismissMode).toBe('on-drag');
}
test('clip picker reveals focused fields inside landscape-safe scrolling content', async () => {
    const api = { getBalance: jest.fn().mockResolvedValue({ balance: 100 }) } as unknown as ApiClient;
    await act(async () => root.render(<BestCutSheet api={api} projectId="project" quote={{ credits: 1, max_seconds: 60, languages: ['en'] }} onClose={jest.fn()} onApply={() => ({ status: 'accepted' })} />));
    expectKeyboardSafeLandscapeContent();
});
test('entry consent keeps the safe-area padding outside scrolling content', async () => {
    mockInsets = { top: 62, bottom: 34, left: 0, right: 0 };
    // Load separately so the existing sheet regression still runs before this new component exists.
    const { BestCutConsent } = jest.requireActual<typeof import('../src/components/editor/BestCutConsent')>('../src/components/editor/BestCutConsent');
    await act(async () => root.render(<BestCutConsent busy={false} onClose={jest.fn()} onConfirm={jest.fn()} />));
    expectFixedInset();
});
test('full-screen Best Cut keeps portrait content below the status area while the form scrolls', async () => {
    mockInsets = { top: 62, bottom: 34, left: 0, right: 0 };
    const api = { getBalance: jest.fn().mockResolvedValue({ balance: 100 }) } as unknown as ApiClient;
    await act(async () => root.render(<BestCutSheet api={api} projectId="project" quote={{ credits: 1, max_seconds: 60, languages: ['en'] }} onClose={jest.fn()} onApply={() => ({ status: 'accepted' })} />));
    const form = scroll();
    const wrapper = StyleSheet.flatten(form.parent!.parent!.parent!.props.style);
    expect(wrapper.paddingTop).toBe(62);
    const content = StyleSheet.flatten(form.props.contentContainerStyle);
    expect(content).toMatchObject({ paddingTop: 16, paddingLeft: 16, paddingRight: 16, paddingBottom: 50 });
});
