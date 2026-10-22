import { passkeyGate } from '../lib/passkeys';
import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Link, Redirect, useRouter } from 'expo-router';
import { useAuth } from '../auth/AuthProvider';
import { MascotWordmark } from '../components/MascotWordmark';
import { LEGAL_LINKS, MIN_AGE } from '../lib/account';
import { DEV_MOCK } from '../lib/config';
import { colors, disabledOpacity, fonts, radius, space, type } from '../theme';
import { splitSlots, t } from '../lib/i18n';
import { MIN_TARGET } from '../lib/a11y';
import { playSelection } from '../lib/haptics';

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
        void playSelection();
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
        <ScrollView style={styles.scroll} contentContainerStyle={[styles.screen, { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 }]} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            <View style={styles.hero}>
                <Text style={styles.kicker}>{t('signIn.kicker')}</Text>
                <MascotWordmark fontSize={32} />
                <Text style={styles.title} accessibilityRole="header">{t('signIn.title')}</Text>
                <Text style={styles.subtitle}>{t('signIn.subtitle')}</Text>
                <View style={styles.promiseRow} accessibilityLabel={t('signIn.promiseLabel')}>
                    <View style={[styles.promise, styles.promisePhoto]}>
                        <Text style={styles.promiseEmoji} accessibilityElementsHidden importantForAccessibility="no">📸</Text>
                        <Text style={styles.promiseText}>{t('signIn.photo')}</Text>
                    </View>
                    <View style={[styles.promise, styles.promiseVideo]}>
                        <Text style={styles.promiseEmoji} accessibilityElementsHidden importantForAccessibility="no">🎬</Text>
                        <Text style={styles.promiseText}>{t('signIn.video')}</Text>
                    </View>
                    <View style={[styles.promise, styles.promiseIdea]}>
                        <Text style={styles.promiseEmoji} accessibilityElementsHidden importantForAccessibility="no">✨</Text>
                        <Text style={styles.promiseText}>{t('signIn.idea')}</Text>
                    </View>
                </View>
            </View>

            <View style={styles.authCard}>
                <Text style={styles.authTitle}>{t('signIn.choose')}</Text>
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
                    style={({ pressed }) => [styles.agree, agreed && styles.agreeOn, pressed && styles.pressed]}
                    onPress={() => { void playSelection(); setAgreed((v) => !v); }}
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
                <Text style={[styles.hint, agreed && styles.ready]}>{t(agreed ? 'signIn.ready' : 'signIn.tickFirst')}</Text>

                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={t('authGate.continueWithApple')}
                    disabled={blocked}
                    style={({ pressed }) => [styles.button, styles.apple, blocked && styles.off, pressed && !blocked && styles.pressed]}
                    onPress={() => run(appleNativeAvailable ? signInWithApple : () => signInWithOAuth('apple'))}
                >
                    <View style={styles.buttonRow}><Text style={styles.appleIcon}></Text><Text style={[styles.buttonText, styles.appleText]}>{t('authGate.continueWithApple')}</Text></View>
                </Pressable>
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={t('authGate.continueWithGoogle')}
                    disabled={blocked}
                    style={({ pressed }) => [styles.button, styles.google, blocked && styles.off, pressed && !blocked && styles.pressed]}
                    onPress={() => run(() => signInWithOAuth('google'))}
                >
                    <View style={styles.buttonRow}><View style={styles.googleMark}><Text style={styles.googleIcon}>G</Text></View><Text style={[styles.buttonText, styles.lightButtonText]}>{t('authGate.continueWithGoogle')}</Text></View>
                </Pressable>
                {passkeyGate() ? (
                    <Link href="/passkey" asChild>
                        <Pressable accessibilityRole="button" accessibilityLabel={t('passkey.signIn')} accessibilityState={{ disabled: blocked }}
                            disabled={blocked} style={StyleSheet.flatten([styles.button, styles.passkey, { minHeight: MIN_TARGET }, blocked && styles.off])}>
                            <View style={styles.buttonRow}><Text style={styles.buttonIcon}>🔑</Text><Text style={[styles.buttonText, styles.lightButtonText]}>{t('passkey.signIn')}</Text></View>
                        </Pressable>
                    </Link>
                ) : null}
                <Link href="/email" asChild>
                    <Pressable accessibilityRole="button" accessibilityLabel={t('signIn.email')} disabled={blocked} style={StyleSheet.flatten([styles.button, styles.email, blocked && styles.off])}>
                        <View style={styles.buttonRow}><Text style={styles.buttonIcon}>✉️</Text><Text style={[styles.buttonText, styles.lightButtonText]}>{t('signIn.email')}</Text></View>
                    </Pressable>
                </Link>
            </View>
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
    screen: { flexGrow: 1, backgroundColor: colors.background, paddingHorizontal: 20, gap: space.lg },
    hero: { gap: space.sm },
    kicker: { color: colors.accent, fontSize: 12, fontWeight: '900', letterSpacing: 1.6 },
    title: { color: colors.text, fontFamily: fonts.displayHeavy, fontSize: 31, lineHeight: 35, marginTop: space.md },
    subtitle: { color: colors.body, ...type.body, lineHeight: 22 },
    promiseRow: { flexDirection: 'row', gap: 8, marginTop: space.md },
    promise: { flex: 1, minHeight: 92, borderRadius: 18, padding: 10, justifyContent: 'space-between' },
    promisePhoto: { backgroundColor: '#FFE0F0' },
    promiseVideo: { backgroundColor: '#DDF5FF' },
    promiseIdea: { backgroundColor: '#DDF9F1' },
    promiseEmoji: { fontSize: 24, lineHeight: 29 },
    promiseText: { color: '#17171A', fontSize: 13, lineHeight: 16, fontWeight: '800' },
    authCard: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 24, padding: 14, gap: 10 },
    authTitle: { color: colors.text, fontFamily: fonts.display, fontSize: 20, marginBottom: 2 },
    hint: { color: colors.muted, ...type.footnote, marginBottom: 2 },
    ready: { color: colors.accent, fontWeight: '700' },
    button: {
        minHeight: 54,
        borderColor: colors.border,
        borderWidth: 1,
        borderRadius: 16,
        paddingHorizontal: space.lg,
        alignItems: 'center',
        justifyContent: 'center',
    },
    apple: { backgroundColor: '#17171A', borderColor: '#17171A' },
    google: { backgroundColor: '#E2F4FF', borderColor: '#8AD4F5' },
    passkey: { backgroundColor: '#E9DEFF', borderColor: '#C5A8FF' },
    email: { backgroundColor: '#DDF9F1', borderColor: '#93DFC9' },
    buttonRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 },
    buttonText: { color: colors.text, ...type.label },
    lightButtonText: { color: '#17171A' },
    appleText: { color: '#FFFFFF' },
    appleIcon: { color: '#FFFFFF', fontSize: 21 },
    googleMark: { width: 24, height: 24, borderRadius: 12, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' },
    googleIcon: { color: '#2367CF', fontSize: 15, fontWeight: '900' },
    buttonIcon: { fontSize: 18 },
    pressed: { opacity: 0.78, transform: [{ scale: 0.985 }] },
    browse: { paddingVertical: 14, alignItems: 'center', minHeight: MIN_TARGET },
    browseText: { color: colors.accent, ...type.callout, fontWeight: '700' },
    off: { opacity: disabledOpacity },
    agree: { flexDirection: 'row', gap: space.md, alignItems: 'center', minHeight: MIN_TARGET, borderRadius: 14, padding: 10, backgroundColor: '#FFF2C7', borderWidth: 2, borderColor: '#FFF2C7' },
    agreeOn: { backgroundColor: '#FFD65A', borderColor: '#E4A900' },
    box: { width: 26, height: 26, borderRadius: radius.sm, borderWidth: 2, borderColor: '#9D7600', alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFFFFF' },
    boxOn: { backgroundColor: colors.accent, borderColor: colors.accent },
    tick: { color: colors.accentInk, fontWeight: '700' },
    agreeText: { flex: 1, color: '#34343A', ...type.footnote, lineHeight: 19 },
    link: { color: '#725500', textDecorationLine: 'underline', fontWeight: '700' },
    spinner: { marginTop: space.sm },
    error: { color: colors.danger, marginTop: space.sm },
});
