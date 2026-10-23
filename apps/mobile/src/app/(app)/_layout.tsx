import { CheckInModal } from '../../components/CheckInModal';
import { Redirect, Stack } from 'expo-router';
import { useAuth } from '../../auth/AuthProvider';
import { Logo } from '../../components/Logo';
import { AiConsentHost } from '../../components/AiConsentHost';
import { FirstRunGate } from '../../components/FirstRunGate';
import { OfflineBanner } from '../../components/OfflineBanner';
import { MfaGate } from '../../components/account/MfaGate';
import { HomeBackButton } from '../../components/HomeBackButton';
import { ServiceBanner } from '../../components/ServiceBanner';
import { colors } from '../../theme';

export default function AppLayout() {
    const { status } = useAuth();
    if (status === 'signedOut') return <Redirect href="/sign-in" />;
    return (
        <>
            <AiConsentHost />
            <MfaGate>
            <FirstRunGate />
            <CheckInModal />
            <Stack
                screenLayout={({ children }) => (
                    <>
                        <OfflineBanner />
                        <ServiceBanner />
                        {children}
                    </>
                )}
                screenOptions={({ navigation }) => ({
                    headerStyle: { backgroundColor: colors.background },
                    headerTintColor: colors.text,
                    headerBackButtonDisplayMode: 'minimal',
                    contentStyle: { backgroundColor: colors.background },
                    // Every screen has a way back: the native back when there is history, otherwise a button to Explore.
                    ...(navigation.canGoBack() ? {} : { headerLeft: () => <HomeBackButton /> }),
                })}
            >
                <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
            </Stack>
            </MfaGate>
        </>
    );
}
