import { act } from 'react';
import { createRoot, type Root } from 'test-renderer';
import Purchases from 'react-native-purchases';
import { captureEvent } from '../src/lib/analytics/events';

jest.mock('react-native-purchases', () => ({ __esModule: true, default: {
    configure: jest.fn(), addCustomerInfoUpdateListener: jest.fn(), getOfferings: jest.fn(async () => ({ all: {} })),
    logIn: jest.fn(), logOut: jest.fn(), purchasePackage: jest.fn(), restorePurchases: jest.fn(),
} }));
const mockApi = { request: jest.fn(async (path: string) => path.includes('/customer') ? { rc_customer_id: 'customer' } : {}) };
jest.mock('../src/auth/AuthProvider', () => ({ useAuth: () => ({ status: 'signedIn', api: mockApi }) }));
jest.mock('../src/lib/appCache', () => ({ getCacheUser: () => 'alice' }));
jest.mock('../src/lib/analytics/events', () => ({ captureEvent: jest.fn() }));
process.env.EXPO_PUBLIC_STORE_BILLING_ENABLED = 'true';
process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY = 'platform';
process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_KEY = 'platform';
const { BillingProvider, useBilling } = require('../src/billing/BillingProvider') as typeof import('../src/billing/BillingProvider');
const info = (active = {}, subscriptions: string[] = []) => ({ entitlements: { active }, activeSubscriptions: subscriptions, managementURL: null }) as any;
let root: Root, billing: ReturnType<typeof useBilling>;
function Probe() { billing = useBilling(); return null; }
beforeEach(async () => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; jest.clearAllMocks();
    jest.mocked(captureEvent).mockImplementation(() => {});
    jest.mocked(Purchases.logIn).mockResolvedValue({ customerInfo: info(), created: false });
    root = createRoot(); await act(async () => root.render(<BillingProvider><Probe /></BillingProvider>));
    expect(billing.canPurchase).toBe(true);
});
afterEach(async () => { await act(async () => root.unmount()); });
test.each([[{}, [], false], [{ other: {} }, [], true], [{}, ['subscription'], true]] as const)('restore examines returned access %p %p', async (active, subscriptions, expected) => {
    jest.mocked(Purchases.restorePurchases).mockResolvedValue(info(active, [...subscriptions]));
    await act(async () => { expect(await billing.restore()).toBe(expected); });
});
test('restore errors propagate', async () => {
    jest.mocked(Purchases.restorePurchases).mockRejectedValue(new Error('store unavailable'));
    await expect(billing.restore()).rejects.toThrow('store unavailable');
});
test.each(['cancelled', 'failed', 'bookkeeping', 'malformedInfo', 'success'])('purchase %s is classified by whether the store returned', async outcome => {
    const pkg = { product: { identifier: 'ai.veyrnox.credits.100' } } as any;
    if (outcome === 'cancelled' || outcome === 'failed') {
        jest.mocked(Purchases.purchasePackage).mockRejectedValue(Object.assign(new Error('store error'), { userCancelled: outcome === 'cancelled' }));
    } else {
        jest.mocked(Purchases.purchasePackage).mockResolvedValue({ customerInfo: outcome === 'malformedInfo' ? null : info() } as any);
        if (outcome === 'bookkeeping') jest.mocked(captureEvent).mockImplementation(event => { if (event === 'purchase_finished') throw new Error('analytics failed'); });
    }
    await act(async () => {
        if (outcome === 'failed') await expect(billing.purchase(pkg)).rejects.toThrow('store error');
        else await expect(billing.purchase(pkg)).resolves.toBe(outcome === 'cancelled' ? 'cancelled' : outcome === 'success' ? 'purchased' : 'pending');
    });
});
