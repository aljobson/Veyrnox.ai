import { act, useEffect } from 'react';
import * as RN from 'react-native';
import { createRoot, type Root } from 'test-renderer';
import Publish from '../src/app/(app)/(tabs)/publish';
import { t } from '../src/lib/i18n';
import { textOf } from './publishDepthTestHelpers';
const mockBaseRequest = jest.fn(), mockBrandRequest = jest.fn();
const mockBaseApi = { request: mockBaseRequest }, mockApi = { request: mockBrandRequest };
jest.mock('../src/auth/AuthProvider', () => ({ useAuth: () => ({ api: mockBaseApi }) }));
jest.mock('../src/lib/usePublishApi', () => ({ usePublishApi: () => mockApi }));
jest.mock('../src/billing/BillingProvider', () => ({ useBilling: () => ({ status: 'ready', publishActive: false, offerings: null, canPurchase: false, canRestore: true, refreshSales: jest.fn() }) }));
jest.mock('expo-router', () => ({ Stack: { Screen: () => null }, useRouter: () => ({ push: jest.fn() }), useFocusEffect: (fn: () => void) => require('react').useEffect(fn, [fn]) }));
jest.mock('expo-image', () => ({ Image: () => null }));
jest.mock('../src/components/VeyCardPeek', () => ({ VeyCardPeek: () => null, peekRoom: () => ({}) }));
jest.mock('../src/lib/appCache', () => ({ getCacheUser: () => 'owner', subscribeCacheUser: () => () => {} }));
void [useEffect, RN.Text, RN.View, RN.ScrollView, RN.ActivityIndicator, RN.Pressable, RN.StyleSheet, RN.RefreshControl];
let root: Root;
beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; root = createRoot(); jest.clearAllMocks();
    mockBrandRequest.mockImplementation(async (url: string) => url.endsWith('/accounts') ? { brandRole: 'owner', planTier: 'publish', plansEnabled: true, accounts: [] } : { posts: [] });
    mockBaseRequest.mockImplementation(async () => ({ brands: [] }));
});
afterEach(async () => { await act(async () => root.unmount()); });
test.each(['store', 'stripe', null, 'free', 'failure'])('management source %s appears only for a known own publish plan', async source => {
    mockBaseRequest.mockImplementation(async (url: string) => {
        if (url.endsWith('/plan')) {
            if (source === 'failure') throw new Error('offline');
            return { entitlement: { tier: source === 'free' ? 'free' : 'publish', subscription: { source } } };
        }
        return { brands: [] };
    });
    await act(async () => root.render(<Publish />));
    const text = textOf(root.container);
    expect(mockBaseRequest).toHaveBeenCalledWith('/api/v1/social/plan');
    expect(mockBrandRequest.mock.calls.some(([url]) => url.endsWith('/plan'))).toBe(false);
    for (const [value, key] of [['store', 'publishWorkflows.manageStore'], ['stripe', 'publishWorkflows.manageWeb']]) {
        expect(text.includes(t(key))).toBe(source === value);
    }
});
test('plans disabled does not fetch the management source', async () => {
    mockBrandRequest.mockResolvedValue({ plansEnabled: false, planTier: 'publish', accounts: [] });
    await act(async () => root.render(<Publish />)); expect(mockBaseRequest.mock.calls.some(([url]) => url.endsWith('/plan'))).toBe(false);
});
