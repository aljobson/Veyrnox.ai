import { Slot } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { AuthProvider } from '../auth/AuthProvider';

export default function RootLayout() {
    return (
        <AuthProvider>
            <StatusBar style="light" />
            <Slot />
        </AuthProvider>
    );
}
