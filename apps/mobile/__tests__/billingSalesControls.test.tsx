import { act } from 'react';
import * as RN from 'react-native';
import { createRoot, type Root, type TestInstance } from 'test-renderer';
import Account from '../src/app/(app)/account';
import Publish from '../src/app/(app)/(tabs)/publish';
import { UnlockCard } from '../src/components/UnlockCard';
import { t } from '../src/lib/i18n';
const mockFocus = new Set<() => void>();
const mockBilling = { status: 'ready', offerings: null, canPurchase: false, canRestore: true,
    publishActive: false, paidAccess: false, activeProductIds: [], managementURL: null,
    restore: jest.fn(async () => true), refreshSales: jest.fn(async () => false) };
const mockApi = { request: jest.fn(async (path: string) => path.endsWith('/accounts')
    ? { accounts: [], plansEnabled: true, connectedLimit: 5, tier: 'free', features: {} }
    : path.endsWith('/brands') ? { brands: [] } : { posts: [] }) };
jest.mock('../src/auth/AuthProvider', () => ({ useAuth: () => ({ api: mockApi, getAccessToken: jest.fn(), generation: 0 }) }));
jest.mock('../src/lib/usePublishApi', () => ({ usePublishApi: () => mockApi }));
jest.mock('../src/lib/auth/accountCalls', () => ({ fetchProfile: async () => null }));
jest.mock('../src/billing/BillingProvider', () => ({ useBilling: () => mockBilling }));
jest.mock('../src/push/pushContext', () => ({ usePush: () => ({ supported: false }) }));
jest.mock('../src/components/VeyCardPeek', () => ({ VeyCardPeek: () => null, peekRoom: () => 0 }));
jest.mock('../src/lib/creatorProfile', () => ({ ...jest.requireActual('../src/lib/creatorProfile'), CREATOR_PROFILE_ENABLED: false }));
jest.mock('expo-router', () => ({ Stack: { Screen: () => null }, Link: ({ children }: any) => children,
    useRouter: () => ({ push: jest.fn() }), useFocusEffect: (cb: () => void) => require('react').useEffect(() => {
        mockFocus.add(cb); cb(); return () => { mockFocus.delete(cb); };
    }, [cb]) }));
jest.mock('../src/components/ui', () => {
    const component = (name: string) => ({ children, ...props }: any) => require('react').createElement(name, props, children);
    return { Text: component('text'), Card: component('card'), ListRow: component('row'), Button: component('button'), PriceText: component('price'),
        themedStyles: (fn: any) => fn(require('../src/theme').tokensForScheme('dark'), {}), useThemedStyles: (s: any) => s };
});
void [RN.View, RN.Text, RN.Pressable, RN.ScrollView];
let root: Root;
const text = (node: TestInstance): string => node.children.map(c => typeof c === 'string' ? c : text(c)).join('');
beforeEach(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; jest.clearAllMocks(); root = createRoot(); });
afterEach(async () => { await act(async () => root.unmount()); });
test.each(['Account', 'Publish', 'UnlockCard'])('%s Restore stays enabled when sales are closed', async name => {
    await act(async () => root.render(name === 'Account' ? <Account /> : name === 'Publish' ? <Publish /> : <UnlockCard feature="calendar" onUnlocked={() => {}} />));
    const label = t(name === 'UnlockCard' ? 'unlock.restore' : 'account.restore');
    const control = root.container.queryAll(n => (n.props.label === label || n.props.title === label || text(n) === label)
        && (n.props.onPress || n.props.onClick))[0];
    expect(control).toBeDefined(); expect(control.props.disabled).not.toBe(true);
    expect(control.props.accessibilityState?.disabled).not.toBe(true);
    await act(async () => { (control.props.onPress ?? control.props.onClick)({ nativeEvent: {}, currentTarget: 1, target: 1 }); });
    expect(mockBilling.restore).toHaveBeenCalledTimes(1);
});
test.each(['Account', 'Publish'])('%s refreshes on every focus while sales are closed', async name => {
    await act(async () => root.render(name === 'Account' ? <Account /> : <Publish />));
    expect(mockBilling.refreshSales).toHaveBeenCalledTimes(1);
    for (let i = 2; i <= 4; i++) {
        await act(async () => { for (const cb of mockFocus) cb(); });
        expect(mockBilling.refreshSales).toHaveBeenCalledTimes(i);
    }
});
