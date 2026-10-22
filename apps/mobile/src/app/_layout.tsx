import { Archivo_700Bold, Archivo_800ExtraBold } from '@expo-google-fonts/archivo';
import { useFonts } from 'expo-font';
import { Slot } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { AuthProvider } from '../auth/AuthProvider';
import { BillingProvider } from '../billing/BillingProvider';
import { PushProvider } from '../push/PushProvider';
import { initCrashReporting, withCrashReporting } from '../lib/crash';
import { applyDeviceLocale } from '../lib/i18n';
import { isDark } from '../theme';

initCrashReporting();
// Reads the device language once; only languages switched on in ACTIVE_LOCALES are used (English today).
applyDeviceLocale();

function RootLayout() {
    // The headings use Archivo; a failed load (error) falls back to the system font rather than blocking the app.
    const [loaded, error] = useFonts({ Archivo_700Bold, Archivo_800ExtraBold });
    if (!loaded && !error) return null;
    return (
        <AuthProvider>
            <BillingProvider>
                <PushProvider>
                    <StatusBar style={isDark ? 'light' : 'dark'} />
                    <Slot />
                </PushProvider>
            </BillingProvider>
        </AuthProvider>
    );
}

export default withCrashReporting(RootLayout);
