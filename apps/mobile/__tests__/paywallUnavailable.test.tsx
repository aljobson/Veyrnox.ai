import { act } from 'react';
import { AccessibilityInfo, ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
import { createRoot, type Root } from 'test-renderer';
import Paywall from '../src/app/(app)/paywall';

void [ActivityIndicator, Pressable, Text, View];
const mockNativePaywall = jest.fn(() => null);
let nativeProps: any;
const mockRedirect = jest.fn((_props: unknown) => null);
const mockBack = jest.fn();
const mockReplace = jest.fn();
let mockCanGoBack = true;
let mockPaywallsEnabled = true;
const mockRetryOfferings = jest.fn();
const mockRefreshSales = jest.fn(async () => true);
let mockBilling: Record<string, unknown>;
jest.mock('expo-router', () => ({ Redirect: (props: unknown) => mockRedirect(props), Stack: { Screen: () => null }, useRouter: () => ({ back: mockBack, replace: mockReplace, canGoBack: () => mockCanGoBack }), useLocalSearchParams: () => ({ offering: 'generation' }) }));
jest.mock('react-native-safe-area-context', () => ({ ...jest.requireActual('react-native-safe-area-context'), useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock('react-native-purchases-ui', () => ({ __esModule: true, default: { Paywall: (props: unknown) => { nativeProps = props; return mockNativePaywall(); } } }), { virtual: true });
jest.mock('../src/auth/AuthProvider', () => ({ useAuth: () => ({ api: {} }) }));
jest.mock('../src/billing/BillingProvider', () => ({ useBilling: () => mockBilling }));
const mockStartExternal = jest.fn();
const mockAbortPreparing = jest.fn();
jest.mock('../src/billing/useStorePurchase', () => ({ useStorePurchase: () => ({
    startExternal: mockStartExternal, abortPreparing: mockAbortPreparing, busy: false, viewState: { tag: 'ready' },
    actions: { buy: true, restore: true, manage: true, retry: false, close: true },
}) }));
jest.mock('../src/billing/paywallGate', () => ({ ...jest.requireActual('../src/billing/paywallGate'), paywallsEnabled: () => mockPaywallsEnabled }));
jest.mock('../src/components/VeyCharacter', () => ({ VeyCharacter: () => null }));

let root: Root;
const button = (label: string) => root.container.queryAll(n => n.props.accessibilityRole === 'button' && n.props.accessibilityLabel === label);
beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    jest.clearAllMocks();
    mockCanGoBack = true;
    mockPaywallsEnabled = true;
    nativeProps = undefined;
    mockBilling = { status: 'unavailable', offerings: null, canPurchase: false, canRestore: false, salesOpen: true,
        generationActive: false, generationAccessResolved: true, publishActive: false, publishAccessResolved: true,
        generationSource: null, generationPeriodEnd: null, publishSource: null, publishPeriodEnd: null,
        retryOfferings: mockRetryOfferings, refreshSales: mockRefreshSales, refreshGenerationAccess: jest.fn(async () => false), refreshAccess: jest.fn(async () => true),
        applyCustomerInfo: jest.fn(() => true), managementURL: null };
    root = createRoot();
});
afterEach(async () => { await act(async () => root.unmount()); });

test('QA-008: when purchases are not ready the paywall offers Try again and Close and announces why', async () => {
    const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => undefined);
    await act(async () => root.render(<Paywall />));
    expect(announce).toHaveBeenCalledTimes(1);
    expect(announce).toHaveBeenCalledWith('Purchases are not ready yet. Try again in a moment.');
    const retry = button('Try again'), close = button('Close');
    expect(root.container.queryAll(n => n.props.testID === 'purchase-state-unavailable')).toHaveLength(1);
    expect(root.container.queryAll(n => n.props.contentInsetAdjustmentBehavior === 'automatic')).toHaveLength(1);
    expect(retry.length).toBeGreaterThan(0);
    expect(close.length).toBeGreaterThan(0);
    await act(async () => retry[0].props.onClick({ nativeEvent: {}, currentTarget: 1, target: 1 }));
    expect(mockRetryOfferings).toHaveBeenCalledTimes(1);
    expect(mockRefreshSales).toHaveBeenCalledTimes(1);
    await act(async () => close[0].props.onClick({ nativeEvent: {}, currentTarget: 1, target: 1 }));
    expect(mockBack).toHaveBeenCalledTimes(1);
});

test('unavailable paywall fallback keeps its controls inside landscape side and bottom insets', async () => {
    await act(async () => root.render(
        <SafeAreaInsetsContext.Provider value={{ top: 0, right: 59, bottom: 21, left: 59 }}><Paywall /></SafeAreaInsetsContext.Provider>,
    ));
    expect(root.container.queryAll(node => {
        const style = StyleSheet.flatten(node.props.contentContainerStyle);
        return style?.paddingLeft === 83 && style?.paddingRight === 83 && style?.paddingBottom === 45;
    })).toHaveLength(1);
    expect(button('Try again').length).toBeGreaterThan(0);
    expect(button('Close').length).toBeGreaterThan(0);
});

test('sales closed also shows the escape hatch', async () => {
    mockBilling = { ...mockBilling, status: 'ready', salesOpen: false };
    await act(async () => root.render(<Paywall />));
    expect(button('Close').length).toBeGreaterThan(0);
    expect(button('Try again').length).toBeGreaterThan(0);
});

test('Close stays visible while a retry is loading', async () => {
    const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => undefined);
    mockBilling = { ...mockBilling, status: 'loading' };
    await act(async () => root.render(<Paywall />));
    expect(root.container.queryAll(n => n.props.testID === 'purchase-state-loading')).toHaveLength(1);
    expect(announce).toHaveBeenCalledWith('Loading');
    expect(button('Close').length).toBeGreaterThan(0);
});

test('Close falls back to the credits screen when there is no history (cold deep link)', async () => {
    mockCanGoBack = false;
    await act(async () => root.render(<Paywall />));
    await act(async () => button('Close')[0].props.onClick({ nativeEvent: {}, currentTarget: 1, target: 1 }));
    expect(mockBack).not.toHaveBeenCalled();
    expect(mockReplace).toHaveBeenCalledWith('/credits');
});

test('a build with dashboard paywalls disabled shows a terminal state without spinner or busy semantics', async () => {
    mockPaywallsEnabled = false;
    await act(async () => root.render(<Paywall />));
    const state = root.container.queryAll(n => n.props.testID === 'purchase-state-unavailable');
    expect(state).toHaveLength(1);
    expect(state[0].props.accessibilityState).toEqual({ busy: false });
    expect(root.container.queryAll(n => n.props.testID === 'purchase-state-spinner')).toHaveLength(0);
    expect(button('Try again')).toHaveLength(0);
    expect(button('Close')).toHaveLength(1);
});

test.each([true, false])('native paywall routes retired offerings to filtered custom Credits: %s', async retired => {
    const families = retired ? ['lite', 'starter', 'plus', 'ultra'] : ['lite', 'starter', 'plus'];
    mockBilling = { ...mockBilling, status: 'ready', canPurchase: true, offerings: { all: { generation: { availablePackages: families.map(f => ({ product: { identifier: `ai.veyrnox.generation.${f}.monthly` } })) } } } };
    await act(async () => root.render(<Paywall />));
    if (retired) {
        expect(mockRedirect).toHaveBeenCalledWith({ href: '/credits' });
        expect(mockNativePaywall).not.toHaveBeenCalled();
    } else {
        expect(mockRedirect).not.toHaveBeenCalled();
        expect(mockNativePaywall).toHaveBeenCalled();
    }
});

test('an active Generation subscriber sees status and management instead of acquisition', async () => {
    mockBilling = { ...mockBilling, status: 'ready', canPurchase: true, generationActive: true, generationSource: 'web', generationPeriodEnd: '2026-12-01T00:00:00Z',
        offerings: { all: { generation: { availablePackages: [] } } } };
    await act(async () => root.render(<Paywall />));
    expect(mockNativePaywall).not.toHaveBeenCalled();
    expect(root.container.queryAll(n => n.props.contentInsetAdjustmentBehavior === 'automatic')).toHaveLength(1);
    expect(root.container.queryAll(n => n.props.accessibilityRole === 'header' && n.children.join('').includes('AI Generation plan is active'))).toHaveLength(1);
    const manage = button('Manage web subscription');
    expect(manage).toHaveLength(1);
    await act(async () => manage[0].props.onClick({ nativeEvent: {}, currentTarget: 1, target: 1 }));
    expect(mockReplace).toHaveBeenCalledWith('/credits');
});

test('an unresolved access check is retryable and never becomes a permanent spinner', async () => {
    mockBilling = { ...mockBilling, status: 'ready', canPurchase: true, generationAccessResolved: false,
        offerings: { all: { generation: { availablePackages: [] } } } };
    await act(async () => root.render(<Paywall />));
    expect(root.container.queryAll(n => n.props.testID === 'purchase-state-spinner')).toHaveLength(0);
    expect(root.container.queryAll(n => n.props.testID === 'purchase-state-unavailable')).toHaveLength(1);
    await act(async () => button('Try again')[0].props.onClick({ nativeEvent: {}, currentTarget: 1, target: 1 }));
    expect(mockBilling.refreshAccess).toHaveBeenCalledTimes(1);
});

test('dashboard initiation acquires the shared operation before resuming StoreKit', async () => {
    const packageBeingPurchased = { identifier: 'starter', product: { identifier: 'ai.veyrnox.generation.starter.monthly', priceString: '£9.99' } };
    const operation = { opId: 41, kind: 'plan', ready: Promise.resolve(true), markStore: jest.fn(() => true), complete: jest.fn(), finish: jest.fn(), abort: jest.fn() };
    mockStartExternal.mockReturnValue(operation);
    mockBilling = { ...mockBilling, status: 'ready', canPurchase: true,
        offerings: { all: { generation: { availablePackages: [packageBeingPurchased] } } } };
    await act(async () => root.render(<Paywall />));
    const resume = jest.fn();
    await act(async () => { nativeProps.onPurchasePackageInitiated({ packageBeingPurchased, resume }); await Promise.resolve(); });
    expect(mockStartExternal).toHaveBeenCalledWith({ kind: 'plan', pkg: packageBeingPurchased });
    expect(operation.markStore).toHaveBeenCalledTimes(1);
    expect(resume).toHaveBeenCalledWith(true);
});

test('a busy shared operation refuses the dashboard purchase exactly once', async () => {
    const packageBeingPurchased = { identifier: 'starter', product: { identifier: 'ai.veyrnox.generation.starter.monthly', priceString: '£9.99' } };
    mockStartExternal.mockReturnValue('busy');
    mockBilling = { ...mockBilling, status: 'ready', canPurchase: true,
        offerings: { all: { generation: { availablePackages: [packageBeingPurchased] } } } };
    await act(async () => root.render(<Paywall />));
    const resume = jest.fn();
    await act(async () => nativeProps.onPurchasePackageInitiated({ packageBeingPurchased, resume }));
    expect(resume).toHaveBeenCalledTimes(1);
    expect(resume).toHaveBeenCalledWith(false);
});

test('dashboard completion applies RevenueCat state and completes the matching shared operation', async () => {
    const packageBeingPurchased = { identifier: 'starter', product: { identifier: 'ai.veyrnox.generation.starter.monthly', priceString: '£9.99' } };
    const complete = jest.fn(async () => ({ kind: 'subscribed' }));
    const operation = { opId: 42, kind: 'plan', ready: Promise.resolve(true), markStore: jest.fn(() => true), complete, finish: jest.fn(), abort: jest.fn() };
    mockStartExternal.mockReturnValue(operation);
    mockBilling = { ...mockBilling, status: 'ready', canPurchase: true,
        offerings: { all: { generation: { availablePackages: [packageBeingPurchased] } } } };
    await act(async () => root.render(<Paywall />));
    await act(async () => { nativeProps.onPurchasePackageInitiated({ packageBeingPurchased, resume: jest.fn() }); await Promise.resolve(); });
    const customerInfo = { entitlements: { active: {} }, activeSubscriptions: [packageBeingPurchased.product.identifier] };
    await act(async () => {
        nativeProps.onPurchaseCompleted({ customerInfo, storeTransaction: { productIdentifier: packageBeingPurchased.product.identifier } });
        await Promise.resolve();
    });
    expect(mockBilling.applyCustomerInfo).toHaveBeenCalledWith(customerInfo);
    expect(complete).toHaveBeenCalledWith(packageBeingPurchased.product.identifier);
});

test('an unapplied CustomerInfo ends the live purchase as pending instead of keeping the app locked', async () => {
    const packageBeingPurchased = { identifier: 'starter', product: { identifier: 'ai.veyrnox.generation.starter.monthly', priceString: '£9.99' } };
    const finish = jest.fn((outcome: unknown) => outcome), complete = jest.fn();
    const operation = { opId: 45, kind: 'plan', ready: Promise.resolve(true), markStore: jest.fn(() => true), complete, finish, abort: jest.fn() };
    mockStartExternal.mockReturnValue(operation);
    mockBilling = { ...mockBilling, status: 'ready', canPurchase: true, applyCustomerInfo: jest.fn(() => false),
        offerings: { all: { generation: { availablePackages: [packageBeingPurchased] } } } };
    await act(async () => root.render(<Paywall />));
    await act(async () => { nativeProps.onPurchasePackageInitiated({ packageBeingPurchased, resume: jest.fn() }); await Promise.resolve(); });
    await act(async () => nativeProps.onPurchaseCompleted({ customerInfo: {}, storeTransaction: { productIdentifier: packageBeingPurchased.product.identifier } }));
    expect(finish).toHaveBeenCalledWith({ kind: 'pending' });
    expect(complete).not.toHaveBeenCalled();
});

test('an unapplied CustomerInfo still confirms a purchased credit pack from the server balance', async () => {
    const packageBeingPurchased = { identifier: 'pack', product: { identifier: 'ai.veyrnox.credits.156', priceString: '£9.99' } };
    const complete = jest.fn(async () => ({ kind: 'credited', balance: 156, credits: 156, price: '£9.99' }));
    const operation = { opId: 46, kind: 'pack', ready: Promise.resolve(true), markStore: jest.fn(() => true), complete, finish: jest.fn(), abort: jest.fn() };
    mockStartExternal.mockReturnValue(operation);
    mockBilling = { ...mockBilling, status: 'ready', canPurchase: true, applyCustomerInfo: jest.fn(() => false),
        offerings: { all: { generation: { availablePackages: [packageBeingPurchased] } } } };
    await act(async () => root.render(<Paywall />));
    await act(async () => { nativeProps.onPurchasePackageInitiated({ packageBeingPurchased, resume: jest.fn() }); await Promise.resolve(); });
    await act(async () => { nativeProps.onPurchaseCompleted({ customerInfo: {}, storeTransaction: { productIdentifier: packageBeingPurchased.product.identifier } }); await Promise.resolve(); });
    expect(complete).toHaveBeenCalledWith(packageBeingPurchased.product.identifier);
});

test('a failed external preparation shows failure feedback and never resumes StoreKit', async () => {
    const packageBeingPurchased = { identifier: 'pack', product: { identifier: 'ai.veyrnox.credits.156', priceString: '£9.99' } };
    const operation = { opId: 47, kind: 'pack', ready: Promise.resolve(false), markStore: jest.fn(), complete: jest.fn(), finish: jest.fn(), abort: jest.fn() };
    mockStartExternal.mockReturnValue(operation);
    mockBilling = { ...mockBilling, status: 'ready', canPurchase: true,
        offerings: { all: { generation: { availablePackages: [packageBeingPurchased] } } } };
    await act(async () => root.render(<Paywall />));
    const resume = jest.fn();
    await act(async () => { nativeProps.onPurchasePackageInitiated({ packageBeingPurchased, resume }); await Promise.resolve(); });
    expect(resume).toHaveBeenCalledWith(false);
    expect(operation.markStore).not.toHaveBeenCalled();
    expect(root.container.queryAll(n => n.props.children === "That didn't go through. Try again in a moment.")).toHaveLength(1);
});

test.each([['20', 'pending'], ['1', 'cancelled'], ['2', 'error']] as const)('dashboard error code %s records %s', async (code, kind) => {
    const packageBeingPurchased = { identifier: 'starter', product: { identifier: 'ai.veyrnox.generation.starter.monthly', priceString: '£9.99' } };
    const finish = jest.fn((outcome: unknown) => outcome);
    const operation = { opId: 43, kind: 'plan', ready: Promise.resolve(true), markStore: jest.fn(() => true), complete: jest.fn(), finish, abort: jest.fn() };
    mockStartExternal.mockReturnValue(operation);
    mockBilling = { ...mockBilling, status: 'ready', canPurchase: true,
        offerings: { all: { generation: { availablePackages: [packageBeingPurchased] } } } };
    await act(async () => root.render(<Paywall />));
    await act(async () => { nativeProps.onPurchasePackageInitiated({ packageBeingPurchased, resume: jest.fn() }); await Promise.resolve(); });
    await act(async () => nativeProps.onPurchaseError({ error: { code } }));
    expect(finish).toHaveBeenCalledWith({ kind });
});

test.each([true, false])('dashboard restore reports restored=%s through the shared operation', async restored => {
    const packageBeingPurchased = { identifier: 'starter', product: { identifier: 'ai.veyrnox.generation.starter.monthly', priceString: '£9.99' } };
    const complete = jest.fn(async (_product: string | undefined, value: boolean) => ({ kind: value ? 'restored' : 'nothingToRestore' }));
    const operation = { opId: 44, kind: 'restore', ready: Promise.resolve(true), markStore: jest.fn(() => true), complete, finish: jest.fn(), abort: jest.fn() };
    mockStartExternal.mockReturnValue(operation);
    mockBilling = { ...mockBilling, status: 'ready', canPurchase: true, canRestore: true,
        offerings: { all: { generation: { availablePackages: [packageBeingPurchased] } } } };
    await act(async () => root.render(<Paywall />));
    await act(async () => { nativeProps.onRestoreStarted(); await Promise.resolve(); });
    const customerInfo = { entitlements: { active: restored ? { generation: {} } : {} }, activeSubscriptions: [] };
    await act(async () => { nativeProps.onRestoreCompleted({ customerInfo }); await Promise.resolve(); });
    expect(mockStartExternal).toHaveBeenCalledWith({ kind: 'restore' });
    expect(complete).toHaveBeenCalledWith(undefined, restored);
});

test('a RevenueCat restore that could not acquire the app lock still applies its successful CustomerInfo', async () => {
    const packageBeingPurchased = { identifier: 'starter', product: { identifier: 'ai.veyrnox.generation.starter.monthly', priceString: '£9.99' } };
    mockStartExternal.mockReturnValue('busy');
    mockBilling = { ...mockBilling, status: 'ready', canPurchase: true, canRestore: true,
        offerings: { all: { generation: { availablePackages: [packageBeingPurchased] } } } };
    await act(async () => root.render(<Paywall />));
    await act(async () => nativeProps.onRestoreStarted());
    const customerInfo = { entitlements: { active: { generation: {} } }, activeSubscriptions: [] };
    await act(async () => nativeProps.onRestoreCompleted({ customerInfo }));
    expect(mockBilling.applyCustomerInfo).toHaveBeenCalledWith(customerInfo);
});
