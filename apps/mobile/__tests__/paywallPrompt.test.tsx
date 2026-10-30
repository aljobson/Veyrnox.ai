import { act } from 'react';
import * as RN from 'react-native';
import { createRoot, type Root, type TestInstance } from 'test-renderer';
import { PaywallPrompt } from '../src/components/PaywallPrompt';
import Credits from '../src/app/(app)/credits';
import { bindCacheUser, getCacheUser, wipeCache } from '../src/lib/appCache';
import { publishBalance } from '../src/lib/balanceEvents';
import { getPurchaseSnapshot, startPurchase } from '../src/billing/storePurchaseStore';
import { playError, playSelection, playSuccess } from '../src/lib/haptics';
import { useAnnouncement } from '../src/lib/useAnnouncement';
import { LEGAL_LINKS } from '../src/lib/account';
import { setLocaleFromDevice, t } from '../src/lib/i18n';
const pkg = (id: string, product: string, price: number) => ({ identifier: id, product: { identifier: product, title: id, price, priceString: `£${price}.00`, currencyCode: 'GBP' } });
const packs = [pkg('small', 'ai.veyrnox.credits.100', 10), pkg('medium', 'ai.veyrnox.credits.300', 25), pkg('best', 'ai.veyrnox.credits.1000', 70)];
const plans = [pkg('starter', 'ai.veyrnox.generation.starter.monthly', 10), pkg('annual', 'ai.veyrnox.generation.starter.annual', 100)];
let mockBalance = 0, mockGeneration = 1, mockPath = '/', mockCreated = new Date().toISOString();
const mockPush = jest.fn();
const mockBegin = () => { const gen = mockGeneration, user = getCacheUser(); return { gen, user: user ?? null, tokens: {} as any, current: () => gen === mockGeneration && user === getCacheUser() }; };
const mockApi = { getBalance: jest.fn(async () => ({ balance: mockBalance, free_credits: 0, free_expires_at: null })), request: jest.fn(async (path: string) => {
    if (path === '/api/v1/account') return { created_at: mockCreated };
    if (path === '/api/v1/subscriptions') return { subscription: null };
    return { plans: [{ id: 'starter-monthly', credits: 200 }] };
}) };
const mockBilling = { status: 'ready', canPurchase: true, canRestore: true, paidAccess: false, generationActive: false,
    generationPurchaseReady: true, generationAccessResolved: true, refreshSales: jest.fn(async () => true), refreshGenerationAccess: jest.fn(async () => false),
    offerings: { all: { credits: { availablePackages: packs }, generation: { availablePackages: plans } } },
    purchase: jest.fn(), restore: jest.fn(async () => true) };
jest.mock('../src/auth/AuthProvider', () => ({ useAuth: () => ({ api: mockApi, generation: mockGeneration, beginSessionTask: mockBegin }) }));
jest.mock('../src/billing/BillingProvider', () => ({ useBilling: () => mockBilling }));
jest.mock('../src/lib/firstRunPending', () => ({ useFirstRunPending: () => false }));
jest.mock('../src/lib/haptics', () => ({ playSelection: jest.fn(), playSuccess: jest.fn(), playError: jest.fn() }));
jest.mock('../src/lib/useAnnouncement', () => ({ ...jest.requireActual('../src/lib/useAnnouncement'), useAnnouncement: jest.fn() }));
jest.mock('../src/lib/media', () => ({ ...jest.requireActual('../src/lib/media'), fetchCatalog: async () => [] }));
jest.mock('expo-router', () => ({ usePathname: () => mockPath, useRouter: () => ({ push: mockPush }), router: { push: mockPush },
    Stack: { Screen: () => null }, Link: ({ children }: any) => children, useFocusEffect: (fn: any) => require('react').useEffect(fn, [fn]) }));
jest.mock('../src/components/VeyCharacter', () => ({ VeyCharacter: ({ mood, interactive }: any) => {
    const { Pressable } = require('react-native'); return <Pressable accessibilityRole={interactive ? 'button' : undefined} accessibilityLabel="Vey" testID={`vey-${mood}`} />;
} }));
jest.mock('../src/components/VeyCardPeek', () => ({ VeyCardPeek: () => null, peekRoom: () => 0 }));
void [RN.Modal, RN.Pressable, RN.Text, RN.View, RN.ScrollView];
let root: Root, serial = 0;
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }
const textOf = (node: TestInstance): string => node.props.accessibilityElementsHidden ? '' : node.children.map(c => typeof c === 'string' ? c : textOf(c)).join('');
const text = () => textOf(root.container);
const nodes = (role: string) => root.container.queryAll(n => n.props.accessibilityRole === role);
const button = (label: string) => nodes('button').find(n => n.props.accessibilityLabel === label)!;
const mood = (value: string) => root.container.queryAll(n => n.props.testID === `vey-${value}`).length > 0;
async function click(node: TestInstance) { expect(node).toBeDefined(); await act(async () => node.props.onClick?.({ nativeEvent: {}, currentTarget: 1, target: 1 })); }
async function press(label: string) { await click(button(label)); }
async function mount() { await act(async () => root.render(<PaywallPrompt />)); }
async function balance(value: number) { mockBalance = value; await act(async () => publishBalance(getCacheUser()!, value)); }
const buy = () => nodes('button').find(n => n.props.accessibilityLabel?.startsWith('Buy ') || n.props.accessibilityLabel?.startsWith('Start '))!;
const tick = async (ms: number) => { await act(async () => jest.advanceTimersByTimeAsync(ms)); };
beforeEach(async () => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; jest.useFakeTimers(); jest.clearAllMocks(); setLocaleFromDevice(['en']);
    await wipeCache(); await bindCacheUser(`paywall-${++serial}`); mockGeneration++; mockBalance = 0; mockPath = '/'; mockCreated = new Date().toISOString();
    mockBilling.status = 'ready'; mockBilling.canPurchase = true; mockBilling.canRestore = true; mockBilling.paidAccess = false;
    mockBilling.offerings = { all: { credits: { availablePackages: packs }, generation: { availablePackages: plans } } };
    mockBilling.purchase.mockReset().mockResolvedValue('cancelled');
    mockApi.getBalance.mockReset().mockImplementation(async () => ({ balance: mockBalance, free_credits: 0, free_expires_at: null }));
    jest.spyOn(RN.AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(false);
    root = createRoot();
});
afterEach(async () => { await act(async () => root.unmount()); await wipeCache(); jest.clearAllTimers(); jest.useRealTimers(); jest.restoreAllMocks(); });
test('depleted shows store prices, best radio, interactive Vey, selection and an in-place purchase', async () => {
    await mount(); expect(text()).toContain(t('credits.paywall.emptyTitle')); expect(mood('worried')).toBe(true); expect(button('Vey')).toBeDefined();
    const radios = nodes('radio'); expect(radios).toHaveLength(3); expect(radios[2].props.accessibilityState.selected).toBe(true);
    expect(text()).toContain('£70.00'); await click(radios[0]); expect(playSelection).toHaveBeenCalledTimes(1);
    expect(nodes('radio')[0].props.accessibilityState.selected).toBe(true); expect(mood('hop')).toBe(true);
    await click(buy()); expect(mockBilling.purchase).toHaveBeenCalledWith(packs[0]); expect(mockPush).not.toHaveBeenCalled();
    expect(text()).toContain(t('credits.cancelled')); expect(mood('worried')).toBe(true); expect(button(t('credits.paywall.later'))).toBeDefined();
});
test('success announces, claps then cheers for 1.5s, suppresses first/low and ignores the retained outcome next cycle', async () => {
    await mount(); mockBilling.purchase.mockImplementation(async () => { mockBalance = 1000; return 'purchased'; });
    await click(buy()); expect(mood('clap')).toBe(true); expect(playSuccess).toHaveBeenCalledTimes(1);
    expect(useAnnouncement).toHaveBeenCalledWith(t('credits.added', { balance: 1000 }));
    await tick(700); expect(mood('cheer')).toBe(true); await tick(799); expect(button(t('credits.paywall.later'))).toBeDefined();
    await tick(1); expect(nodes('radio')).toHaveLength(0); await balance(5); expect(nodes('radio')).toHaveLength(0);
    await balance(0); expect(mood('worried')).toBe(true); expect(text()).not.toContain(t('credits.added', { balance: 1000 }));
    await tick(2000); expect(nodes('radio')).toHaveLength(3); expect(playSuccess).toHaveBeenCalledTimes(1);
});
test('Reduce Motion announces success and closes immediately', async () => {
    jest.spyOn(RN.AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);
    await mount(); mockBilling.purchase.mockImplementation(async () => { mockBalance = 1000; return 'purchased'; });
    await click(buy()); expect(useAnnouncement).toHaveBeenCalledWith(t('credits.added', { balance: 1000 }));
    expect(playSuccess).toHaveBeenCalledTimes(1); expect(nodes('radio')).toHaveLength(0);
});
test.each(['error', 'sales_closed'])('%s shows existing feedback and worried Vey', async error => {
    await mount(); mockBilling.purchase.mockImplementation(async () => { if (error === 'sales_closed') mockBilling.canPurchase = false; throw Error(error); });
    await click(buy()); expect(mood('worried')).toBe(true); expect(playError).toHaveBeenCalledTimes(1);
    expect(text()).toContain(t(error === 'error' ? 'credits.error' : 'credits.notOpen'));
    if (error === 'sales_closed') expect(buy().props.accessibilityState.disabled).toBe(true);
    expect(button(t('credits.restore')).props.accessibilityState.disabled).toBe(false);
});
test.each(['empty', 'loading'])('%s store shows only fallback actions', async mode => {
    if (mode === 'empty') mockBilling.offerings.all = {} as any; else mockBilling.status = 'loading';
    await mount(); expect(nodes('radio')).toHaveLength(0); expect(buy()).toBeUndefined(); expect(text()).not.toContain('£');
    expect(button(t('credits.paywall.allOptions'))).toBeDefined(); expect(button(t('credits.paywall.later'))).toBeDefined(); expect(button(t('credits.restore'))).toBeUndefined();
});
test('plans toggle uses Starter, renewal and expiry terms without a never-expire line', async () => {
    await mount(); await click(nodes('tab').find(n => n.props.accessibilityLabel === t('credits.paywall.planTab'))!);
    expect(nodes('radio')).toHaveLength(1); expect(nodes('radio')[0].props.accessibilityState.selected).toBe(true);
    expect(text()).toContain(t('credits.paywall.emptyTitle'));
    expect(text()).not.toContain(t('credits.paywall.emptyBody'));
    expect(text()).toContain('Renews automatically'); expect(text()).toContain(t('creditsPage.monthlyExpiry'));
    expect(text()).not.toContain(t('credits.paywall.packsNeverExpire')); expect(text()).not.toContain('Credits never expire');
    await click(buy()); expect(mockBilling.purchase).toHaveBeenCalledWith(plans[0]);
});
test.each(['paid', 'missing'])('plans toggle is absent for %s access/catalog', async kind => {
    if (kind === 'paid') mockBilling.paidAccess = true; else mockBilling.offerings.all.generation.availablePackages = [];
    await mount(); expect(nodes('tab')).toHaveLength(0);
});
test('store blocks dismissal and every control; confirmation allows dismissal and Credits shares its lock and outcome', async () => {
    const native = deferred<string>(); mockBilling.purchase.mockReturnValue(native.promise); await mount(); await click(buy());
    expect(getPurchaseSnapshot().phase).toBe('store');
    expect(button(t('credits.paywall.later')).props.accessibilityState).toMatchObject({ disabled: true, busy: true });
    for (const radio of nodes('radio')) expect(radio.props.accessibilityState.disabled).toBe(true);
    await press(t('credits.paywall.later')); expect(nodes('radio')).toHaveLength(3);
    const close = root.container.queryAll(n => typeof n.props.onRequestClose === 'function')[0];
    await act(async () => close.props.onRequestClose()); expect(nodes('radio')).toHaveLength(3);
    const escape = root.container.queryAll(n => typeof n.props.onAccessibilityEscape === 'function')[0];
    await act(async () => escape.props.onAccessibilityEscape()); expect(nodes('radio')).toHaveLength(3);
    await act(async () => native.resolve('purchased')); expect(getPurchaseSnapshot().phase).toBe('confirming');
    expect(button(t('credits.paywall.later')).props.accessibilityState).toMatchObject({ disabled: false, busy: false });
    await press(t('credits.paywall.later')); expect(nodes('radio')).toHaveLength(0);
    await act(async () => root.render(<Credits />));
    expect(getPurchaseSnapshot().phase).toBe('confirming'); expect(button(t('credits.restore')).props.accessibilityState.disabled).toBe(true);
    const pack = button('100 credits, £10.00'); expect(pack.props.accessibilityState.disabled).toBe(true); await click(pack); expect(mockBilling.purchase).toHaveBeenCalledTimes(1);
    mockBalance = 1000; await tick(2000); expect(text()).toContain(t('credits.added', { balance: 1000 }));
});
test('dismissing a slow preparation never calls native purchase', async () => {
    await mount(); const baseline = deferred<any>(); mockApi.getBalance.mockReturnValue(baseline.promise);
    await click(buy()); await click(buy()); expect(getPurchaseSnapshot().phase).toBe('preparing');
    await press(t('credits.paywall.later')); await act(async () => baseline.resolve({ balance: 0 }));
    expect(mockBilling.purchase).not.toHaveBeenCalled();
    expect(getPurchaseSnapshot()).toMatchObject({ phase: 'idle', outcome: null });
    await act(async () => root.render(<Credits />));
    expect(text()).not.toContain(t('credits.cancelled'));
});
test.each([['new', 0], ['new', 1], ['old', 0], ['old', 1]] as const)('%s account legal link %s closes, pushes exact route, suppresses return but allows next zero cycle', async (age, index) => {
    if (age === 'old') mockCreated = '2020-01-01T00:00:00Z'; await mount();
    await click(nodes('link').find(n => n.props.accessibilityLabel === t(LEGAL_LINKS[index].labelKey))!);
    expect(nodes('radio')).toHaveLength(0); expect(mockPush).toHaveBeenCalledWith(LEGAL_LINKS[index].route);
    mockPath = LEGAL_LINKS[index].route; await mount(); mockPath = '/'; await mount(); expect(nodes('radio')).toHaveLength(0);
    await balance(100); await balance(0); expect(nodes('radio')).toHaveLength(3); expect(mood('worried')).toBe(true);
});
test.each(['first', 'low'])('%s opens once and Not now suppresses future first/low openings', async reason => {
    mockBalance = reason === 'first' ? 100 : 5; if (reason === 'low') mockCreated = '2020-01-01T00:00:00Z';
    await mount(); expect(text()).toContain(t(`credits.paywall.${reason}Title`)); expect(mood(reason === 'first' ? 'wave' : 'idle')).toBe(true);
    if (reason === 'first') { await tick(1260); expect(mood('idle')).toBe(true); }
    await press(t('credits.paywall.later')); await balance(4); expect(nodes('radio')).toHaveLength(0);
});
test('new session at zero can open depleted and a previous Credits purchase outcome is ignored', async () => {
    mockBalance = 100; mockPath = '/credits'; await mount();
    mockBilling.purchase.mockResolvedValue('purchased');
    const result = startPurchase({ kind: 'plan', pkg: plans[0] as any }, { api: mockApi, billing: mockBilling, beginSessionTask: mockBegin });
    if (typeof result === 'string') throw Error(result); await act(async () => result.completion);
    mockPath = '/'; mockBalance = 0; await balance(0); await mount(); expect(mood('worried')).toBe(true); await tick(2000); expect(nodes('radio')).toHaveLength(3);
    await balance(100); await press(t('credits.paywall.later'));
    const owner = getCacheUser()!;
    await act(async () => { await wipeCache(); mockBalance = 0; await bindCacheUser(owner); mockGeneration++; });
    await mount(); expect(mood('worried')).toBe(true);
});
