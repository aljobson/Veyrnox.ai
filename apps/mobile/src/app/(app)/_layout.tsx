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
import { getThemePreference, paletteForScheme, resolveScheme } from '../../theme';

export default function AppLayout() {
    const { status } = useAuth();
    const systemScheme = useColorScheme();
    const palette = paletteForScheme(resolveScheme(getThemePreference(), systemScheme));
    if (status === 'signedOut') return <Redirect href="/sign-in" />;
    return (
        <>
            <AiConsentHost />
            <MfaGate>
            <FirstRunGate />
            <Stack
                screenLayout={({ children }) => (
                    <>
                        <OfflineBanner />
                        <ServiceBanner />
                        {children}
                    </>
                )}
                screenOptions={({ navigation }) => ({
                    headerStyle: { backgroundColor: palette.background },
                    headerTintColor: palette.text,
                    headerBackButtonDisplayMode: 'minimal',
                    contentStyle: { backgroundColor: palette.background },
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
