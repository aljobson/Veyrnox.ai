import { act } from 'react';
import { createRoot, type Root } from 'test-renderer';
import AppLayout from '../src/app/(app)/_layout';
import { paletteForScheme } from '../src/theme';
import { View } from 'react-native';

let mockScheme: 'light' | 'dark' = 'light';
let mockOptions: any;
let mockScreenLayout: any;
jest.mock('../src/components/ui', () => ({ ...jest.requireActual('../src/components/ui'), Text: () => null, useAppearance: () => ({ settings: require('../src/theme').getAppearance(), scheme: mockScheme }) }));
jest.mock('expo-router', () => {
    const Stack: any = (props: any) => { mockOptions = props.screenOptions; mockScreenLayout = props.screenLayout; return null; };
    Stack.Screen = () => null;
    return { Stack, Redirect: () => null };
});
jest.mock('react-native-safe-area-context', () => ({ SafeAreaView: 'SafeAreaView' }));
jest.mock('../src/auth/AuthProvider', () => ({ useAuth: () => ({ status: 'signedIn', generation: 0 }) }));
jest.mock('../src/lib/useOfflineRecovery', () => ({ useOfflineRecovery: () => undefined }));
jest.mock('../src/components/ErrorFallback', () => ({ SignedInErrorBoundary: () => null }));
jest.mock('../src/components/CelebrationHost', () => ({ CelebrationHost: () => null }));
jest.mock('../src/components/CheckInModal', () => ({ CheckInModal: () => null }));
jest.mock('../src/components/ReferralAttach', () => ({ ReferralAttach: () => null }));
jest.mock('../src/components/Logo', () => ({ Logo: () => null }));
jest.mock('../src/components/AiConsentHost', () => ({ AiConsentHost: () => null }));
jest.mock('../src/components/FirstRunGate', () => ({ FirstRunGate: () => null }));
jest.mock('../src/components/NotificationPrimerGate', () => ({ NotificationPrimerGate: () => null }));
jest.mock('../src/components/OfflineBanner', () => ({ OfflineBanner: () => null }));
jest.mock('../src/components/ServiceBanner', () => ({ ServiceBanner: () => null }));
jest.mock('../src/components/PaywallPrompt', () => ({ PaywallPrompt: () => null }));
jest.mock('../src/components/HomeBackButton', () => ({ HomeBackButton: () => null }));
jest.mock('../src/components/account/MfaGate', () => ({ MfaGate: ({ children }: any) => children }));
jest.mock('../src/components/account/AgeConfirmationGate', () => ({ AgeConfirmationGate: ({ children }: any) => children }));
jest.mock('../src/components/HardPaywallGate', () => ({ HardPaywallGate: ({ children }: any) => children }));

let root: Root;
beforeEach(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; root = createRoot(); });
afterEach(async () => { await act(async () => root.unmount()); });

test('the back chevron tint follows a live theme change, not the scheme at first render', async () => {
    mockScheme = 'light';
    await act(async () => root.render(<AppLayout />));
    expect(mockOptions({ navigation: { canGoBack: () => true } }).headerTintColor).toBe(paletteForScheme('light').text);
    mockScheme = 'dark';
    await act(async () => root.render(<AppLayout />));
    const dark = mockOptions({ navigation: { canGoBack: () => true } });
    expect(dark.headerTintColor).toBe(paletteForScheme('dark').text);
    expect(dark.contentStyle.backgroundColor).toBe(paletteForScheme('dark').background);
});

test('a screen with nothing behind it gets the home back button', async () => {
    await act(async () => root.render(<AppLayout />));
    expect(mockOptions({ navigation: { canGoBack: () => false } }).headerLeft).toBeInstanceOf(Function);
    expect(mockOptions({ navigation: { canGoBack: () => true } }).headerLeft).toBeUndefined();
});

test.each(['publish/accounts', 'templates/[id]', 'oddlings/build', 'features/[slug]', 'job/[id]'])('%s receives the stack landscape safe area', async routeName => {
    await act(async () => root.render(<AppLayout />));
    await act(async () => root.render(mockScreenLayout({ route: { name: routeName }, children: <View testID="route-child" /> })));
    const safe = root.container.queryAll(node => node.type === 'SafeAreaView')[0];
    expect(safe).toBeDefined();
    expect(safe.props.edges).toEqual(['left', 'right']);
    expect(safe.queryAll(node => node.props.testID === 'route-child')).toHaveLength(1);
});

test.each(['(tabs)', 'first-run', 'paywall', 'beats/[id]', 'cinema/watch/[id]', 'editor/[projectId]', 'music/create'])('%s keeps its own horizontal safe area', async routeName => {
    await act(async () => root.render(<AppLayout />));
    await act(async () => root.render(mockScreenLayout({ route: { name: routeName }, children: <View testID="route-child" /> })));
    expect(root.container.queryAll(node => node.type === 'SafeAreaView')).toHaveLength(0);
    expect(root.container.queryAll(node => node.props.testID === 'route-child')).toHaveLength(1);
});
