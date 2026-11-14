export { SignedInErrorBoundary as ErrorBoundary } from '../../components/ErrorFallback';
import { t } from '../../lib/i18n';
import { useOfflineRecovery } from '../../lib/useOfflineRecovery';
import { Text, useAppearance } from '../../components/ui';
import { CelebrationHost } from '../../components/CelebrationHost';
import { CheckInModal } from '../../components/CheckInModal';
import { ReferralAttach } from '../../components/ReferralAttach';
import { Redirect, Stack } from 'expo-router';
import { useEffect } from 'react';
import { forgetPendingLink } from '../../lib/pendingLink';
import { useAuth } from '../../auth/AuthProvider';
import { Logo } from '../../components/Logo';
import { AiConsentHost } from '../../components/AiConsentHost';
import { FirstRunGate } from '../../components/FirstRunGate';
import { OfflineBanner } from '../../components/OfflineBanner';
import { MfaGate } from '../../components/account/MfaGate';
import { AgeConfirmationGate } from '../../components/account/AgeConfirmationGate';
import { HomeBackButton } from '../../components/HomeBackButton';
import { ServiceBanner } from '../../components/ServiceBanner';
import { PaywallPrompt } from '../../components/PaywallPrompt';
import { HardPaywallGate } from '../../components/HardPaywallGate';
import { paletteForScheme } from '../../theme';

export default function AppLayout() {
    useOfflineRecovery();
    const { status, generation } = useAuth();
    // Live theme: the back chevron takes headerTintColor, so a palette read once would leave it dark-on-dark after a switch.
    const { settings, scheme } = useAppearance();
    const palette = paletteForScheme(scheme, settings);
    // A link opened while already signed in went straight to its screen: nothing is owed after a later sign-in.
    useEffect(() => { if (status === 'signedIn') forgetPendingLink(); }, [status]);
    if (status === 'signedOut') return <Redirect href="/sign-in" />;
    return (
        <>
            <AiConsentHost />
            <CelebrationHost />
            <MfaGate key={generation}>
                <AgeConfirmationGate>
                <FirstRunGate />
                <ReferralAttach />
                <CheckInModal />
                <PaywallPrompt />
                <HardPaywallGate>
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
                    <Stack.Screen name="first-run" options={{ headerShown: false, gestureEnabled: false }} />
                    <Stack.Screen name="vibe" options={{ headerShown: false }} />
                    <Stack.Screen name="rate" options={{ title: t('rate.title'), headerShown: false, presentation: 'modal' }} />
                    <Stack.Screen name="paywall" options={{ title: t('billing.paywall.title'), headerShown: false, presentation: 'modal' }} />
                </Stack>
                </HardPaywallGate>
                </AgeConfirmationGate>
            </MfaGate>
        </>
    );
}
