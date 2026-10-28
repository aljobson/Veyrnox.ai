import { act } from 'react';
import { createRoot } from 'test-renderer';
import RootLayout from '../src/app/_layout';
import { captureIssue } from '../src/lib/crash';
import { takeThemeReturnPath } from '../src/theme';
jest.mock('../src/lib/crash', () => ({ captureIssue: jest.fn(), initCrashReporting: () => false, withCrashReporting: (component: unknown) => component }));
jest.mock('../src/lib/auth/discardedSession', () => ({ revokeDiscardedSession: async () => {} }));
jest.mock('../src/auth/AuthProvider', () => ({ AuthProvider: ({ children }: any) => children }));
jest.mock('../src/billing/BillingProvider', () => ({ BillingProvider: ({ children }: any) => children }));
jest.mock('../src/push/PushProvider', () => ({ PushProvider: ({ children }: any) => children }));
jest.mock('../src/components/LanguageGate', () => ({ LanguageGate: ({ children }: any) => children }));
jest.mock('../src/components/AnalyticsHost', () => ({ AnalyticsHost: () => null }));
jest.mock('../src/components/ui/FontCatalog', () => ({ typefaceFonts: { inter: {} } }));
jest.mock('expo-font', () => ({ useFonts: () => [true, null] }));
jest.mock('expo-status-bar', () => ({ StatusBar: () => null }));
jest.mock('expo-router', () => ({ Slot: () => 'usable app', usePathname: () => '/', useRouter: () => ({ replace: jest.fn() }) }));
jest.mock('../src/theme', () => ({ ...jest.requireActual('../src/theme'), getAppearance: () => ({ typeface: 'inter' }), takeThemeReturnPath: jest.fn() }));
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
