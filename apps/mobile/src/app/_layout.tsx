import { Slot } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { AuthProvider } from '../auth/AuthProvider';
import { BillingProvider } from '../billing/BillingProvider';

export default function RootLayout() {
    return (
        <AuthProvider>
            <BillingProvider>
                <StatusBar style="light" />
                <Slot />
            </BillingProvider>
        </AuthProvider>
    );
}
