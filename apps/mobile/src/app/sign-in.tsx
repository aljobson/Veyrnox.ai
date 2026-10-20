import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Link, Redirect, useRouter } from 'expo-router';
import { useAuth } from '../auth/AuthProvider';
import { MascotWordmark } from '../components/MascotWordmark';
import { LEGAL_LINKS, MIN_AGE } from '../lib/account';
import { DEV_MOCK } from '../lib/config';
import { colors, disabledOpacity, radius, space, type } from '../theme';
import { splitSlots, t } from '../lib/i18n';
import { MIN_TARGET } from '../lib/a11y';

export default function SignIn() {
    const { appleNativeAvailable, signInWithApple, signInWithOAuth, signInWithEmail, status } = useAuth();
    const router = useRouter();
    // This screen has no navigation bar, so it keeps clear of the status bar and home indicator itself.
    const insets = useSafeAreaInsets();
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [agreed, setAgreed] = useState(false);
    const blocked = busy || !agreed;

    async function run(action: () => Promise<void>) {
        setBusy(true);
        setError(null);
        try {
            await action();
            router.replace('/(app)/(tabs)');
        } catch {
            setError(t('signIn.failed'));
        } finally {
            setBusy(false);
        }
    }

    if (status === 'signedIn') return <Redirect href="/(app)/(tabs)" />;

    return (
        <ScrollView style={styles.scroll} contentContainerStyle={[styles.screen, { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 }]} keyboardShouldPersistTaps="handled">
            <MascotWordmark />
            <Text style={styles.subtitle}>{t('signIn.subtitle')}</Text>
            <Pressable
                accessibilityRole="checkbox"
                accessibilityLabel={t('signIn.agree', { age: MIN_AGE, terms: t('label.Terms'), privacy: t('chrome.privacyPolicy') })}
                accessibilityState={{ checked: agreed }}
                // The Terms and Privacy links sit inside the checkbox text, which a screen reader cannot reach; offer them as actions.
                accessibilityActions={[
                    { name: 'terms', label: t('signIn.openTerms') },
                    { name: 'privacy', label: t('signIn.openPrivacy') },
                ]}
                onAccessibilityAction={(e) => void WebBrowser.openBrowserAsync(LEGAL_LINKS[e.nativeEvent.actionName === 'terms' ? 0 : 1].url)}
                style={styles.agree}
                onPress={() => setAgreed((v) => !v)}
            >
                <View style={[styles.box, agreed && styles.boxOn]}>{agreed ? <Text style={styles.tick}>✓</Text> : null}</View>
                <Text style={styles.agreeText}>
                    {splitSlots(t('signIn.agree', { age: MIN_AGE }), ['terms', 'privacy']).map((piece, i) =>
                        typeof piece === 'string' ? (
                            piece
                        ) : (
                            <Text key={i} style={styles.link} accessibilityRole="link" onPress={() => WebBrowser.openBrowserAsync(LEGAL_LINKS[piece.slot === 'terms' ? 0 : 1].url)}>
                                {t(piece.slot === 'terms' ? 'label.Terms' : 'chrome.privacyPolicy')}
                            </Text>
                        ),
                    )}
                </Text>
            </Pressable>
            {agreed ? null : <Text style={styles.hint}>{t('signIn.tickFirst')}</Text>}
            <Pressable
                accessibilityRole="button"
                disabled={blocked}
                style={[styles.button, blocked && styles.off]}
                onPress={() => run(appleNativeAvailable ? signInWithApple : () => signInWithOAuth('apple'))}
            >
                <Text style={styles.buttonText}>{t('authGate.continueWithApple')}</Text>
            </Pressable>
            <Pressable
                accessibilityRole="button"
                disabled={blocked}
                style={[styles.button, blocked && styles.off]}
                onPress={() => run(() => signInWithOAuth('google'))}
            >
                <Text style={styles.buttonText}>{t('authGate.continueWithGoogle')}</Text>
            </Pressable>
            <Link href="/email" asChild>
                <Pressable accessibilityRole="button" disabled={blocked} style={StyleSheet.flatten([styles.button, blocked && styles.off])}>
                    <Text style={styles.buttonText}>{t('signIn.email')}</Text>
                </Pressable>
            </Link>
            <Link href="/preview" asChild>
                <Pressable accessibilityRole="link" accessibilityHint={t('preview.browseHint')} style={styles.browse}>
                    <Text style={styles.browseText}>{t('preview.browse')}</Text>
                </Pressable>
            </Link>
            {DEV_MOCK ? (
                <Pressable accessibilityRole="button" disabled={blocked} style={[styles.button, blocked && styles.off]} onPress={() => run(() => signInWithEmail('demo@veyrnox.ai', 'demo-password', 'mock'))}>
                    <Text style={styles.buttonText}>{t('signIn.demo')}</Text>
                </Pressable>
            ) : null}
            {busy ? <ActivityIndicator color={colors.accent} style={styles.spinner} accessibilityLabel={t('signIn.busy')} /> : null}
            {error ? <Text style={styles.error} accessibilityRole="alert" accessibilityLiveRegion="polite">{error}</Text> : null}
        </ScrollView>
    );
}

const styles = StyleSheet.create({
    scroll: { flex: 1, backgroundColor: colors.background },
    screen: { flexGrow: 1, backgroundColor: colors.background, padding: space.xl, justifyContent: 'center', gap: space.md },
    title: { color: colors.text, ...type.titleLarge },
    subtitle: { color: colors.muted, ...type.body, marginBottom: space.lg },
    hint: { color: colors.muted, ...type.footnote, marginBottom: space.md },
    button: {
        backgroundColor: colors.surface,
        borderColor: colors.border,
        borderWidth: 1,
        borderRadius: radius.lg,
        paddingVertical: space.lg,
        alignItems: 'center',
    },
    buttonText: { color: colors.text, ...type.label },
    browse: { paddingVertical: 14, alignItems: 'center', minHeight: MIN_TARGET },
    browseText: { color: colors.muted, ...type.callout, textDecorationLine: 'underline' },
    off: { opacity: disabledOpacity },
    agree: { flexDirection: 'row', gap: space.md, alignItems: 'center', marginBottom: space.sm, minHeight: MIN_TARGET },
    box: { width: 24, height: 24, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.borderStrong, alignItems: 'center', justifyContent: 'center' },
    boxOn: { backgroundColor: colors.accent, borderColor: colors.accent },
    tick: { color: colors.accentInk, fontWeight: '700' },
    agreeText: { flex: 1, color: colors.body, ...type.footnote },
    link: { color: colors.accent, textDecorationLine: 'underline' },
    spinner: { marginTop: space.sm },
    error: { color: colors.danger, marginTop: space.sm },
});
