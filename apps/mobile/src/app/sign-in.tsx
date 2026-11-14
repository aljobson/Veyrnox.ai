import { passkeyGate } from '../lib/passkeys';
import { useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Link, useRouter } from 'expo-router';
import { useAuth } from '../auth/AuthProvider';
import { BrandIntro } from '../components/BrandIntro';
import { SignupOffer } from '../components/SignupOffer';
import { SignedInRedirect } from '../components/SignedInRedirect';
import { Button, Icon, Text, AuthProviderButton, themedStyles, useThemedStyles } from '../components/ui';
import { ConsentRow } from '../components/ui/ConsentRow';
import { DEV_MOCK } from '../lib/config';
import { ds, colors } from '../theme';
import { t } from '../lib/i18n';
import { playSelection } from '../lib/haptics';
const PROMISES = [
    { icon: 'image', label: 'signIn.photo' },
    { icon: 'video', label: 'signIn.video' },
    { icon: 'lightbulb', label: 'signIn.idea' },
] as const;
export default function SignIn() {
    const { appleNativeAvailable, signInWithApple, signInWithOAuth, signInWithEmail, status } = useAuth();
    const router = useRouter();
    const insets = useSafeAreaInsets();
    const styles = useThemedStyles(sheets);
    const [busy, setBusy] = useState(false);
    const running = useRef(false);
    const [error, setError] = useState<string | null>(null);
    const [agreed, setAgreed] = useState(false);
    const blocked = busy || !agreed;
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
                contentContainerStyle={[styles.screen, { paddingTop: ds.space.xxl, paddingBottom: insets.bottom + ds.space.xxl }]}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
            >
                <View style={styles.hero}>
                    <BrandIntro fontSize={32} />
                    <Text variant="caption" tone="accent">{t('signIn.kicker')}</Text>
                    <Text variant="display">{t('signIn.title')}</Text>
                    <Text tone="secondary">{t('signIn.subtitle')}</Text>
                    <View accessible style={styles.promises}>
                        {PROMISES.map((p) => (
                            <View key={p.label} style={styles.promise}>
                                <Icon name={p.icon} size={20} />
                                <Text variant="footnote" tone="secondary">{t(p.label)}</Text>
                            </View>
                        ))}
                    </View>
                </View>
                <SignupOffer />
                <ConsentRow agreed={agreed} onChange={setAgreed} />
                <Text variant="footnote" tone="tertiary" accessibilityLiveRegion="polite">
                    {t(agreed ? 'signIn.ready' : 'signIn.tickFirst')}
                </Text>
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
                {passkeyGate() ? <Button variant="tertiary" icon="key" label={t('passkey.signIn')} disabled={blocked} onPress={() => router.push('/passkey')} /> : null}
                <Link href="/preview" asChild>
                    <Button variant="tertiary" label={t('preview.browse')} accessibilityRole="link" accessibilityHint={t('preview.browseHint')} />
                </Link>
                {DEV_MOCK ? (
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
    screen: { flexGrow: 1, paddingHorizontal: ds.space.gutter, gap: ds.space.md },
    hero: { gap: ds.space.lg, marginBottom: ds.space.lg },
    promises: { gap: ds.space.sm },
    promise: { flexDirection: 'row', alignItems: 'center', gap: ds.space.md },
}));
