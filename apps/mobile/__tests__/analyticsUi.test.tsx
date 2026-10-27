declare const __dirname: string;
import { act } from 'react';
import * as RN from 'react-native';
import { createRoot, type Root } from 'test-renderer';
import { AnalyticsChoices } from '../src/components/AnalyticsChoices';

import { PaywallPrompt } from '../src/components/PaywallPrompt';
import { CheckInModal } from '../src/components/CheckInModal';
import { FirstRunGate } from '../src/components/FirstRunGate';
import { afterAnalyticsChoice, isFirstRunPending, setFirstRunPending, setFirstRunUser } from '../src/lib/firstRunPending';
import { bindCacheUser, wipeCache } from '../src/lib/appCache';
import { getAnalyticsChoice, writeConsent } from '../src/lib/analytics/consent';
import * as SecureStore from 'expo-secure-store';
const mockRouter = { push: jest.fn(), replace: jest.fn() };
const mockRequest = jest.fn(async (path: string) => path.includes('checkin') ? { enabled: true, claimed_today: false, streak: 0, next_day: 1, rewards: [1,2,3,4,5,6] } : { created_at: new Date().toISOString() });
const mockApi = { request: mockRequest };
jest.mock('expo-router', () => ({ useRouter: () => mockRouter, usePathname: () => '/', useRootNavigationState: () => ({ key: 'ready' }) }));
jest.mock('../src/auth/AuthProvider', () => ({ useAuth: () => ({ status: 'signedIn', api: mockApi }) }));
jest.mock('../src/billing/BillingProvider', () => ({ useBilling: () => ({ status: 'ready', paidAccess: false }) }));
jest.mock('../src/lib/useBalance', () => ({ useBalance: () => 10 }));
jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(async () => null), setItemAsync: jest.fn(async () => {}), deleteItemAsync: jest.fn(async () => {}) }));
const mockFactory = jest.fn(() => ({ ready: async () => {}, getDistinctId: () => 'anonymous', capture: jest.fn(), identify: jest.fn(), reset: jest.fn(), optOut: async () => {}, flush: async () => {} }));
jest.mock('posthog-react-native', () => ({ PostHog: (...args: unknown[]) => mockFactory(...args as []) }));
void [RN.Modal, RN.ScrollView, RN.Text, RN.View, RN.Pressable, RN.Image];
let root: Root;
beforeEach(async () => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    process.env.EXPO_PUBLIC_POSTHOG_KEY = 'phc_test';
    mockRouter.push.mockClear(); mockRouter.replace.mockClear(); mockFactory.mockClear();
    setFirstRunPending(true);
    setFirstRunUser('analytics-ui');
    await wipeCache(); await bindCacheUser('analytics-ui');
    root = createRoot();
});
afterEach(async () => { await act(async () => root.unmount()); delete process.env.EXPO_PUBLIC_POSTHOG_KEY; });
async function press(label: string) {
    const node = root.container.queryAll(n => n.props.accessibilityLabel === label && typeof n.props.onClick === 'function')[0];
    expect(root.container.queryAll(n => !!n.props.accessibilityLabel).map(n => n.props.accessibilityLabel)).toContain(label);
    expect(node).toBeDefined();
    await act(async () => { await node.props.onClick({ nativeEvent: {}, currentTarget: 1, target: 1 }); });
}
test('eligible modals cannot open or navigate during consent or policy; Decline resumes welcome', async () => {
    await act(async () => root.render(<><FirstRunGate /><PaywallPrompt /><CheckInModal /><AnalyticsChoices onChosen={() => mockRouter.replace(afterAnalyticsChoice())} /></>));
    expect(mockRouter.replace).toHaveBeenCalledWith('/analytics-consent');
    const buttons = root.container.queryAll(n => ['Allow', 'Decline'].includes(n.props.accessibilityLabel) && typeof n.props.onClick === 'function');
    expect(buttons).toHaveLength(2);
    expect(buttons.map(n => RN.StyleSheet.flatten(n.props.style))).toEqual([expect.any(Object), expect.any(Object)]);
    expect(RN.StyleSheet.flatten(buttons[0].props.style)).toEqual(RN.StyleSheet.flatten(buttons[1].props.style));
    expect(root.container.queryAll(n => n.props.onRequestClose && n.props.visible)).toHaveLength(0);
    expect(mockRequest).not.toHaveBeenCalled();
    await press('Privacy Policy');
    expect(mockRouter.push).toHaveBeenCalledWith('/legal/privacy');
    expect(root.container.queryAll(n => n.props.onRequestClose && n.props.visible)).toHaveLength(0);
    // Neither modal has a rendered button whose handler could navigate away.
    expect(root.container.queryAll(n => n.props.accessibilityLabel === 'Check in')).toHaveLength(0);
    await press('Decline');
    expect(getAnalyticsChoice()).toBe('denied');
    expect(mockFactory).not.toHaveBeenCalled();
    expect(mockRouter.replace).toHaveBeenLastCalledWith('/welcome');
    await act(async () => setFirstRunPending(false));
    expect(mockRequest).toHaveBeenCalled();
    expect(root.container.queryAll(n => n.props.onRequestClose && n.props.visible)).toHaveLength(2);
});
test('Allow persists and continues; privacy controls show the current choice', async () => {
    const done = jest.fn();
    await act(async () => root.render(<AnalyticsChoices onChosen={done} />));
    await press('Allow');
    expect(getAnalyticsChoice()).toBe('granted');
    expect(mockFactory).toHaveBeenCalledTimes(1);
    expect(done).toHaveBeenCalledTimes(1);
    await act(async () => root.render(<AnalyticsChoices />));
    expect(root.container.queryAll(n => n.props.accessibilityLabel === 'Allow' && n.props.accessibilityState?.selected === true).length).toBeGreaterThan(0);
});
test('kill switch hides consent controls and Account row', async () => {
    delete process.env.EXPO_PUBLIC_POSTHOG_KEY;
    await act(async () => root.render(<AnalyticsChoices />));
    expect(root.container.queryAll(n => n.props.accessibilityRole === 'button')).toHaveLength(0);
    const source = require('fs').readFileSync(require('path').join(__dirname, '../src/app/(app)/account.tsx'), 'utf8');
    expect(source).toContain("{isAnalyticsEnabled() ? <ListRow icon=\"shieldCheck\"");
    expect(mockFactory).not.toHaveBeenCalled();
});

test('failed Allow stays undecided and shows an error; failed Decline still continues', async () => {
    await writeConsent('denied');
    jest.mocked(SecureStore.setItemAsync).mockRejectedValue(new Error('locked'));
    const done = jest.fn();
    try {
        await act(async () => root.render(<AnalyticsChoices onChosen={done} />));
        await press('Allow');
        expect(getAnalyticsChoice()).toBeNull();
        expect(done).not.toHaveBeenCalled();
        expect(mockFactory).not.toHaveBeenCalled();
        expect(root.container.queryAll(n => n.props.children === 'Your choice could not be saved. Please try again.').length).toBeGreaterThan(0);
        await press('Decline');
        expect(getAnalyticsChoice()).toBe('denied');
        expect(done).toHaveBeenCalledTimes(1);
        expect(mockFactory).not.toHaveBeenCalled();
    } finally { jest.mocked(SecureStore.setItemAsync).mockResolvedValue(undefined); }
});

test('failed Decline after a grant still revokes and continues', async () => {
    const done = jest.fn();
    await act(async () => root.render(<AnalyticsChoices onChosen={done} />));
    await press('Allow');
    const client = mockFactory.mock.results[0].value;
    done.mockClear();
    jest.mocked(SecureStore.setItemAsync).mockRejectedValueOnce(new Error('locked'));
    await press('Decline');
    expect(getAnalyticsChoice()).toBe('denied');
    expect(client.reset).toHaveBeenCalled();
    expect(done).toHaveBeenCalledTimes(1);
});

test('the mounted gate recomputes after account changes and stays quiet on sign-out', async () => {
    await writeConsent('denied');
    await act(async () => root.render(<FirstRunGate />));
    await act(async () => setFirstRunPending(true));
    await act(async () => setFirstRunUser('another-user'));
    expect(isFirstRunPending()).toBe(false);
    mockRouter.replace.mockClear();
    await act(async () => setFirstRunUser(null));
    expect(isFirstRunPending()).toBe(false);
    expect(mockRouter.replace).not.toHaveBeenCalled();
});
