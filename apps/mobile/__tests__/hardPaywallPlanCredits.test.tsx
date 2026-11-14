import { act } from 'react';
import * as RN from 'react-native';
import { createRoot, type Root, type TestInstance } from 'test-renderer';
import { HardPaywallGate } from '../src/components/HardPaywallGate';
import { setLocaleFromDevice, t } from '../src/lib/i18n';

const pkg = (id: string, product: string, price: number) => ({ identifier: id, product: { identifier: product, title: id, price, priceString: `£${price}.00`, currencyCode: 'GBP' } });
const mockRequest = jest.fn(async (_path: string): Promise<unknown> => ({ plans: [] }));
const mockBilling = {
    status: 'ready', paidAccess: false, accessResolved: true, canPurchase: true, canRestore: true, generationPurchaseReady: true,
    refreshSales: jest.fn(), refreshGenerationAccess: jest.fn(),
    offerings: { all: { generation: { availablePackages: [pkg('monthly', 'ai.veyrnox.generation.starter.monthly', 10)] } } },
};
jest.mock('../src/lib/hardPaywall', () => ({ ...jest.requireActual('../src/lib/hardPaywall'), hardPaywallEnabled: () => true }));
const mockApi = { request: (path: string) => mockRequest(path) };
jest.mock('../src/auth/AuthProvider', () => ({ useAuth: () => ({ api: mockApi, signOut: jest.fn() }) }));
jest.mock('../src/billing/BillingProvider', () => ({ useBilling: () => mockBilling }));
jest.mock('../src/billing/useStorePurchase', () => ({ useStorePurchase: () => ({ busy: false, start: jest.fn(), operation: { outcome: null } }) }));
jest.mock('../src/components/VeyCharacter', () => ({ VeyCharacter: () => null }));
jest.mock('react-native-purchases', () => ({ __esModule: true, default: {} }));
jest.mock('expo-router', () => ({ usePathname: () => '/', useRouter: () => ({ push: jest.fn() }) }));
void [RN.View, RN.Text, RN.Pressable, RN.ScrollView, RN.ActivityIndicator, RN.Modal];
let root: Root;
const textOf = (node: TestInstance): string => node.children.map(c => typeof c === 'string' ? c : textOf(c)).join('');
beforeEach(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; setLocaleFromDevice(['en']); mockRequest.mockReset().mockImplementation(async () => ({ plans: [] })); root = createRoot(); });
afterEach(async () => act(async () => root.unmount()));

test('the paywall says so when plan credits could not be loaded, and the retry loads them', async () => {
    mockRequest.mockRejectedValueOnce(new Error('offline'));
    await act(async () => root.render(<HardPaywallGate><RN.Text>Inside</RN.Text></HardPaywallGate>));
    expect(root.container.queryAll(n => n.props.testID === 'hard-paywall').length).toBeGreaterThan(0);
    expect(mockRequest).toHaveBeenCalledWith('/api/credit-subscription-plans');
    expect(textOf(root.container)).toContain(t('credits.planDetails.failed'));
    expect(textOf(root.container)).not.toMatch(/\d+ creation credits each month/);
    const retry = root.container.queryAll(n => n.props.accessibilityLabel === t('credits.planDetails.retry') && n.props.onClick);
    expect(retry.length).toBeGreaterThan(0);
    mockRequest.mockResolvedValueOnce({ plans: [{ id: 'starter-monthly', credits: 200 }] });
    await act(async () => retry[0].props.onClick({ nativeEvent: {}, currentTarget: 1, target: 1 }));
    expect(textOf(root.container)).not.toContain(t('credits.planDetails.failed'));
    expect(textOf(root.container)).toContain('200 creation credits each month');
});
test('the paywall shows a loading line while plan credits are on their way', async () => {
    mockRequest.mockImplementationOnce(() => new Promise(() => {}));
    await act(async () => root.render(<HardPaywallGate><RN.Text>Inside</RN.Text></HardPaywallGate>));
    expect(textOf(root.container)).toContain(t('credits.planDetails.loading'));
});
