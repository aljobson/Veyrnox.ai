import { Redirect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useEffect, useRef, useState, type ComponentRef } from 'react';
import { ActivityIndicator, Keyboard, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { TurnstileView } from '../auth/TurnstileView';
import { useAuth } from '../auth/AuthProvider';
import { AuthError } from '../lib/auth/supabaseAuth';
import { emailAuthMessage, validateEmailForm } from '../lib/auth/emailForm';
import type { TurnstileMessage } from '../lib/auth/turnstile';
import { touchTarget } from '../lib/a11y';
import { colors, fonts } from '../theme';
import { t } from '../lib/i18n';
import { playError, playSelection, playSuccess } from '../lib/haptics';

type Mode = 'signIn' | 'signUp';

export default function EmailAuth() {
    const { status, appleNativeAvailable, signInWithApple, signInWithOAuth, signInWithEmail, signUpWithEmail } = useAuth();
    const insets = useSafeAreaInsets();
    const router = useRouter();
    const [mode, setMode] = useState<Mode>('signIn');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [captcha, setCaptcha] = useState<string | null>(null);
    const [captchaError, setCaptchaError] = useState(false);
    const [resetKey, setResetKey] = useState(0);
    const [busy, setBusy] = useState(false);
    const [providerBusy, setProviderBusy] = useState<'apple' | 'google' | null>(null);
    const [message, setMessage] = useState<string | null>(null);
    const [messageTone, setMessageTone] = useState<'error' | 'success'>('error');
    const [focused, setFocused] = useState<'email' | 'password' | null>(null);
    const [passwordVisible, setPasswordVisible] = useState(false);
    const captchaReadyRef = useRef(false);
    const passwordRef = useRef<ComponentRef<typeof TextInput>>(null);

    // The check never reported in: the page or Cloudflare did not load.
    useEffect(() => {
        captchaReadyRef.current = false;
        setCaptchaError(false);
        const t = setTimeout(() => setCaptchaError((e) => e || !captchaReadyRef.current), 15000);
        return () => clearTimeout(t);
    }, [resetKey]);

    if (status === 'signedIn') return <Redirect href="/(app)/(tabs)" />;

    function onCaptcha(m: TurnstileMessage) {
        if (m.type === 'interactive') return;
        if (m.type === 'ready') {
            captchaReadyRef.current = true;
            return;
        }
        if (m.type === 'token') {
            setCaptcha(m.token);
            setCaptchaError(false);
            void playSuccess();
        } else if (m.type === 'expired') {
            setCaptcha(null);
        } else {
            setCaptcha(null);
            setCaptchaError(true);
        }
    }

    async function submit() {
        const problem = validateEmailForm(email, password, mode === 'signUp');
        if (problem) {
            setMessageTone('error');
            setMessage(problem);
            void playError();
            return;
        }
        if (!captcha) {
            setMessageTone('error');
            setMessage(t('email.securityFirst'));
            void playError();
            return;
        }
        setBusy(true);
        setMessage(null);
        const token = captcha;
        try {
            if (mode === 'signIn') {
                await signInWithEmail(email.trim(), password, token);
                void playSuccess();
            } else if (!(await signUpWithEmail(email.trim(), password, token))) {
                setMessageTone('success');
                setMessage(t('email.checkInbox'));
                setMode('signIn');
                void playSuccess();
            }
        } catch (err) {
            setMessageTone('error');
            setMessage(emailAuthMessage(err instanceof AuthError ? err.code : 'unknown'));
            void playError();
        } finally {
            // A Turnstile token works once, pass or fail.
            setCaptcha(null);
            setResetKey((k) => k + 1);
            setBusy(false);
        }
    }

    async function useProvider(provider: 'apple' | 'google') {
        if (busy || providerBusy) return;
        void playSelection();
        setProviderBusy(provider);
        setMessage(null);
        try {
            if (provider === 'apple') {
                await (appleNativeAvailable ? signInWithApple() : signInWithOAuth('apple'));
            } else {
                await signInWithOAuth('google');
            }
            void playSuccess();
        } catch {
            setMessageTone('error');
            setMessage(t('signIn.failed'));
            void playError();
        } finally {
            setProviderBusy(null);
        }
    }

    function chooseMode(next: Mode) {
        if (next === mode) return;
        void playSelection();
        setMode(next);
        setMessage(null);
    }

    function retrySecurityCheck() {
        void playSelection();
        setCaptcha(null);
        setCaptchaError(false);
        setMessage(null);
        setResetKey((k) => k + 1);
    }

    const authBusy = busy || providerBusy !== null;
    const ready = !authBusy && captcha !== null;
    return (
        <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <ScrollView
                contentContainerStyle={[styles.body, { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 24 }]}
                keyboardShouldPersistTaps="handled"
                keyboardDismissMode="interactive"
                showsVerticalScrollIndicator={false}
            >
                <Pressable accessibilityRole="button" style={({ pressed }) => [touchTarget, styles.back, pressed && styles.pressed]} onPress={() => router.back()}>
                    <Text style={styles.backText}>‹ {t('public.vey.back')}</Text>
                </Pressable>

                <View style={styles.hero}>
                    <Text style={styles.kicker}>{t('email.kicker')}</Text>
                    <Text style={styles.heading} accessibilityRole="header">{mode === 'signIn' ? t('email.signInTitle') : t('email.signUpTitle')}</Text>
                    <Text style={styles.lead}>{t(mode === 'signIn' ? 'email.signInBody' : 'email.signUpBody')}</Text>
                </View>

                <View style={styles.modeRow} accessibilityRole="tablist">
                    {(['signIn', 'signUp'] as const).map((option) => {
                        const selected = mode === option;
                        const label = t(option === 'signIn' ? 'oauth.signIn' : 'authGate.createAccount');
                        return (
                            <Pressable
                                key={option}
                                accessibilityRole="tab"
                                accessibilityLabel={label}
                                accessibilityState={{ selected }}
                                style={({ pressed }) => [styles.mode, selected && (option === 'signIn' ? styles.modeSignIn : styles.modeSignUp), pressed && styles.pressed]}
                                onPress={() => chooseMode(option)}
                            >
                                <Text style={[styles.modeText, selected && styles.modeTextOn]}>{label}</Text>
                            </Pressable>
                        );
                    })}
                </View>

                <View style={styles.providerGroup}>
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={t('authGate.continueWithApple')}
                        accessibilityState={{ busy: providerBusy === 'apple', disabled: authBusy }}
                        disabled={authBusy}
                        style={({ pressed }) => [styles.providerButton, styles.providerApple, authBusy && providerBusy !== 'apple' && styles.off, pressed && !authBusy && styles.pressed]}
                        onPress={() => void useProvider('apple')}
                    >
                        {providerBusy === 'apple' ? (
                            <ActivityIndicator color="#FFFFFF" />
                        ) : (
                            <View style={styles.providerButtonRow}>
                                <Text style={styles.appleIcon}></Text>
                                <Text style={styles.providerAppleText}>{t('authGate.continueWithApple')}</Text>
                            </View>
                        )}
                    </Pressable>
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={t('authGate.continueWithGoogle')}
                        accessibilityState={{ busy: providerBusy === 'google', disabled: authBusy }}
                        disabled={authBusy}
                        style={({ pressed }) => [styles.providerButton, styles.providerGoogle, authBusy && providerBusy !== 'google' && styles.off, pressed && !authBusy && styles.pressed]}
                        onPress={() => void useProvider('google')}
                    >
                        {providerBusy === 'google' ? (
                            <ActivityIndicator color="#2367CF" />
                        ) : (
                            <View style={styles.providerButtonRow}>
                                <View style={styles.googleMark}><Text style={styles.googleIcon}>G</Text></View>
                                <Text style={styles.providerGoogleText}>{t('authGate.continueWithGoogle')}</Text>
                            </View>
                        )}
                    </Pressable>
                </View>

                <View style={styles.divider} accessibilityLabel={t('email.orUseEmail')}>
                    <View style={styles.dividerLine} />
                    <Text style={styles.dividerText}>{t('email.orUseEmail')}</Text>
                    <View style={styles.dividerLine} />
                </View>

                <View style={styles.formCard}>
                    <Text style={styles.fieldLabel}>{t('authGate.email')}</Text>
                    <View style={[styles.inputShell, styles.emailShell, focused === 'email' && styles.emailShellOn]}>
                        <Text style={styles.inputIcon} accessibilityElementsHidden importantForAccessibility="no">✉️</Text>
                        <TextInput
                            style={styles.input}
                            value={email}
                            onChangeText={setEmail}
                            onFocus={() => setFocused('email')}
                            onBlur={() => setFocused(null)}
                            placeholder={t('email.emailPlaceholder')}
                            accessibilityLabel={t('authGate.email')}
                            placeholderTextColor="#68686F"
                            autoCapitalize="none"
                            autoComplete="email"
                            keyboardType="email-address"
                            textContentType="emailAddress"
                            returnKeyType="next"
                            blurOnSubmit={false}
                            onSubmitEditing={() => passwordRef.current?.focus()}
                        />
                    </View>

                    <Text style={styles.fieldLabel}>{t('email.passwordTitle')}</Text>
                    <View style={[styles.inputShell, styles.passwordShell, focused === 'password' && styles.passwordShellOn]}>
                        <Text style={styles.inputIcon} accessibilityElementsHidden importantForAccessibility="no">🔐</Text>
                        <TextInput
                            ref={passwordRef}
                            style={styles.input}
                            value={password}
                            onChangeText={setPassword}
                            onFocus={() => setFocused('password')}
                            onBlur={() => setFocused(null)}
                            placeholder={t('email.password')}
                            accessibilityLabel={t('email.passwordLabel')}
                            placeholderTextColor="#68686F"
                            secureTextEntry={!passwordVisible}
                            autoComplete={mode === 'signIn' ? 'current-password' : 'new-password'}
                            textContentType={mode === 'signIn' ? 'password' : 'newPassword'}
                            returnKeyType="done"
                            onSubmitEditing={() => { Keyboard.dismiss(); if (ready) void submit(); }}
                        />
                        <Pressable
                            accessibilityRole="button"
                            accessibilityLabel={t(passwordVisible ? 'email.hidePassword' : 'email.showPassword')}
                            hitSlop={8}
                            style={({ pressed }) => [styles.reveal, pressed && styles.pressed]}
                            onPress={() => { void playSelection(); setPasswordVisible((shown) => !shown); }}
                        >
                            <Text style={styles.revealText}>{t(passwordVisible ? 'email.hide' : 'email.show')}</Text>
                        </Pressable>
                    </View>

                    <View style={[styles.security, captcha ? styles.securityReady : captchaError ? styles.securityError : null]}>
                        <View style={styles.securityCopy}>
                            <Text style={styles.securityIcon} accessibilityElementsHidden importantForAccessibility="no">{captcha ? '✓' : '🛡️'}</Text>
                            <View style={styles.securityText}>
                                <Text style={styles.securityTitle}>{t('email.securityTitle')}</Text>
                                {!captcha && !captchaError ? <Text style={styles.securityDetail}>{t('email.checking')}</Text> : null}
                                {captcha ? <Text style={styles.securityReadyText}>{t('email.securityReady')}</Text> : null}
                                {captchaError ? <Text style={styles.error} accessibilityRole="alert">{t('email.captchaFailed')}</Text> : null}
                            </View>
                        </View>
                        <TurnstileView resetKey={resetKey} onMessage={onCaptcha} />
                        {captchaError ? (
                            <Pressable accessibilityRole="button" style={({ pressed }) => [styles.retry, pressed && styles.pressed]} onPress={retrySecurityCheck}>
                                <Text style={styles.retryText}>{t('email.securityRetry')}</Text>
                            </Pressable>
                        ) : null}
                    </View>

                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={mode === 'signIn' ? t('oauth.signIn') : t('authGate.createAccount')}
                        accessibilityState={{ busy, disabled: !ready }}
                        disabled={!ready}
                        style={({ pressed }) => [styles.submit, !ready && styles.off, pressed && ready && styles.pressed]}
                        onPress={submit}
                    >
                        {busy ? <ActivityIndicator color={colors.accentInk} /> : <Text style={styles.submitText}>{mode === 'signIn' ? t('email.signInCta') : t('email.signUpCta')}</Text>}
                    </Pressable>
                    {message ? (
                        <View style={[styles.messageCard, messageTone === 'success' ? styles.messageSuccess : styles.messageError]}>
                            <Text style={[styles.message, messageTone === 'success' ? styles.messageSuccessText : styles.messageErrorText]} accessibilityRole={messageTone === 'error' ? 'alert' : undefined} accessibilityLiveRegion="polite">
                                {message}
                            </Text>
                        </View>
                    ) : null}
                </View>

                <Pressable accessibilityRole="button" style={({ pressed }) => [touchTarget, styles.switchRow, pressed && styles.pressed]} onPress={() => chooseMode(mode === 'signIn' ? 'signUp' : 'signIn')}>
                    <Text style={styles.switch}>{mode === 'signIn' ? t('email.newHere') : t('authGate.haveAnAccountSignIn')}</Text>
                </Pressable>
            </ScrollView>
        </KeyboardAvoidingView>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background },
    body: { paddingHorizontal: 20, gap: 16 },
    back: { alignSelf: 'flex-start', justifyContent: 'center', paddingHorizontal: 4 },
    backText: { color: colors.accent, fontSize: 17, fontWeight: '700' },
    hero: { gap: 8 },
    kicker: { color: colors.accent, fontSize: 12, fontWeight: '900', letterSpacing: 1.6 },
    heading: { color: colors.text, fontFamily: fonts.displayHeavy, fontSize: 34, lineHeight: 39 },
    lead: { color: colors.body, fontSize: 16, lineHeight: 22 },
    modeRow: { flexDirection: 'row', backgroundColor: colors.surface, borderRadius: 18, padding: 5, borderWidth: 1, borderColor: colors.border, gap: 5 },
    mode: { flex: 1, minHeight: 48, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
    modeSignIn: { backgroundColor: '#BDEFE2', borderWidth: 2, borderColor: '#38B99B' },
    modeSignUp: { backgroundColor: '#FFD1E8', borderWidth: 2, borderColor: '#E45B9C' },
    modeText: { color: colors.muted, fontSize: 15, fontWeight: '700' },
    modeTextOn: { color: '#17171A', fontWeight: '900' },
    providerGroup: { gap: 10 },
    providerButton: { minHeight: 54, borderRadius: 16, borderWidth: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16 },
    providerApple: { backgroundColor: '#17171A', borderColor: '#17171A' },
    providerGoogle: { backgroundColor: '#E2F4FF', borderColor: '#8AD4F5' },
    providerButtonRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 },
    providerAppleText: { color: '#FFFFFF', fontSize: 16, fontWeight: '800' },
    providerGoogleText: { color: '#17171A', fontSize: 16, fontWeight: '800' },
    appleIcon: { color: '#FFFFFF', fontSize: 21 },
    googleMark: { width: 24, height: 24, borderRadius: 12, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' },
    googleIcon: { color: '#2367CF', fontSize: 15, fontWeight: '900' },
    divider: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    dividerLine: { flex: 1, height: 1, backgroundColor: colors.border },
    dividerText: { color: colors.muted, fontSize: 12, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.8 },
    formCard: { backgroundColor: colors.surface, borderRadius: 24, borderWidth: 1, borderColor: colors.border, padding: 14, gap: 10 },
    fieldLabel: { color: colors.text, fontSize: 14, fontWeight: '800', marginTop: 2 },
    inputShell: { minHeight: 58, borderRadius: 16, borderWidth: 2, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 13, gap: 10 },
    emailShell: { backgroundColor: '#E2F4FF', borderColor: '#B6E2F5' },
    emailShellOn: { backgroundColor: '#C5EAFC', borderColor: '#168BC0', transform: [{ scale: 1.01 }] },
    passwordShell: { backgroundColor: '#E9DEFF', borderColor: '#D7C4FF' },
    passwordShellOn: { backgroundColor: '#D8C3FF', borderColor: '#7652BE', transform: [{ scale: 1.01 }] },
    inputIcon: { fontSize: 19 },
    input: { flex: 1, color: '#17171A', paddingVertical: 15, fontSize: 16, fontWeight: '600' },
    reveal: { minHeight: 36, minWidth: 48, alignItems: 'center', justifyContent: 'center' },
    revealText: { color: '#5F3D9E', fontSize: 13, fontWeight: '900' },
    security: { borderRadius: 16, borderWidth: 2, borderColor: '#F0C649', backgroundColor: '#FFF2C7', padding: 12 },
    securityReady: { borderColor: '#38B99B', backgroundColor: '#DDF9F1' },
    securityError: { borderColor: colors.danger, backgroundColor: '#FFF1EF' },
    securityCopy: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    securityIcon: { fontSize: 20, color: '#168E73', fontWeight: '900' },
    securityText: { flex: 1, gap: 2 },
    securityTitle: { color: '#17171A', fontSize: 14, fontWeight: '900' },
    securityDetail: { color: '#5A4A11', fontSize: 13 },
    securityReadyText: { color: '#116C58', fontSize: 13, fontWeight: '700' },
    retry: { alignSelf: 'flex-start', minHeight: 36, justifyContent: 'center', marginTop: 6, paddingHorizontal: 30 },
    retryText: { color: '#9F211A', fontSize: 13, fontWeight: '900', textDecorationLine: 'underline' },
    submit: { minHeight: 56, backgroundColor: colors.accent, borderRadius: 16, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center', marginTop: 2 },
    off: { opacity: 0.4 },
    submitText: { color: colors.accentInk, fontWeight: '900', fontSize: 17 },
    messageCard: { borderRadius: 12, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 10 },
    messageError: { backgroundColor: '#FFF1EF', borderColor: '#F4AAA2' },
    messageSuccess: { backgroundColor: '#DDF9F1', borderColor: '#93DFC9' },
    message: { lineHeight: 20, fontWeight: '700' },
    messageErrorText: { color: '#9F211A' },
    messageSuccessText: { color: '#116C58' },
    error: { color: colors.danger, fontSize: 13, lineHeight: 18 },
    switchRow: { alignItems: 'center', justifyContent: 'center' },
    switch: { color: colors.accent, fontSize: 15, fontWeight: '700' },
    pressed: { opacity: 0.78, transform: [{ scale: 0.985 }] },
});
