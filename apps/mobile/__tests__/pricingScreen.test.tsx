import { act } from 'react';
import * as RN from 'react-native';
import { createRoot, type Root, type TestInstance } from 'test-renderer';
import Pricing from '../src/app/(app)/pricing';
import { setLocaleFromDevice } from '../src/lib/i18n';
const mockAll = jest.fn(async () => [{ id: 'premium', name: 'Premium fixture', modality: 'image', gated: true, credits: 10, capabilities: null, durations: [] }]);
const mockSupported = jest.fn(async () => []);
const mockBilling = { status: 'ready', offerings: { all: {
    generation: { availablePackages: [{ identifier: 'monthly', product: { identifier: 'ai.veyrnox.generation.starter.monthly', title: 'Starter', priceString: '£10.00' } }] },
    credits: { availablePackages: [{ identifier: 'pack', product: { identifier: 'ai.veyrnox.credits.100', title: 'Pack', priceString: '£10.00' } }] },
} } };
const mockApi = { request: async () => ({ plans: [] }) };
jest.mock('../src/billing/BillingProvider', () => ({ useBilling: () => mockBilling }));
jest.mock('../src/auth/AuthProvider', () => ({ useAuth: () => ({ api: mockApi }) }));
jest.mock('../src/lib/media', () => ({ ...jest.requireActual('../src/lib/media'), fetchAllCatalog: () => mockAll(), fetchCatalog: () => mockSupported() }));
jest.mock('../src/components/VeyCardPeek', () => ({ VeyCardPeek: () => null, peekRoom: () => 0 }));
jest.mock('expo-router', () => ({ Stack: { Screen: () => null } }));
void [RN.View, RN.Text, RN.Pressable, RN.ScrollView, RN.ActivityIndicator];
let root: Root;
const textOf = (node: TestInstance): string => node.children.map(c => typeof c === 'string' ? c : textOf(c)).join('');
beforeEach(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; setLocaleFromDevice(['en']); mockBilling.status = 'ready'; mockAll.mockClear(); mockSupported.mockClear(); root = createRoot(); });
afterEach(async () => act(async () => root.unmount()));
test('shows gated models with a non-pressable Premium chip and read-only offers', async () => {
    await act(async () => root.render(<Pricing />)); const text = textOf(root.container);
    expect(text).toContain('Premium fixture'); expect(text).toContain('Premium model'); expect(text).toContain('Monthly subscriptions'); expect(text).toContain('One-off credit packs');
    expect(mockAll).toHaveBeenCalledTimes(1); expect(mockSupported).not.toHaveBeenCalled();
    expect(root.container.queryAll(n => n.props.accessibilityRole === 'button' || n.props.accessibilityRole === 'radio')).toHaveLength(0);
});
test.each(['off', 'loading', 'unavailable'])('billing %s hides offer sections, leaving catalog visible', async status => {
    mockBilling.status = status; await act(async () => root.render(<Pricing />)); const text = textOf(root.container);
    expect(text).not.toContain('Monthly subscriptions'); expect(text).not.toContain('One-off credit packs'); expect(text).toContain('Premium model');
});
