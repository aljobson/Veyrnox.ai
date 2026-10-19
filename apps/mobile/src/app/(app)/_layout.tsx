import { Redirect, Stack } from 'expo-router';
import { useAuth } from '../../auth/AuthProvider';
import { Logo } from '../../components/Logo';
import { AiConsentHost } from '../../components/AiConsentHost';
import { OfflineBanner } from '../../components/OfflineBanner';
import { ServiceBanner } from '../../components/ServiceBanner';
import { colors } from '../../theme';

export default function AppLayout() {
    const { status } = useAuth();
    if (status === 'signedOut') return <Redirect href="/sign-in" />;
    return (
        <>
            <AiConsentHost />
            <Stack
                screenLayout={({ children }) => (
                    <>
                        <OfflineBanner />
                        <ServiceBanner />
                        {children}
                    </>
                )}
                screenOptions={{
                    headerStyle: { backgroundColor: colors.background },
                    headerTintColor: colors.text,
                    headerBackButtonDisplayMode: 'minimal',
                    contentStyle: { backgroundColor: colors.background },
                }}
            >
                <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
            </Stack>
        </>
    );
}
