import { Archivo_700Bold, Archivo_800ExtraBold } from '@expo-google-fonts/archivo';
import { useFonts } from 'expo-font';
import { Slot, usePathname, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { useColorScheme } from 'react-native';
import { AuthProvider } from '../auth/AuthProvider';
import { BillingProvider } from '../billing/BillingProvider';
import { PushProvider } from '../push/PushProvider';
import { captureIssue, initCrashReporting, withCrashReporting } from '../lib/crash';
import { applyDeviceLocale } from '../lib/i18n';
import { setIssueReporter } from '../lib/requestGuard';
import { getThemePreference, resolveScheme, takeThemeReturnPath } from '../theme';

initCrashReporting();
setIssueReporter(captureIssue);
// Reads the device language once; only languages switched on in ACTIVE_LOCALES are used (English today).
applyDeviceLocale();

function RootLayout() {
    // The headings use Archivo; a failed load (error) falls back to the system font rather than blocking the app.
    const [loaded, error] = useFonts({ Archivo_700Bold, Archivo_800ExtraBold });
    const systemScheme = useColorScheme();
    const dark = resolveScheme(getThemePreference(), systemScheme) === 'dark';
    if (!loaded && !error) return null;
    return (
        <AuthProvider>
            <BillingProvider>
                <PushProvider>
                    <ThemeRouteRestorer />
                    <StatusBar style={dark ? 'light' : 'dark'} />
                    <Slot />
                </PushProvider>
            </BillingProvider>
        </AuthProvider>
    );
}

function ThemeRouteRestorer() {
    const router = useRouter();
    const pathname = usePathname();
    useEffect(() => {
        void takeThemeReturnPath().then((next) => {
            if (next && next !== pathname) router.replace(next as never);
        });
    }, [pathname, router]);
    return null;
}

export default withCrashReporting(RootLayout);
