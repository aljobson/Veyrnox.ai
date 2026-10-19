import { Slot } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { AuthProvider } from '../auth/AuthProvider';
import { BillingProvider } from '../billing/BillingProvider';
import { PushProvider } from '../push/PushProvider';
import { initCrashReporting, withCrashReporting } from '../lib/crash';
import { applyDeviceLocale } from '../lib/i18n';

initCrashReporting();
// Reads the device language once; only languages switched on in ACTIVE_LOCALES are used (English today).
applyDeviceLocale();

function RootLayout() {
    return (
        <AuthProvider>
            <BillingProvider>
                <PushProvider>
                    <StatusBar style="light" />
                    <Slot />
                </PushProvider>
            </BillingProvider>
        </AuthProvider>
    );
}

export default withCrashReporting(RootLayout);
