import { readFileSync } from 'fs';
import { join } from 'path';
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'test-renderer';
import type { RouteNode } from 'expo-router/build/Route';
import { resolveNavigationDestination } from 'expo-router/build/global-state/resolveNavigationDestination';
import RootLayout from '../src/app/_layout';
import { LanguageGate } from '../src/components/LanguageGate';
import { createDirectionReconciler, directionReconciler, reconcileLanguageDirection } from '../src/lib/languageDirection';
import { restoreReturnRoute } from '../src/lib/restoreReturnRoute';
import { takeThemeReturnPath } from '../src/theme';

const mockRouter = { push: jest.fn(), replace: jest.fn() };
let mockPathname = '/';
let mockParams: Record<string, string> = {};
const mockSession = {
    status: 'signedIn', generation: 0, api: {}, canReloadSession: () => true,
    beginSessionTask: () => ({ gen: 0, current: () => true }),
};
jest.mock('expo-router', () => ({
    Slot: () => 'usable app', useRouter: () => mockRouter, usePathname: () => mockPathname,
    useGlobalSearchParams: () => mockParams, useSegments: () => [],
}));
jest.mock('../src/lib/crash', () => ({ captureIssue: jest.fn(), initCrashReporting: () => false, withCrashReporting: (component: unknown) => component }));
jest.mock('../src/lib/auth/discardedSession', () => ({ revokeDiscardedSession: async () => {} }));
jest.mock('../src/auth/AuthProvider', () => ({ AuthProvider: ({ children }: { children: ReactNode }) => children, useAuth: () => mockSession }));
jest.mock('../src/billing/BillingProvider', () => ({ BillingProvider: ({ children }: { children: ReactNode }) => children }));
jest.mock('../src/push/PushProvider', () => ({ PushProvider: ({ children }: { children: ReactNode }) => children }));
jest.mock('../src/components/AnalyticsHost', () => ({ AnalyticsHost: () => null }));
jest.mock('../src/components/LanguageChoice', () => ({ LanguageChoice: () => null }));
jest.mock('../src/components/BrandSplash', () => ({ BrandSplash: () => null }));
jest.mock('../src/components/ui/FontCatalog', () => ({ typefaceFonts: { inter: {} } }));
jest.mock('expo-font', () => ({ useFonts: () => [true, null] }));
jest.mock('expo-status-bar', () => ({ StatusBar: () => null }));
jest.mock('../src/components/ui/AppearanceContext', () => ({ ...jest.requireActual('../src/components/ui/AppearanceContext'), useAppearance: () => ({ scheme: 'dark' }) }));
jest.mock('../src/theme', () => ({ ...jest.requireActual('../src/theme'), getAppearance: () => ({ typeface: 'inter' }), takeThemeReturnPath: jest.fn() }));
jest.mock('../src/lib/languageStore', () => ({ readLanguage: () => 'en', syncPendingAccountLanguage: jest.fn(async () => {}) }));
jest.mock('../src/lib/languageDirection', () => ({
    ...jest.requireActual('../src/lib/languageDirection'),
    reconcileLanguageDirection: jest.fn(),
    directionReconciler: { takeReturnPath: jest.fn(), handledRepair: jest.fn() },
}));

let root: Root;
beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    jest.resetAllMocks();
    mockPathname = '/';
    mockParams = {};
    jest.mocked(takeThemeReturnPath).mockResolvedValue(null);
    jest.mocked(reconcileLanguageDirection).mockResolvedValue(true);
    root = createRoot();
});
afterEach(async () => { await act(async () => root.unmount()); });

test.each(['/account', '/account?x=1', '/account?x=1#section', '/email-settings'])('app return %s pushes with the anchor', next => {
    restoreReturnRoute(mockRouter, next);
    expect(mockRouter.push.mock.calls).toEqual([[next, { withAnchor: true }]]);
    expect(mockRouter.replace).not.toHaveBeenCalled();
});

test.each(['/', '/?x=1', '/#frag', '/sign-in', '/sign-in?next=account#form', '/email/verify', '/passkey', '/preview/item', '/review', '/editorial/story'])('public return %s replaces', next => {
    restoreReturnRoute(mockRouter, next);
    expect(mockRouter.replace.mock.calls).toEqual([[next]]);
    expect(mockRouter.push).not.toHaveBeenCalled();
});

test.each(['/', '/explore'])('RootLayout cold start at %s restores Account with its anchor', async pathname => {
    mockPathname = pathname;
    jest.mocked(takeThemeReturnPath).mockResolvedValueOnce('/account');
    await act(async () => root.render(<RootLayout />));
    expect(mockRouter.push.mock.calls).toEqual([['/account', { withAnchor: true }]]);
    expect(mockRouter.replace).not.toHaveBeenCalled();
    expect(root.container.children).toContain('usable app');
});

test.each([null, '/account'])('RootLayout skips an absent or already-current return (%s)', async next => {
    mockPathname = '/account';
    jest.mocked(takeThemeReturnPath).mockResolvedValueOnce(next);
    await act(async () => root.render(<RootLayout />));
    expect(mockRouter.push).not.toHaveBeenCalled();
    expect(mockRouter.replace).not.toHaveBeenCalled();
});

function persistedDirectionReturn(next: string) {
    const write = jest.fn(async (_value: string | null) => {});
    const reload = jest.fn(async () => {});
    const reconciler = createDirectionReconciler({
        read: async () => JSON.stringify({ locale: 'en', returnPath: next }),
        write, nativeRtl: () => false, direction: jest.fn(), reload,
    });
    jest.mocked(reconcileLanguageDirection).mockImplementation((path, session) => reconciler.reconcile('en', path, session));
    jest.mocked(directionReconciler.takeReturnPath).mockImplementation(reconciler.takeReturnPath);
    jest.mocked(directionReconciler.handledRepair).mockImplementation(reconciler.handledRepair);
    return { write, reload };
}

test.each(['/account', '/account?x=1#section', '/sign-in'])('LanguageGate cold start restores a persisted direction return %s', async next => {
    const { write, reload } = persistedDirectionReturn(next);
    await act(async () => root.render(<LanguageGate>usable app</LanguageGate>));
    if (next === '/sign-in') {
        expect(mockRouter.replace.mock.calls).toEqual([[next]]);
        expect(mockRouter.push).not.toHaveBeenCalled();
    } else {
        expect(mockRouter.push.mock.calls).toEqual([[next, { withAnchor: true }]]);
        expect(mockRouter.replace).not.toHaveBeenCalled();
    }
    expect(write).toHaveBeenCalledWith(null);
    expect(reload).not.toHaveBeenCalled();
});

test('LanguageGate compares the full current route, preserving its query and fragment', async () => {
    mockPathname = '/account';
    mockParams = { x: '1', '#': 'section' };
    persistedDirectionReturn('/account?x=1#section');
    await act(async () => root.render(<LanguageGate>usable app</LanguageGate>));
    expect(reconcileLanguageDirection).toHaveBeenCalledWith('/account?x=1#section', expect.any(Object));
    expect(mockRouter.push).not.toHaveBeenCalled();
    expect(mockRouter.replace).not.toHaveBeenCalled();
});

test('the app layout retains its tabs anchor', () => {
    const source = readFileSync(join(__dirname, '../src/app/(app)/_layout.tsx'), 'utf8');
    expect(source).toMatch(/export const unstable_settings = \{ anchor: '\(tabs\)' \}/);
});

test('the real Expo resolver seeds tabs behind Account before the app navigator registers', () => {
    const node = (route: string, children: RouteNode[] = [], anchor?: string): RouteNode => ({
        route, children, type: children.length ? 'layout' : 'route', dynamic: null,
        contextKey: route, loadRoute: () => ({ unstable_settings: { anchor } }),
    });
    const routeNode = node('', [node('index'), node('(app)', [node('(tabs)'), node('account')], '(tabs)')]);
    const resolve = (withAnchor = false) => resolveNavigationDestination({
        targetState: { routes: [{ name: '(app)', state: { routes: [{ name: 'account' }] } }] },
        navigationState: {
            stale: false, type: 'stack', key: 'navigator:root', routeKeySeq: 1,
            index: 0, routeNames: ['index', '(app)'], routes: [{ key: 'index:0', name: 'index' }],
        },
        routeNode, registry: new Map(), action: { type: 'PUSH', payload: {} }, withAnchor,
    }).payload.state;
    // The same cold-start destination loses the back route without withAnchor.
    expect(resolve()?.routes.map(route => route.name)).toEqual(['account']);
    const router = { replace: jest.fn(), push: jest.fn((_href: string, options?: { withAnchor?: boolean }) => {
        const state = resolve(options?.withAnchor);
        expect(state?.routes.map(route => route.name)).toEqual(['(tabs)', 'account']);
        expect(state?.index).toBe(1);
    }) };
    restoreReturnRoute(router, '/account');
    expect(router.push).toHaveBeenCalledTimes(1);
    expect(router.replace).not.toHaveBeenCalled();
});
