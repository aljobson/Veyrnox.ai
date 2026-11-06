import { act } from 'react';
import { AccessibilityInfo } from 'react-native';
import * as RN from 'react-native';
import { createRoot, type Root } from 'test-renderer';
import { SlowLoader, SLOW_AFTER_MS, TIMEOUT_AFTER_MS, loadPhase } from '../src/components/SlowLoader';
import Models from '../src/app/(app)/models';
import History from '../src/app/(app)/history';
import { fetchAllCatalog } from '../src/lib/media';
import { fetchHistoryPage, fetchUsage } from '../src/lib/creditHistory';
import { RATE_LIMIT_DEFAULT_MS, RATE_LIMIT_MAX_MS, retryDelayMs } from '../src/lib/retryDelay';
import { ApiError } from '../src/lib/api';
import { t } from '../src/lib/i18n';

jest.mock('expo-router', () => ({ Link: ({ children }: any) => children, Stack: { Screen: () => null } }));
const mockApi = {};
jest.mock('../src/auth/AuthProvider', () => ({ useAuth: () => ({ api: mockApi }) }));
jest.mock('../src/lib/media', () => ({ ...jest.requireActual('../src/lib/media'), fetchCatalog: jest.fn(), fetchAllCatalog: jest.fn() }));
jest.mock('../src/lib/creditHistory', () => ({ ...jest.requireActual('../src/lib/creditHistory'), fetchHistoryPage: jest.fn(), fetchUsage: jest.fn() }));
void [RN.View, RN.Text, RN.Pressable, RN.ScrollView, RN.FlatList, RN.ActivityIndicator];

let root: Root;
const event = { nativeEvent: {}, currentTarget: 1, target: 1 };
const present = (text: string) => root.container.queryAll(n => n.children.includes(text)).length > 0;
const retryButtons = () => root.container.queryAll(n => n.props.accessibilityRole === 'button' && n.props.accessibilityLabel === t('recovery.retry') || n.props.accessibilityRole === 'button' && n.props.accessibilityLabel === t('acct.mfa.retry'));
const advance = (ms: number) => act(async () => { await jest.advanceTimersByTimeAsync(ms); });
beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; jest.useFakeTimers(); jest.clearAllMocks();
    jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => {});
    root = createRoot();
});
afterEach(async () => { await act(async () => root.unmount()); jest.useRealTimers(); jest.restoreAllMocks(); });

test('loadPhase switches at 8 s and 20 s', () => {
    expect([0, SLOW_AFTER_MS - 1].map(loadPhase)).toEqual(['loading', 'loading']);
    expect([SLOW_AFTER_MS, TIMEOUT_AFTER_MS - 1].map(loadPhase)).toEqual(['slow', 'slow']);
    expect(loadPhase(TIMEOUT_AFTER_MS)).toBe('timeout');
});

test('SlowLoader: silent at first, "Still loading…" at 8 s (announced), timeout and Try again at 20 s', async () => {
    const onRetry = jest.fn();
    await act(async () => root.render(<SlowLoader onRetry={onRetry} />));
    expect(present(t('loading.still'))).toBe(false);
    await advance(SLOW_AFTER_MS);
    expect(present(t('loading.still'))).toBe(true);
    expect(AccessibilityInfo.announceForAccessibility).toHaveBeenCalledWith(t('loading.still'));
    expect(retryButtons()).toHaveLength(0);
    await advance(TIMEOUT_AFTER_MS - SLOW_AFTER_MS);
    expect(present(t('loading.timeout'))).toBe(true);
    await act(async () => retryButtons()[0].props.onClick(event));
    expect(onRetry).toHaveBeenCalledTimes(1);
});

test('QA-E1 Models: a 25 s catalogue shows the notice and Try again fetches again', async () => {
    jest.mocked(fetchAllCatalog).mockReturnValue(new Promise(() => {}));
    await act(async () => root.render(<Models />));
    await advance(SLOW_AFTER_MS);
    expect(present(t('loading.still'))).toBe(true);
    await advance(TIMEOUT_AFTER_MS);
    expect(present(t('loading.timeout'))).toBe(true);
    await act(async () => retryButtons()[0].props.onClick(event));
    expect(fetchAllCatalog).toHaveBeenCalledTimes(2);
    expect(present(t('loading.timeout'))).toBe(false);
});

test('QA-E1 Credit history: a slow first page shows the notice and Try again reloads', async () => {
    jest.mocked(fetchHistoryPage).mockReturnValue(new Promise(() => {}));
    jest.mocked(fetchUsage).mockReturnValue(new Promise(() => {}));
    await act(async () => root.render(<History />));
    await advance(SLOW_AFTER_MS);
    expect(present(t('loading.still'))).toBe(true);
    await advance(TIMEOUT_AFTER_MS);
    expect(present(t('loading.timeout'))).toBe(true);
    await act(async () => retryButtons()[0].props.onClick(event));
    expect(fetchHistoryPage).toHaveBeenCalledTimes(2);
    expect(present(t('loading.timeout'))).toBe(false);
});

test('retryDelayMs: only a 429 waits, honouring Retry-After within bounds', () => {
    expect(retryDelayMs(new ApiError(500, 'server_error'))).toBe(0);
    expect(retryDelayMs(new Error('offline'))).toBe(0);
    expect(retryDelayMs(new ApiError(429, 'rate_limited'))).toBe(RATE_LIMIT_DEFAULT_MS);
    expect(retryDelayMs(new ApiError(429, 'rate_limited', { retryAfterSeconds: 7 }))).toBe(7000);
    expect(retryDelayMs(new ApiError(429, 'rate_limited', { retryAfterSeconds: 600 }))).toBe(RATE_LIMIT_MAX_MS);
    expect(retryDelayMs(new ApiError(429, 'rate_limited', { retryAfterSeconds: 0.2 }))).toBe(1000);
});
