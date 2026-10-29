import { act, useCallback } from 'react';
import { useFocusEffect } from 'expo-router';
const mockFocus = new Set<() => void>();
jest.mock('expo-router', () => ({ useFocusEffect: (cb: () => void) => require('react').useEffect(() => {
    mockFocus.add(cb); cb(); return () => { mockFocus.delete(cb); };
}, [cb]) }));
import { AppState, type AppStateStatus } from 'react-native';
import { createRoot, type Root } from 'test-renderer';
import Purchases from 'react-native-purchases';
import { captureEvent } from '../src/lib/analytics/events';

jest.mock('react-native-purchases', () => ({ __esModule: true, default: {
    configure: jest.fn(), addCustomerInfoUpdateListener: jest.fn(), getOfferings: jest.fn(async () => ({ all: {} })),
    getPromotionalOffer: jest.fn(), purchaseDiscountedPackage: jest.fn(), logIn: jest.fn(), logOut: jest.fn(), purchasePackage: jest.fn(), restorePurchases: jest.fn(),
} }));
const mockApi = { request: jest.fn(async (path: string) => path.includes('/customer') ? { rc_customer_id: 'customer', sales_open: true } : {}) };
let mockGeneration = 0;
const mockBeginSessionTask = () => { const gen = mockGeneration; return { gen, user: 'alice', current: () => gen === mockGeneration, tokens: async () => null }; };
jest.mock('../src/auth/AuthProvider', () => ({ useAuth: () => ({ status: 'signedIn', api: mockApi, generation: mockGeneration, beginSessionTask: mockBeginSessionTask }) }));
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
    jest.spyOn(AppState, 'addEventListener').mockImplementation(() => ({ remove: jest.fn() }));
    mockGeneration = 0;
    mockApi.request.mockReset().mockImplementation(async path => path.includes('/customer') ? { rc_customer_id: 'customer', sales_open: true } : {});
    jest.mocked(Purchases.getOfferings).mockReset().mockResolvedValue({ all: {}, current: null } as any);
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

const pack = { product: { identifier: 'ai.veyrnox.credits.100' } } as any;
const stay = { product: { identifier: 'ai.veyrnox.publish.monthly', price: 10, discounts: [{ identifier: 'stay15', price: 8.5 }] } } as any;
test('closed sales preserve Restore and disable purchases', async () => {
    mockApi.request.mockResolvedValue({ rc_customer_id: 'customer', sales_open: false });
    await act(async () => { await billing.refreshSales(); });
    expect(billing.canPurchase).toBe(false); expect(billing.canRestore).toBe(true);
    jest.mocked(Purchases.restorePurchases).mockResolvedValue(info());
    await act(async () => { await billing.restore(); });
    expect(Purchases.restorePurchases).toHaveBeenCalledTimes(1);
    expect(billing.canPurchase).toBe(false);
});
test.each(['purchase', 'purchaseStayOffer'] as const)('%s rechecks closed/failed sales even with a cached open state', async method => {
    jest.mocked(Purchases.getPromotionalOffer).mockResolvedValue({} as any);
    for (const fails of [false, true]) {
        mockApi.request.mockResolvedValue({ rc_customer_id: 'customer', sales_open: true });
        await act(async () => { await billing.refreshSales(); });
        expect(billing.canPurchase).toBe(true);
        if (fails) mockApi.request.mockRejectedValue(new Error('offline'));
        else mockApi.request.mockResolvedValue({ rc_customer_id: 'customer', sales_open: false });
        await act(async () => { await expect(billing[method](method === 'purchase' ? pack : stay)).rejects.toThrow('sales_closed'); });
        expect(billing.canPurchase).toBe(false);
        expect(Purchases.purchasePackage).not.toHaveBeenCalled();
        expect(Purchases.purchaseDiscountedPackage).not.toHaveBeenCalled();
        expect(mockApi.request).toHaveBeenLastCalledWith('/api/v1/store-purchases/customer', { cache: 'no-store' }, { task: expect.objectContaining({ gen: 0 }) });
    }
});
test('discounted purchase checks after obtaining the promotional offer', async () => {
    const order: string[] = [];
    jest.mocked(Purchases.getPromotionalOffer).mockImplementation(async () => { order.push('offer'); return {} as any; });
    mockApi.request.mockImplementation(async () => { order.push('sales'); return { rc_customer_id: 'customer', sales_open: true }; });
    jest.mocked(Purchases.purchaseDiscountedPackage).mockImplementation(async () => { order.push('purchase'); return { customerInfo: info() } as any; });
    await act(async () => { expect(await billing.purchaseStayOffer(stay)).toBe('purchased'); });
    expect(order).toEqual(['offer', 'sales', 'purchase']);
});
test('foreground closed-open-closed-open refreshes without sign-out or rebinding', async () => {
    const listeners: ((state: AppStateStatus) => void)[] = [];
    const remove = jest.fn();
    const spy = jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, listener) => { listeners.push(listener); return { remove }; });
    await act(async () => { root.unmount(); });
    root = createRoot(); await act(async () => root.render(<BillingProvider><Probe /></BillingProvider>));
    const logins = jest.mocked(Purchases.logIn).mock.calls.length;
    for (const sales_open of [false, true, false, true]) {
        mockApi.request.mockResolvedValue({ rc_customer_id: 'customer', sales_open });
        await act(async () => { listeners.at(-1)!('active'); });
        expect(billing.salesOpen).toBe(sales_open); expect(billing.canPurchase).toBe(sales_open);
        expect(billing.canRestore).toBe(true);
    }
    expect(Purchases.logIn).toHaveBeenCalledTimes(logins);
    await act(async () => root.unmount()); expect(remove).toHaveBeenCalled(); spy.mockRestore();
});
test('late sales reads cannot update another session or purchase under it', async () => {
    let resolve!: (v: any) => void;
    mockApi.request.mockImplementation(() => new Promise(done => { resolve = done; }));
    let purchase!: Promise<unknown>;
    await act(async () => { purchase = billing.purchase(pack); });
    mockGeneration++;
    await act(async () => { resolve({ rc_customer_id: 'customer', sales_open: true }); await expect(purchase).rejects.toThrow('sales_closed'); });
    expect(Purchases.purchasePackage).not.toHaveBeenCalled();
});
test.each(['missing', 'null-products', 'error'])('catalog %s is empty or unavailable', async kind => {
    await act(async () => root.unmount());
    if (kind === 'error') jest.mocked(Purchases.getOfferings).mockRejectedValue(new Error('unavailable'));
    else jest.mocked(Purchases.getOfferings).mockResolvedValue({ current: null, all: kind === 'missing' ? {} : {
        credits: { availablePackages: [{ identifier: 'empty', product: null }] },
    } } as any);
    root = createRoot(); await act(async () => root.render(<BillingProvider><Probe /></BillingProvider>));
    expect(billing.offerings?.all.credits?.availablePackages ?? []).toEqual([]);
    expect(billing.status).toBe(kind === 'error' ? 'unavailable' : 'ready');
});

test('focus refresh reopens and recloses sales without rebinding or sign-out', async () => {
    function FocusProbe() {
        const { refreshSales } = useBilling();
        useFocusEffect(useCallback(() => { void refreshSales(); }, [refreshSales]));
        return null;
    }
    await act(async () => root.render(<BillingProvider><Probe /><FocusProbe /></BillingProvider>));
    const logins = jest.mocked(Purchases.logIn).mock.calls.length;
    for (const sales_open of [false, true, false, true]) {
        mockApi.request.mockResolvedValue({ rc_customer_id: 'customer', sales_open });
        await act(async () => { for (const focus of mockFocus) focus(); });
        expect(billing.canPurchase).toBe(sales_open); expect(billing.canRestore).toBe(true);
    }
    expect(Purchases.logIn).toHaveBeenCalledTimes(logins); expect(Purchases.logOut).not.toHaveBeenCalled();
});
