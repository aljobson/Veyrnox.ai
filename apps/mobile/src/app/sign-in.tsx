import { passkeyGate } from '../lib/passkeys';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Link, useLocalSearchParams, useRouter } from 'expo-router';
import { useAuth } from '../auth/AuthProvider';
import { BrandIntro } from '../components/BrandIntro';
import { SignupOffer } from '../components/SignupOffer';
import { SignedInRedirect } from '../components/SignedInRedirect';
import { Button, Text, AuthProviderButton, themedStyles, useThemedStyles } from '../components/ui';
import { ConsentRow } from '../components/ui/ConsentRow';
import { DEV_MOCK } from '../lib/config';
import { ds, colors } from '../theme';
import { t } from '../lib/i18n';
import { playSelection } from '../lib/haptics';
import { captureEvent } from '../lib/analytics/events';
import { useAnnouncement } from '../lib/useAnnouncement';

export default function SignIn() {
    const { appleNativeAvailable, signInWithApple, signInWithOAuth, signInWithEmail, status } = useAuth();
    const router = useRouter();
    const { from } = useLocalSearchParams<{ from?: string }>();
    const personalised = from === 'onboarding';
    const compact = personalised || from === 'existing' || from === 'preview';
    const entrySource = personalised ? 'personalised' : from === 'existing' ? 'existing' : from === 'preview' ? 'preview' : 'direct';
    const insets = useSafeAreaInsets();
    const styles = useThemedStyles(sheets);
    const [busy, setBusy] = useState(false);
    const running = useRef(false);
    const [error, setError] = useState<string | null>(null);
    const [agreed, setAgreed] = useState(false);
    const blocked = busy || !agreed;
    useAnnouncement(agreed ? t('signIn.ready') : null, { everywhere: true });
    useEffect(() => { if (status === 'signedOut') captureEvent('sign_in_started', { source: entrySource }); }, [entrySource, status]);
    async function run(action: () => Promise<void>) {
        if (!agreed || busy || running.current) return;
        running.current = true;
        void playSelection();
        setBusy(true);
        setError(null);
        try {
            // A finished sign-in flips status, and the redirect below takes over; a cancelled one stays here.
            await action();
        } catch {
            setError(t('signIn.failed'));
        } finally {
            running.current = false;
            setBusy(false);
        }
    }

    if (status === 'signedIn') return <SignedInRedirect />;
    return (
        // The ScrollView starts below the status bar, so scrolled content never draws under the clock.
        <View style={[styles.frame, { paddingTop: insets.top }]}>
            <ScrollView
                style={styles.scroll}
                contentContainerStyle={[styles.screen, {
                    paddingTop: ds.space.xxl,
                    paddingRight: insets.right + ds.space.gutter,
                    paddingBottom: insets.bottom + ds.space.xxl,
                    paddingLeft: insets.left + ds.space.gutter,
                }]}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
            >
                <View style={styles.hero}>
                    <BrandIntro fontSize={32} />
                    <Text variant="display">{personalised ? t('onboarding.signIn.title') : t('signIn.title')}</Text>
                    <Text tone="secondary">{personalised ? t('onboarding.signIn.body') : t('signIn.subtitle')}</Text>
                </View>
                {!compact ? <SignupOffer /> : null}
                <ConsentRow agreed={agreed} onChange={setAgreed} />
                {!compact && agreed ? (
                    <Text variant="footnote" tone="tertiary">
                        {t('signIn.ready')}
                    </Text>
                ) : null}
                <AuthProviderButton
                    provider="apple"
                    consent={agreed}
                    busy={busy}
                    nativeAvailable={appleNativeAvailable}
                    onPress={() => void run(appleNativeAvailable ? signInWithApple : () => signInWithOAuth('apple'))}
                />
                <AuthProviderButton provider="google" consent={agreed} busy={busy} onPress={() => void run(() => signInWithOAuth('google'))} />
                <AuthProviderButton
                    provider="email"
                    consent={agreed}
                    busy={busy}
                    onPress={() => {
                        if (!blocked) router.push('/email');
                    }}
                />
                {!compact && passkeyGate() ? <Button variant="tertiary" icon="key" label={t('passkey.signIn')} disabled={blocked} onPress={() => router.push('/passkey')} /> : null}
                {!compact ? (
                    <Link href="/preview" asChild>
                        <Button variant="tertiary" label={t('preview.browse')} accessibilityRole="link" accessibilityHint={t('preview.browseHint')} />
                    </Link>
                ) : null}
                {!compact && DEV_MOCK ? (
                    <Button
                        variant="tertiary"
                        label={t('signIn.demo')}
                        disabled={blocked}
                        onPress={() => void run(() => signInWithEmail('demo@veyrnox.ai', 'demo-password', 'mock'))}
                    />
                ) : null}
                {busy ? <ActivityIndicator color={colors.accent} accessibilityLabel={t('signIn.busy')} /> : null}
                {error ? (
                    <Text tone="danger" accessibilityRole="alert" accessibilityLiveRegion="polite">
                        {error}
                    </Text>
                ) : null}
            </ScrollView>
        </View>
    );
}

const sheets = themedStyles((p) => ({
    frame: { flex: 1, backgroundColor: p.bg },
    scroll: { flex: 1 },
    screen: { flexGrow: 1, gap: ds.space.md },
    hero: { gap: ds.space.md, marginBottom: ds.space.sm },
}));
