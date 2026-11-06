import { act } from 'react';
import { AccessibilityInfo, ActivityIndicator, Pressable, Text, View } from 'react-native';
import { createRoot, type Root } from 'test-renderer';
import Paywall from '../src/app/(app)/paywall';

void [ActivityIndicator, Pressable, Text, View];
const mockBack = jest.fn();
const mockRetryOfferings = jest.fn();
const mockRefreshSales = jest.fn(async () => true);
let mockBilling: Record<string, unknown>;
jest.mock('expo-router', () => ({ Stack: { Screen: () => null }, useRouter: () => ({ back: mockBack, canGoBack: () => true }), useLocalSearchParams: () => ({ offering: 'generation' }) }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock('react-native-purchases-ui', () => ({ __esModule: true, default: { Paywall: () => null } }));
jest.mock('../src/auth/AuthProvider', () => ({ useAuth: () => ({ api: {} }) }));
jest.mock('../src/billing/BillingProvider', () => ({ useBilling: () => mockBilling }));
jest.mock('../src/billing/useStorePurchase', () => ({ useStorePurchase: () => ({ acquireAuxiliary: jest.fn() }) }));
jest.mock('../src/billing/paywallGate', () => ({ ...jest.requireActual('../src/billing/paywallGate'), paywallsEnabled: () => true }));
jest.mock('../src/components/VeyCharacter', () => ({ VeyCharacter: () => null }));

let root: Root;
const button = (label: string) => root.container.queryAll(n => n.props.accessibilityRole === 'button' && n.props.accessibilityLabel === label);
beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    jest.clearAllMocks();
    mockBilling = { status: 'unavailable', offerings: null, canPurchase: false, salesOpen: true, retryOfferings: mockRetryOfferings, refreshSales: mockRefreshSales };
    root = createRoot();
});
afterEach(async () => { await act(async () => root.unmount()); });

test('QA-008: when purchases are not ready the paywall offers Try again and Close and announces why', async () => {
    const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => undefined);
    await act(async () => root.render(<Paywall />));
    expect(announce).toHaveBeenCalledWith('Purchases are not ready yet. Try again in a moment.');
    const retry = button('Try again'), close = button('Close');
    expect(retry.length).toBeGreaterThan(0);
    expect(close.length).toBeGreaterThan(0);
    await act(async () => retry[0].props.onClick({ nativeEvent: {}, currentTarget: 1, target: 1 }));
    expect(mockRetryOfferings).toHaveBeenCalledTimes(1);
    expect(mockRefreshSales).toHaveBeenCalledTimes(1);
    await act(async () => close[0].props.onClick({ nativeEvent: {}, currentTarget: 1, target: 1 }));
    expect(mockBack).toHaveBeenCalledTimes(1);
});

test('sales closed also shows the escape hatch', async () => {
    mockBilling = { ...mockBilling, status: 'ready', salesOpen: false };
    await act(async () => root.render(<Paywall />));
    expect(button('Close').length).toBeGreaterThan(0);
    expect(button('Try again').length).toBeGreaterThan(0);
});
