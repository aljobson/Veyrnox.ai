import { act } from 'react';
import { createRoot } from 'test-renderer';
import RootLayout from '../src/app/_layout';
import { captureIssue } from '../src/lib/crash';
import { takeThemeReturnPath } from '../src/theme';
import { deferred, token } from './fixtures/musicPublication';
let mockPathname = '/';
const mockRouter = { replace: jest.fn(), push: jest.fn() };
jest.mock('../src/lib/crash', () => ({ captureIssue: jest.fn(), initCrashReporting: () => false, withCrashReporting: (component: unknown) => component }));
jest.mock('../src/lib/auth/discardedSession', () => ({ revokeDiscardedSession: async () => {} }));
jest.mock('../src/auth/AuthProvider', () => ({ AuthProvider: ({ children }: any) => children }));
jest.mock('../src/billing/BillingProvider', () => ({ BillingProvider: ({ children }: any) => children }));
jest.mock('../src/push/PushProvider', () => ({ PushProvider: ({ children }: any) => children }));
jest.mock('../src/components/LanguageGate', () => ({ LanguageGate: ({ children }: any) => children }));
jest.mock('../src/components/AnalyticsHost', () => ({ AnalyticsHost: () => null }));
jest.mock('../src/components/ui/FontCatalog', () => ({ typefaceFonts: { inter: {} } }));
jest.mock('expo-font', () => ({ useFonts: () => [true, null] }));
jest.mock('../src/components/ui/AppearanceContext', () => ({ ...jest.requireActual('../src/components/ui/AppearanceContext'), useAppearance: () => ({ settings: { typeface: 'inter' }, scheme: 'dark' }) }));
jest.mock('expo-status-bar', () => ({ StatusBar: () => null }));
jest.mock('expo-router', () => ({ Slot: () => 'usable app', usePathname: () => mockPathname, useRouter: () => mockRouter }));
jest.mock('../src/theme', () => ({ ...jest.requireActual('../src/theme'), getAppearance: () => ({ typeface: 'inter' }), takeThemeReturnPath: jest.fn() }));
beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    mockPathname = '/'; jest.clearAllMocks(); jest.mocked(takeThemeReturnPath).mockReset();
});
test('a rejected theme return read reports only a fixed issue and leaves the root usable', async () => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    jest.mocked(takeThemeReturnPath).mockRejectedValue(new Error('private stored value'));
    const root = createRoot();
    try {
        await act(async () => root.render(<RootLayout />));
        expect(captureIssue).toHaveBeenCalledWith('theme_return_failed', {});
        expect(root.container.children).toContain('usable app');
    } finally { await act(async () => root.unmount()); }
});
test.each(['/listen/', '/music/listen/'])('theme return is not taken on %s until that screen is left', async prefix => {
    mockPathname = `${prefix}${token}`;
    jest.mocked(takeThemeReturnPath).mockResolvedValue('/account');
    const root = createRoot();
    try {
        await act(async () => root.render(<RootLayout />));
        expect(takeThemeReturnPath).not.toHaveBeenCalled();
        mockPathname = '/'; await act(async () => root.render(<RootLayout />));
        expect(takeThemeReturnPath).toHaveBeenCalledTimes(1);
        expect(mockRouter.push).toHaveBeenCalledWith('/account', { withAnchor: true });
    } finally { await act(async () => root.unmount()); }
});
test.each(['non-listen', 'listen', 'leave-listen-before-resolution'])('a taken theme path survives navigation during its read: %s', async scenario => {
    const take = deferred<string | null>();
    jest.mocked(takeThemeReturnPath).mockReturnValueOnce(take.promise);
    const root = createRoot();
    try {
        await act(async () => root.render(<RootLayout />));
        mockPathname = scenario === 'non-listen' ? '/library' : `/music/listen/${token}`;
        await act(async () => root.render(<RootLayout />));
        if (scenario === 'leave-listen-before-resolution') {
            mockPathname = '/library'; await act(async () => root.render(<RootLayout />));
        }
        await act(async () => take.resolve('/account'));
        if (scenario === 'listen') {
            expect(mockRouter.push).not.toHaveBeenCalled(); expect(mockRouter.replace).not.toHaveBeenCalled();
            mockPathname = '/library'; await act(async () => root.render(<RootLayout />));
        }
        expect(takeThemeReturnPath).toHaveBeenCalledTimes(1);
        expect(mockRouter.push).toHaveBeenCalledTimes(1);
        expect(mockRouter.push).toHaveBeenCalledWith('/account', { withAnchor: true });
    } finally { await act(async () => root.unmount()); }
});
test.each(['/account', '/sign-in', '/'])('ordinary theme return preserves routing behavior for %s', async next => {
    jest.mocked(takeThemeReturnPath).mockResolvedValue(next);
    const root = createRoot();
    try {
        await act(async () => root.render(<RootLayout />));
        if (next === '/account') expect(mockRouter.push).toHaveBeenCalledWith(next, { withAnchor: true });
        else if (next === '/sign-in') expect(mockRouter.replace).toHaveBeenCalledWith(next);
        else { expect(mockRouter.push).not.toHaveBeenCalled(); expect(mockRouter.replace).not.toHaveBeenCalled(); }
    } finally { await act(async () => root.unmount()); }
});
