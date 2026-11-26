export { SignedInErrorBoundary as ErrorBoundary } from '../../components/ErrorFallback';
import { t } from '../../lib/i18n';
import { useOfflineRecovery } from '../../lib/useOfflineRecovery';
import { Text, useAppearance } from '../../components/ui';
import { CelebrationHost } from '../../components/CelebrationHost';
import { CheckInModal } from '../../components/CheckInModal';
import { ReferralAttach } from '../../components/ReferralAttach';
import { Redirect, Stack, useCanGoBack } from 'expo-router';
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
import { SafeAreaView } from 'react-native-safe-area-context';
import { needsStackHorizontalSafeArea } from '../../lib/appScreenSafeArea';
import { PersistentAudioQueueProvider } from '../../components/music/PersistentAudioQueue';
import { NotificationPrimerGate } from '../../components/NotificationPrimerGate';

export const unstable_settings = { anchor: '(tabs)' };

export default function AppLayout() {
    useOfflineRecovery();
    // Reading navigation.canGoBack() inside screenOptions happens during render and React
    // Navigation warns that the value may be stale. The router hook subscribes to the
    // navigation state, so every pushed screen reliably gets either native Back or Home Back.
    const canGoBack = useCanGoBack();
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
                <NotificationPrimerGate />
                <ReferralAttach />
                <CheckInModal />
                <PaywallPrompt />
                <HardPaywallGate>
                <PersistentAudioQueueProvider>
                <Stack
                    screenLayout={({ children, route }) => (
                        <>
                            <OfflineBanner topInset={route.name === '(tabs)'} />
                            <ServiceBanner />
                            {needsStackHorizontalSafeArea(route.name)
                                ? <SafeAreaView edges={['left', 'right']} style={{ flex: 1 }}>{children}</SafeAreaView>
                                : children}
                        </>
                    )}
                    screenOptions={() => ({
                        headerStyle: { backgroundColor: palette.background },
                        headerTintColor: palette.text,
                        headerTitle: ({ children }) => <Text variant="title3" numberOfLines={1}>{children}</Text>,
                        headerBackButtonDisplayMode: 'minimal',
                        contentStyle: { backgroundColor: palette.background },
                        // Every screen has a way back: the native back when there is history, otherwise a button to Explore.
                        ...(canGoBack ? {} : { headerLeft: () => <HomeBackButton /> }),
                    })}
                >
                    <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
                    <Stack.Screen name="analytics-consent" options={{ headerShown: false, gestureEnabled: false }} />
                    <Stack.Screen name="privacy-choices" options={{ title: t('analyticsConsent.choices') }} />
                    <Stack.Screen name="welcome" options={{ headerShown: false }} />
                    <Stack.Screen name="first-run" options={{ headerShown: false, gestureEnabled: false }} />
                    <Stack.Screen name="notification-primer" options={{ headerShown: false, gestureEnabled: false }} />
                    <Stack.Screen name="vibe" options={{ headerShown: false }} />
                    <Stack.Screen name="rate" options={{ title: t('rate.title'), headerShown: false, presentation: 'modal' }} />
                    <Stack.Screen name="paywall" options={{ title: t('billing.paywall.title'), headerShown: false, presentation: 'modal' }} />
                    {/* Dynamic routes: a static fallback title, so an early error or loading return can never show the route's file name. A screen's own title still wins. */}
                    <Stack.Screen name="chat/[id]" options={{ title: t('chat.lLMChat') }} />
                    <Stack.Screen name="chat/persona/[id]" options={{ title: t('chat.editpersona') }} />
                    <Stack.Screen name="cinema/[id]" options={{ title: t('menu.cinema') }} />
                    <Stack.Screen name="cinema/creator/[id]" options={{ title: t('menu.cinema') }} />
                    <Stack.Screen name="cinema/series/[slug]" options={{ title: t('menu.cinema') }} />
                    <Stack.Screen name="cinema/watch/[id]" options={{ title: t('cinema.nowplaying') }} />
                    <Stack.Screen name="create/[modelId]" options={{ title: t('label.Create') }} />
                    <Stack.Screen name="editor/[projectId]" options={{ title: t('editor.title') }} />
                    <Stack.Screen name="features/[slug]" options={{ title: t('features.creativetool') }} />
                    <Stack.Screen name="film/shot/[id]" options={{ title: t('film.shot') }} />
                    <Stack.Screen name="guides/[id]" options={{ title: t('helpGuides.title') }} />
                    <Stack.Screen name="job/[id]" options={{ title: t('job.title') }} />
                    <Stack.Screen name="legal/[doc]" options={{ title: t('label.Terms') }} />
                    <Stack.Screen name="model/[id]" options={{ title: t('mdl.title') }} />
                    <Stack.Screen name="model/compare" options={{ title: t('modelCompare.title') }} />
                    <Stack.Screen name="music/create" options={{ title: t('music.create.title') }} />
                    <Stack.Screen name="music/track/[slug]" options={{ title: t('musicPublic.track') }} />
                    <Stack.Screen name="music/creator/[handle]" options={{ title: t('musicPublic.creator') }} />
                    <Stack.Screen name="music/album/[slug]" options={{ title: t('musicAlbums.publicTitle') }} />
                    <Stack.Screen name="music/albums/[id]" options={{ title: t('musicAlbums.title') }} />
                    <Stack.Screen name="music/playlists/[id]" options={{ title: t('musicPlaylists.title') }} />
                    <Stack.Screen name="music/[id]" options={{ title: t('music.title') }} />
                    <Stack.Screen name="beats/[id]" options={{ title: t('beat.title') }} />
                    <Stack.Screen name="beats/piano/[id]" options={{ title: t('beatPiano.title') }} />
                    <Stack.Screen name="oddlings/[id]" options={{ title: t('oddlings.title') }} />
                    <Stack.Screen name="projects/[id]" options={{ title: t('projects.project') }} />
                    <Stack.Screen name="publish/post/[id]" options={{ title: t('publish.post') }} />
                    <Stack.Screen name="templates/[id]" options={{ title: t('presets.templates') }} />
                </Stack>
                </PersistentAudioQueueProvider>
                </HardPaywallGate>
                </AgeConfirmationGate>
            </MfaGate>
        </>
    );
}
