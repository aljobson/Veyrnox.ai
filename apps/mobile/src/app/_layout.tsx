import { flushInstallResetIssue } from '../lib/installReset';
import { revokeDiscardedSession } from '../lib/auth/discardedSession';
export { ErrorFallback as ErrorBoundary } from '../components/ErrorFallback';
import { AnalyticsHost } from '../components/AnalyticsHost';
import { FontStatus } from '../components/ui/FontStatus';
import { typefaceFonts } from '../components/ui/FontCatalog';
import { useFonts } from 'expo-font';
import { Slot, usePathname, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useMemo } from 'react';
import { useColorScheme } from 'react-native';
import { AuthProvider } from '../auth/AuthProvider';
import { BillingProvider } from '../billing/BillingProvider';
import { PushProvider } from '../push/PushProvider';
import { captureIssue, initCrashReporting, withCrashReporting } from '../lib/crash';
import { LanguageGate } from '../components/LanguageGate';
import { setIssueReporter } from '../lib/requestGuard';
import { getAppearance, getThemePreference, resolveScheme, takeThemeReturnPath } from '../theme';

if (initCrashReporting()) flushInstallResetIssue(captureIssue);
setIssueReporter(captureIssue);

function RootLayout() {
    useEffect(() => { void revokeDiscardedSession(); }, []);
    // The headings use Archivo; a failed load (error) falls back to the system font rather than blocking the app.
    const [loaded, error] = useFonts(typefaceFonts[getAppearance().typeface]);
    const loadedFonts = useMemo(() => new Set(loaded ? Object.keys(typefaceFonts[getAppearance().typeface]) : []), [loaded]);
    const systemScheme = useColorScheme();
    const dark = resolveScheme(getThemePreference(), systemScheme) === 'dark';
    // Font failure or a slow load never blocks startup. Text checks the loaded-font context before using a face.
    void loaded;
    void error;
    return (
        <FontStatus.Provider value={loadedFonts}>
            <AuthProvider>
                <BillingProvider>
                    <PushProvider>
                        <ThemeRouteRestorer />
                        <StatusBar style={dark ? 'light' : 'dark'} />
                        <LanguageGate><AnalyticsHost /><Slot /></LanguageGate>
                    </PushProvider>
                </BillingProvider>
            </AuthProvider>
        </FontStatus.Provider>
    );
}

function ThemeRouteRestorer() {
    const router = useRouter();
    const pathname = usePathname();
    useEffect(() => {
        void takeThemeReturnPath().then((next) => {
            if (next && next !== pathname) router.replace(next as never);
        }).catch(() => captureIssue('theme_return_failed', {}));
    }, [pathname, router]);
    return null;
}

export default withCrashReporting(RootLayout);
