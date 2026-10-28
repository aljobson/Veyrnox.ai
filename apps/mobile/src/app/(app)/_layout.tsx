export { SignedInErrorBoundary as ErrorBoundary } from '../../components/ErrorFallback';
import { t } from '../../lib/i18n';
import { useOfflineRecovery } from '../../lib/useOfflineRecovery';
import { Text } from '../../components/ui';
import { CelebrationHost } from '../../components/CelebrationHost';
import { CheckInModal } from '../../components/CheckInModal';
import { Redirect, Stack } from 'expo-router';
import { useColorScheme } from 'react-native';
import { useAuth } from '../../auth/AuthProvider';
import { Logo } from '../../components/Logo';
import { AiConsentHost } from '../../components/AiConsentHost';
import { FirstRunGate } from '../../components/FirstRunGate';
import { OfflineBanner } from '../../components/OfflineBanner';
import { MfaGate } from '../../components/account/MfaGate';
import { HomeBackButton } from '../../components/HomeBackButton';
import { ServiceBanner } from '../../components/ServiceBanner';
import { PaywallPrompt } from '../../components/PaywallPrompt';
import { getThemePreference, paletteForScheme, resolveScheme } from '../../theme';

export default function AppLayout() {
    useOfflineRecovery();
    const { status } = useAuth();
    const systemScheme = useColorScheme();
    const palette = paletteForScheme(resolveScheme(getThemePreference(), systemScheme));
    if (status === 'signedOut') return <Redirect href="/sign-in" />;
    return (
        <>
            <AiConsentHost />
            <CelebrationHost />
            <MfaGate>
                <FirstRunGate />
                <CheckInModal />
                <PaywallPrompt />
                <Stack
                    screenLayout={({ children, route }) => (
                        <>
                            <OfflineBanner topInset={route.name === '(tabs)'} />
                            <ServiceBanner />
                            {children}
                        </>
                    )}
                    screenOptions={({ navigation }) => ({
                        headerStyle: { backgroundColor: palette.background },
                        headerTintColor: palette.text,
                        headerTitle: ({ children }) => <Text variant="title3" numberOfLines={1}>{children}</Text>,
                        headerBackButtonDisplayMode: 'minimal',
                        contentStyle: { backgroundColor: palette.background },
                        // Every screen has a way back: the native back when there is history, otherwise a button to Explore.
                        ...(navigation.canGoBack() ? {} : { headerLeft: () => <HomeBackButton /> }),
                    })}
                >
                    <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
                    <Stack.Screen name="analytics-consent" options={{ headerShown: false, gestureEnabled: false }} />
                    <Stack.Screen name="privacy-choices" options={{ title: t('analyticsConsent.choices') }} />
                    <Stack.Screen name="welcome" options={{ headerShown: false }} />
                    <Stack.Screen name="start" options={{ headerShown: false }} />
                    <Stack.Screen name="vibe" options={{ headerShown: false }} />
                    <Stack.Screen name="rate" options={{ title: t('rate.title'), headerShown: false, presentation: 'modal' }} />
                </Stack>
            </MfaGate>
        </>
    );
}
