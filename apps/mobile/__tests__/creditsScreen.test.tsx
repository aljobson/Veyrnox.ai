import { act } from 'react';
import * as RN from 'react-native';
import { createRoot, type Root, type TestInstance } from 'test-renderer';
import Credits from '../src/app/(app)/credits';
import { publishBalance } from '../src/lib/balanceEvents';
import { ApiError } from '../src/lib/api';
import { bindCacheUser, getCacheUser, wipeCache } from '../src/lib/appCache';
import { setLocaleFromDevice, t } from '../src/lib/i18n';
import { markOffline, markOnline } from '../src/lib/network';
const pkg = (id: string, product: string, price: number) => ({ identifier: id, product: { identifier: product, title: id, price, priceString: `£${price}.00`, currencyCode: 'GBP', pricePerMonthString: '£8.33' } });
const monthly = pkg('monthly', 'ai.veyrnox.generation.starter.monthly', 10), annual = pkg('annual', 'ai.veyrnox.generation.starter.annual', 100);
const baseRow = { id: '11111111-1111-1111-1111-111111111111', plan_id: 'starter-monthly', status: 'active', credits: 200, price_usd_cents: 999, current_period_end: '2026-11-27T00:00:00Z', cancel_at_period_end: false, started_at: '2026-10-27T00:00:00Z', ended_at: null, end_reason: null };
let mockRow: any = null;
let mockBalance = { balance: 1234, free_credits: 20, free_expires_at: '2026-11-01T00:00:00Z' };
const mockPost = jest.fn();
const mockApi = { getBalance: jest.fn(async () => mockBalance), request: jest.fn(async (path: string, init?: RequestInit) => {
    if (init?.method === 'POST') return mockPost(path, init);
    if (path === '/api/v1/subscriptions') return { subscription: mockRow };
    return { plans: [{ id: 'starter-monthly', credits: 200 }, { id: 'starter-yearly', credits: 200 }] };
}) };
const mockBilling = { status: 'ready', canPurchase: true, canRestore: true, refreshSales: jest.fn(), generationActive: false, generationAccessResolved: true, generationPurchaseReady: true,
    activeProductIds: [] as string[], managementURL: null, offerings: { all: { generation: { availablePackages: [monthly, annual] }, credits: { availablePackages: [pkg('pack', 'ai.veyrnox.credits.100', 10), pkg('large', 'ai.veyrnox.credits.1000', 70)] } } },
    purchase: jest.fn(), restore: jest.fn(), refreshGenerationAccess: jest.fn(),
};
jest.mock('../src/auth/AuthProvider', () => ({ useAuth: () => ({ api: mockApi }) }));
jest.mock('../src/billing/BillingProvider', () => ({ useBilling: () => mockBilling }));
jest.mock('expo-router', () => ({ Link: ({ children }: any) => children, Stack: { Screen: () => null }, router: { push: jest.fn() }, useFocusEffect: (fn: any) => require('react').useEffect(fn, [fn]) }));
jest.mock('../src/components/VeyCardPeek', () => ({ VeyCardPeek: () => null, peekRoom: () => 0 }));
jest.mock('../src/lib/media', () => ({ ...jest.requireActual('../src/lib/media'), fetchCatalog: async () => [] }));
void [RN.View, RN.Text, RN.Pressable, RN.ScrollView, RN.ActivityIndicator];
let root: Root, serial = 0;
const textOf = (node: TestInstance): string => node.props.accessibilityElementsHidden ? '' : node.children.map(c => typeof c === 'string' ? c : textOf(c)).join('');
const text = () => textOf(root.container);
const controls = (label: string) => root.container.queryAll(n => n.props.accessibilityLabel === label && n.props.accessibilityRole === 'button');
async function click(node: TestInstance) { await act(async () => node.props.onClick({ nativeEvent: {}, currentTarget: 1, target: 1 })); }
async function press(label: string) { const nodes = controls(label); expect(nodes).toHaveLength(1); await click(nodes[0]); }
async function mount() { await act(async () => root.render(<Credits />)); }
async function cancel(label = t('creditsPage.cancel')) {
    await press(label);
    expect(controls(t('creditsPage.confirm'))[0].props.accessibilityState.disabled).toBe(true);
    await click(root.container.queryAll(n => n.props.accessibilityRole === 'checkbox')[0]);
    await press(t('creditsPage.confirm'));
}
beforeEach(async () => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; setLocaleFromDevice(['en']); markOnline();
    await wipeCache(); await bindCacheUser(`credits-${++serial}`); root = createRoot();
    mockRow = null; mockBalance = { balance: 1234, free_credits: 20, free_expires_at: '2026-11-01T00:00:00Z' };
    mockApi.getBalance.mockReset().mockImplementation(async () => mockBalance); mockApi.request.mockClear(); mockPost.mockReset();
    mockBilling.status = 'ready'; mockBilling.canPurchase = true; mockBilling.canRestore = true; mockBilling.refreshSales.mockClear();
    mockBilling.offerings = { all: { generation: { availablePackages: [monthly, annual] }, credits: { availablePackages: [pkg('pack', 'ai.veyrnox.credits.100', 10), pkg('large', 'ai.veyrnox.credits.1000', 70)] } } };
    mockBilling.generationActive = false; mockBilling.activeProductIds = []; mockBilling.offerings.all.generation.availablePackages = [monthly, annual];
    mockBilling.purchase.mockReset().mockResolvedValue('purchased'); mockBilling.restore.mockReset().mockResolvedValue(undefined); mockBilling.refreshGenerationAccess.mockReset().mockResolvedValue(false);
});
afterEach(async () => { await act(async () => root.unmount()); await wipeCache(); markOnline(); });
test('renders balance, free-credit expiry, store cards and no per-credit price', async () => {
    await mount(); expect(text()).toContain('1,234'); expect(text()).toContain('20 credits'); expect(text()).toContain('Nov 1, 2026');
    expect(text()).toContain('Best value'); expect(text()).toContain('£70.00'); expect(text()).not.toMatch(/per credit|\/ credit/i);
});
test('switching cadence clears selection and renewal terms until the exact visible annual card is chosen', async () => {
    await mount();
    await click(root.container.queryAll(n => n.props.accessibilityRole === 'tab' && textOf(n) === 'Yearly')[0]);
    expect(controls(t('credits.subscriptions.continue'))[0].props.accessibilityState.disabled).toBe(true);
    expect(text()).not.toContain('Renews automatically'); expect(mockBilling.purchase).not.toHaveBeenCalled();
    const radios = root.container.queryAll(n => n.props.accessibilityRole === 'radio'); expect(radios).toHaveLength(1);
    expect(textOf(radios[0])).toContain('£100.00'); await click(radios[0]); await press(t('credits.subscriptions.continue'));
    expect(mockBilling.purchase).toHaveBeenCalledWith(annual);
});
test.each([monthly, annual])('single cadence $identifier hides tabs and remains buyable', async plan => {
    mockBilling.offerings.all.generation.availablePackages = [plan]; await mount();
    expect(root.container.queryAll(n => n.props.accessibilityRole === 'tab')).toHaveLength(0);
    await press(t('credits.subscriptions.continue')); expect(mockBilling.purchase).toHaveBeenCalledWith(plan);
});
test.each(['pending','flagged','active','past_due','ended'])('status %s is independent of generationActive', async status => {
    mockRow = { ...baseRow, status, end_reason: status === 'ended' ? 'cancelled_cooling_off' : null }; await mount();
    expect(text()).toContain(t(`creditsPage.status.${status}`)); expect(text()).toContain('Credits each month: 200');
    if (status === 'ended') expect(text()).toContain(t('creditsPage.checkRefund'));
});
test('other ended rows are hidden', async () => { mockRow = { ...baseRow, status: 'ended', end_reason: 'expired' }; await mount(); expect(text()).not.toContain('Credits each month:'); });
test('Stripe row remains cancellable with a flagged store product; success retains the ended refund card beside offers', async () => {
    mockRow = { ...baseRow }; mockBilling.activeProductIds = [annual.product.identifier];
    mockPost.mockImplementation(async () => { mockRow = { ...baseRow, status: 'ended', end_reason: 'cancelled_cooling_off' }; return { ok: true, mode: 'cooling_off', pending: true }; });
    await mount(); await cancel();
    expect(text()).toContain(t('creditsPage.refundPending')); expect(text()).toContain(t('creditsPage.checkRefund')); expect(text()).toContain('£10.00 / month');
    expect(mockBilling.refreshGenerationAccess).toHaveBeenCalledTimes(1);
});
test('server 404 identifies a store plan and replaces actions; no channel is guessed before it', async () => {
    mockRow = { ...baseRow }; mockPost.mockRejectedValue(new ApiError(404, 'no_live_subscription')); await mount();
    expect(text()).not.toContain(t('creditsPage.storeBilled')); await cancel(); expect(text()).toContain(t('creditsPage.storeBilled'));
    expect(controls(t('creditsPage.cancel'))).toHaveLength(0); expect(controls(t('creditsPage.stop'))).toHaveLength(0);
});
test.each(['post','access','balance'])('refreshes independent pieces despite %s failure', async failure => {
    mockRow = { ...baseRow }; await mount(); const before = mockApi.getBalance.mock.calls.length;
    mockPost.mockImplementation(async () => {
        mockRow = { ...baseRow, status: 'ended', end_reason: 'cancelled_cooling_off' }; mockBalance = { ...mockBalance, balance: 900 };
        if (failure === 'post') throw new ApiError(503, 'refund_failed', { credits_removed: true });
        return { ok: true, mode: 'cooling_off', pending: true };
    });
    if (failure === 'access') mockBilling.refreshGenerationAccess.mockRejectedValue(new Error('network'));
    if (failure === 'balance') mockApi.getBalance.mockRejectedValue(new Error('network'));
    await cancel();
    expect(text()).toContain(t('creditsPage.status.ended')); expect(mockBilling.refreshGenerationAccess).toHaveBeenCalled();
    expect(mockApi.getBalance.mock.calls.length).toBeGreaterThan(before);
    expect(text()).toContain(failure === 'balance' ? '1,234' : '900');
    if (failure === 'post') expect(text()).toContain(t('creditsPage.retry'));
});
test('top-up updates the mounted focused balance card and refreshes free fields', async () => {
    await mount(); mockBilling.purchase.mockImplementation(async () => { mockBalance = { balance: 1334, free_credits: 30, free_expires_at: '2026-12-01T00:00:00Z' }; return 'purchased'; });
    await press('100 credits, £10.00'); expect(text()).toContain('1,334'); expect(text()).toContain('30 credits'); expect(text()).toContain('Dec 1, 2026');
});
test('restore republishes balance and rereads details', async () => {
    await mount(); mockBilling.restore.mockImplementation(async () => { mockBalance = { ...mockBalance, balance: 1500 }; });
    await press(t('credits.restore')); expect(text()).toContain('1,500');
});
test('offline confirmation is disabled and keeping a subscription makes no POST', async () => {
    mockRow = { ...baseRow }; await mount(); await press(t('creditsPage.stop'));
    await click(root.container.queryAll(n => n.props.accessibilityRole === 'checkbox')[0]);
    await act(async () => markOffline()); expect(controls(t('creditsPage.confirm'))[0].props.accessibilityState.disabled).toBe(true);
    await press(t('creditsPage.keep')); expect(mockPost).not.toHaveBeenCalled();
});
test('stopping renewal reports the monthly expiry rule and hides only the stop-renewal action', async () => {
    mockRow = { ...baseRow }; mockPost.mockImplementation(async () => { mockRow = { ...baseRow, cancel_at_period_end: true }; return { ok: true, mode: 'period_end' }; });
    await mount(); await cancel(t('creditsPage.stop'));
    expect(text()).toContain(t('creditsPage.stopSuccess')); expect(text()).toContain(t('creditsPage.stopped'));
    expect(controls(t('creditsPage.stop'))).toHaveLength(0); expect(controls(t('creditsPage.cancel'))).toHaveLength(1);
});
test('subscription_not_found hides actions and preserves the polite outcome when the next read is null', async () => {
    mockRow = { ...baseRow }; mockPost.mockImplementation(async () => { mockRow = null; throw new ApiError(404, 'subscription_not_found'); });
    await mount(); await cancel(); expect(text()).toContain(t('creditsPage.error.subscription_not_found'));
    expect(controls(t('creditsPage.cancel'))).toHaveLength(0);
});
test.each([true, false])('failed subscription read falls back only for generationActive=%s', async active => {
    mockBilling.generationActive = active;
    mockApi.request.mockImplementationOnce(async () => { throw new Error('network'); });
    await mount(); expect(text().includes(t('credits.subscriptions.active'))).toBe(active);
});
test('numeric balance publications preserve the existing free-credit fields', async () => {
    await mount(); const { publishBalance } = require('../src/lib/balanceEvents'), { getCacheUser } = require('../src/lib/appCache');
    await act(async () => publishBalance(getCacheUser(), 1800));
    expect(text()).toContain('1,800'); expect(text()).toContain('20 credits'); expect(text()).toContain('Nov 1, 2026');
});
test('late subscription results from another owner are discarded', async () => {
    let resolve!: (result: any) => void;
    mockApi.request.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    await mount(); await act(async () => bindCacheUser('replacement-owner'));
    await act(async () => resolve({ subscription: baseRow }));
    expect(text()).not.toContain('Credits each month: 200');
});

test('tapping the active cadence preserves selection, renewal terms and Continue', async () => {
    await mount();
    const before = text();
    await click(root.container.queryAll(n => n.props.accessibilityRole === 'tab' && textOf(n) === 'Monthly')[0]);
    expect(text()).toBe(before);
    expect(controls(t('credits.subscriptions.continue'))[0].props.accessibilityState.disabled).toBe(false);
    expect(root.container.queryAll(n => n.props.accessibilityRole === 'radio')[0].props.accessibilityState.selected).toBe(true);
    await press(t('credits.subscriptions.continue')); expect(mockBilling.purchase).toHaveBeenCalledWith(monthly);
});
test('a previously ended cooling-off row shows neutral refund guidance until an action returns a result', async () => {
    mockRow = { ...baseRow, status: 'ended', end_reason: 'cancelled_cooling_off' };
    await mount(); expect(text()).toContain(t('creditsPage.refundStatus'));
    expect(text()).not.toContain(t('creditsPage.refundUnknown'));
    mockPost.mockResolvedValue({ ok: true, mode: 'cooling_off' });
    await cancel(t('creditsPage.checkRefund'));
    expect(text()).toContain(t('creditsPage.refundUnknown'));
    expect(text()).not.toContain(t('creditsPage.refundStatus'));
});
test('a balance publication during the first read keeps its amount and receives the free-credit fields', async () => {
    let resolve!: (result: typeof mockBalance) => void;
    mockApi.getBalance.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    await mount();
    await act(async () => publishBalance(getCacheUser()!, 1800));
    expect(text()).toContain('1,800');
    await act(async () => resolve(mockBalance));
    expect(text()).toContain('1,800'); expect(text()).toContain('20 credits'); expect(text()).toContain('Nov 1, 2026');
    expect(mockApi.getBalance).toHaveBeenCalledTimes(1);
});

test.each([true, false])('restore feedback reflects returned active access=%s', async restored => {
    mockBilling.restore.mockResolvedValue(restored); await mount(); await press(t('credits.restore'));
    expect(text()).toContain(t(restored ? 'credits.restored' : 'credits.nothingToRestore'));
    expect(text()).not.toContain(t(restored ? 'credits.nothingToRestore' : 'credits.restored'));
});
test('restore failure retains the existing error path', async () => {
    mockBilling.restore.mockRejectedValue(new Error('offline')); await mount(); await press(t('credits.restore'));
    expect(text()).toContain(t('credits.error')); expect(text()).not.toContain(t('credits.restored'));
});
test.each(['pending', 'throwAfterPurchase', 'cancelled', 'failed'])('purchase result %s uses the correct feedback', async result => {
    await mount();
    const unsubscribe = result === 'throwAfterPurchase'
        ? require('../src/lib/balanceEvents').subscribeBalance(() => { throw new Error('bookkeeping'); }) : () => {};
    if (result === 'failed') mockBilling.purchase.mockRejectedValue(new Error('store failed'));
    else mockBilling.purchase.mockImplementation(async () => {
        if (result === 'throwAfterPurchase') mockBalance = { ...mockBalance, balance: 1334 };
        return result === 'throwAfterPurchase' ? 'purchased' : result;
    });
    try {
        await press('100 credits, £10.00');
        const key = result === 'cancelled' ? 'credits.cancelled' : result === 'failed' ? 'credits.error' : 'credits.pending';
        expect(text()).toContain(t(key));
        if (key !== 'credits.error') expect(text()).not.toContain(t('credits.error'));
    } finally { unsubscribe(); }
});

test.each([true, false])('cached {} never reaches BalanceCard; refresh succeeds=%s', async succeeds => {
    const { appStorage } = require('../src/lib/appCache');
    await appStorage.set(`veyrnox.cache.v1.balance.${getCacheUser()}`, JSON.stringify({ savedAt: Date.now(), value: {} }));
    if (!succeeds) mockApi.getBalance.mockRejectedValue(new Error('offline'));
    await mount();
    expect(text()).not.toContain('NaN');
    if (succeeds) expect(text()).toContain('1,234');
    else { expect(text()).toContain('—'); expect(text()).toContain(t('creditsPage.balanceUnavailable')); }
});

test('closed sales retain Restore and still refresh sales on focus', async () => {
    mockBilling.canPurchase = false; await mount();
    expect(mockBilling.refreshSales).toHaveBeenCalled();
    expect(controls(t('credits.restore'))[0].props.accessibilityState.disabled).toBe(false);
    await press(t('credits.restore')); expect(mockBilling.restore).toHaveBeenCalled();
});
test.each(['missing', 'null-products', 'error'])('catalog %s shows unavailable copy without fallback prices', async kind => {
    mockBilling.offerings = (kind === 'missing' ? { current: null, all: {} } : kind === 'error' ? null : {
        all: { credits: { availablePackages: [{ identifier: 'empty', product: null }] }, generation: { availablePackages: [] } },
    }) as any;
    if (kind === 'error') mockBilling.status = 'unavailable';
    await mount(); expect(text()).toContain(t('credits.unavailable'));
    expect(text()).not.toContain('£'); expect(text()).not.toContain('$');
    expect(root.container.queryAll(n => n.props.accessibilityRole === 'radio')).toHaveLength(0);
});
