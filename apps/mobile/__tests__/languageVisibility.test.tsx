import { act } from 'react';
import * as RN from 'react-native';
import { createRoot, type Root } from 'test-renderer';
import Account from '../src/app/(app)/account';
import Vibe from '../src/app/(app)/vibe';
import { ACTIVE_LOCALES, setLocaleFromDevice, t } from '../src/lib/i18n';
let mockActive = ['en'];
let mockStored: string | null = null;
const mockApi = {};
jest.mock('../src/lib/i18n', () => ({ ...jest.requireActual('../src/lib/i18n'), ACTIVE_LOCALES: ['en'] }));
jest.mock('../src/lib/creatorProfileStore', () => ({ loadVibe: async () => null, clearVibe: jest.fn(), storeVibe: jest.fn() }));
jest.mock('../src/lib/languageStore', () => ({ readLanguage: () => mockStored, loadLanguage: async () => mockStored }));
jest.mock('../src/auth/AuthProvider', () => ({ useAuth: () => ({ status: 'signedIn', api: mockApi, getAccessToken: jest.fn() }) }));
jest.mock('../src/lib/auth/accountCalls', () => ({ fetchProfile: async () => null }));
jest.mock('../src/billing/BillingProvider', () => ({ useBilling: () => ({ status: 'off', activeProductIds: [] }) }));
jest.mock('../src/push/pushContext', () => ({ usePush: () => ({ supported: false }) }));
jest.mock('../src/components/VeyCharacter', () => ({ VeyCharacter: () => null }));
jest.mock('expo', () => ({ ...jest.requireActual('expo'), reloadAppAsync: jest.fn() }));
jest.mock('expo-router', () => ({ Stack: { Screen: () => null }, Link: ({ children }: any) => children, useRouter: () => ({}), useLocalSearchParams: () => ({}) }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) }));
jest.mock('../src/components/ui', () => {
    const React = require('react');
    const component = (name: string) => ({ children, ...props }: any) => React.createElement(name, props, children);
    return { Text: component('text'), Card: component('card'), ListRow: component('row'), Button: component('button'), Chip: component('chip'), PriceText: component('price'), TextField: component('field'), ChoiceCard: component('choice'),
        themedStyles: (fn: any) => fn(require('../src/theme').tokensForScheme('dark')), useThemedStyles: (s: any) => s };
});
void [RN.View, RN.ScrollView, RN.KeyboardAvoidingView];
let root: Root;
beforeEach(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; mockActive = ['en']; mockStored = null; root = createRoot(); });
afterEach(async () => { await act(async () => root.unmount()); setLocaleFromDevice(['en']); });
test('Arabic Account uses its translated Credits section heading', async () => {
    setLocaleFromDevice(['ar']);
    await act(async () => root.render(<Account />));
    expect(root.container.queryAll(n => n.type === 'text' && n.props.children === 'الكريدت')).toHaveLength(1);
    expect(root.container.queryAll(n => n.type === 'text' && n.props.children === 'Credits')).toHaveLength(0);
});
test.each([{ active: [] }, { active: ['en'] }, { active: ['en', 'es'] }])('Account Language row visibility follows $active', async ({ active }) => {
    mockActive = active; (ACTIVE_LOCALES as string[]).splice(0, Infinity, ...active);
    await act(async () => root.render(<Account />));
    expect(root.container.queryAll(n => n.type === 'row' && n.props.title === t('language.title'))).toHaveLength(mockActive.length > 1 ? 1 : 0);
});
test.each([
    { active: ['en'], stored: null, ask: false },
    { active: ['en', 'es'], stored: null, ask: true },
    { active: ['en', 'es'], stored: 'ar', ask: true },
    { active: ['en', 'es'], stored: 'es', ask: false },
])('Vibe language question follows $active and saved $stored', async ({ active, stored, ask }) => {
    mockActive = active; (ACTIVE_LOCALES as string[]).splice(0, Infinity, ...active); mockStored = stored;
    await act(async () => root.render(<Vibe />));
    const choices = root.container.queryAll(n => n.props.accessibilityRole === 'button' && ['English', 'Español', 'العربية'].includes(n.props.accessibilityLabel));
    expect(choices.map(n => n.props.accessibilityLabel)).toEqual(ask ? ['English', 'Español'] : []);
});
