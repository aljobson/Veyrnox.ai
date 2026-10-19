import { Redirect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { TurnstileView } from '../auth/TurnstileView';
import { useAuth } from '../auth/AuthProvider';
import { AuthError } from '../lib/auth/supabaseAuth';
import { emailAuthMessage, validateEmailForm } from '../lib/auth/emailForm';
import type { TurnstileMessage } from '../lib/auth/turnstile';
import { touchTarget } from '../lib/a11y';
import { colors } from '../theme';
import { t } from '../lib/i18n';

type Mode = 'signIn' | 'signUp';

export default function EmailAuth() {
    const { status, signInWithEmail, signUpWithEmail } = useAuth();
    const insets = useSafeAreaInsets();
    const router = useRouter();
    const [mode, setMode] = useState<Mode>('signIn');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [captcha, setCaptcha] = useState<string | null>(null);
    const [captchaError, setCaptchaError] = useState(false);
    const [resetKey, setResetKey] = useState(0);
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState<string | null>(null);

    if (status === 'signedIn') return <Redirect href="/(app)" />;

    const [, setCaptchaReady] = useState(false);
    const captchaReadyRef = useRef(false);

    // The check never reported in: the page or Cloudflare did not load.
    useEffect(() => {
        captchaReadyRef.current = false;
        setCaptchaReady(false);
        const t = setTimeout(() => setCaptchaError((e) => e || !captchaReadyRef.current), 15000);
        return () => clearTimeout(t);
    }, [resetKey]);

    function onCaptcha(m: TurnstileMessage) {
        if (m.type === 'interactive') return;
        if (m.type === 'ready') {
            captchaReadyRef.current = true;
            setCaptchaReady(true);
            return;
        }
        if (m.type === 'token') {
            setCaptcha(m.token);
            setCaptchaError(false);
        } else if (m.type === 'expired') {
            setCaptcha(null);
        } else {
            setCaptcha(null);
            setCaptchaError(true);
        }
    }

    async function submit() {
        const problem = validateEmailForm(email, password, mode === 'signUp');
        if (problem) return setMessage(problem);
        if (!captcha) return setMessage(t('email.securityFirst'));
        setBusy(true);
        setMessage(null);
        const token = captcha;
        try {
            if (mode === 'signIn') {
                await signInWithEmail(email.trim(), password, token);
            } else if (!(await signUpWithEmail(email.trim(), password, token))) {
                setMessage(t('email.checkInbox'));
                setMode('signIn');
            }
        } catch (err) {
            setMessage(emailAuthMessage(err instanceof AuthError ? err.code : 'unknown'));
        } finally {
            // A Turnstile token works once, pass or fail.
            setCaptcha(null);
            setResetKey((k) => k + 1);
            setBusy(false);
        }
    }

    const ready = !busy && captcha !== null;
    return (
        <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <ScrollView contentContainerStyle={[styles.body, { paddingTop: insets.top + 16 }]} keyboardShouldPersistTaps="handled">
                <Pressable accessibilityRole="button" style={touchTarget} onPress={() => router.back()}>
                    <Text style={styles.switch}>{t('public.vey.back')}</Text>
                </Pressable>
                <Text style={styles.heading} accessibilityRole="header">{mode === 'signIn' ? t('oauth.signIn') : t('authGate.createAccount')}</Text>
                <TextInput
                    style={styles.input}
                    value={email}
                    onChangeText={setEmail}
                    placeholder={t('authGate.email')}
                    accessibilityLabel={t('authGate.email')}
                    placeholderTextColor={colors.muted}
                    autoCapitalize="none"
                    autoComplete="email"
                    keyboardType="email-address"
                    textContentType="emailAddress"
                />
                <TextInput
                    style={styles.input}
                    value={password}
                    onChangeText={setPassword}
                    placeholder={t('email.password')}
                    accessibilityLabel={t('email.passwordLabel')}
                    placeholderTextColor={colors.muted}
                    secureTextEntry
                    autoComplete={mode === 'signIn' ? 'current-password' : 'new-password'}
                    textContentType={mode === 'signIn' ? 'password' : 'newPassword'}
                />
                <TurnstileView resetKey={resetKey} onMessage={onCaptcha} />
                {!captcha && !captchaError ? <Text style={styles.message}>{t('email.checking')}</Text> : null}
                {captchaError ? <Text style={styles.error} accessibilityRole="alert">{t('email.captchaFailed')}</Text> : null}
                <Pressable accessibilityRole="button" accessibilityLabel={mode === 'signIn' ? t('oauth.signIn') : t('authGate.createAccount')} accessibilityState={{ busy }} disabled={!ready} style={[styles.submit, !ready && styles.off]} onPress={submit}>
                    {busy ? <ActivityIndicator color={colors.accentInk} /> : <Text style={styles.submitText}>{mode === 'signIn' ? t('oauth.signIn') : t('authGate.createAccount')}</Text>}
                </Pressable>
                {message ? <Text style={styles.message} accessibilityLiveRegion="polite">{message}</Text> : null}
                <View style={styles.switchRow}>
                    <Pressable accessibilityRole="button" style={touchTarget} onPress={() => { setMode(mode === 'signIn' ? 'signUp' : 'signIn'); setMessage(null); }}>
                        <Text style={styles.switch}>{mode === 'signIn' ? t('email.newHere') : t('authGate.haveAnAccountSignIn')}</Text>
                    </Pressable>
                </View>
            </ScrollView>
        </KeyboardAvoidingView>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background },
    body: { padding: 24, gap: 12 },
    input: { color: colors.text, backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 12, padding: 14, fontSize: 16 },
    submit: { backgroundColor: colors.accent, borderRadius: 12, paddingVertical: 16, alignItems: 'center' },
    off: { opacity: 0.4 },
    submitText: { color: colors.accentInk, fontWeight: '600', fontSize: 16 },
    heading: { color: colors.text, fontSize: 28, fontWeight: '700' },
    message: { color: colors.muted },
    error: { color: colors.danger },
    switchRow: { alignItems: 'center', marginTop: 8 },
    switch: { color: colors.accent },
});
