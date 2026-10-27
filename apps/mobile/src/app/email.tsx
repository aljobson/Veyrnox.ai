import { Redirect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useEffect, useRef, useState, type ComponentRef } from 'react';
import { Keyboard, KeyboardAvoidingView, Platform, ScrollView, TextInput, View } from 'react-native';
import { TurnstileView } from '../auth/TurnstileView';
import { useAuth } from '../auth/AuthProvider';
import { AuthError } from '../lib/auth/supabaseAuth';
import { emailAuthMessage, validateEmailForm } from '../lib/auth/emailForm';
import type { TurnstileMessage } from '../lib/auth/turnstile';
import { Button, Text, TextField, AuthProviderButton, SegmentedControl, Icon, themedStyles, useThemedStyles } from '../components/ui';
import { ds } from '../theme';
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
    const running = useRef(false);
    const styles = useThemedStyles(sheets);
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
        if (busy || providerBusy || running.current) return;
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
        running.current = true;
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
            running.current = false;
            setBusy(false);
        }
    }

    async function useProvider(provider: 'apple' | 'google') {
        if (busy || providerBusy || running.current) return;
        running.current = true;
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
            running.current = false;
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
                contentContainerStyle={[styles.body, { paddingTop: insets.top + ds.space.lg, paddingBottom: insets.bottom + ds.space.xxl }]}
                keyboardShouldPersistTaps="handled"
                keyboardDismissMode="interactive"
                showsVerticalScrollIndicator={false}
            >
                <Button variant="tertiary" icon="arrowLeft" label={t('public.vey.back')} onPress={() => router.back()} />
                <Text variant="display">{t(mode === 'signIn' ? 'email.signInTitle' : 'email.signUpTitle')}</Text>
                <Text tone="secondary">{t(mode === 'signIn' ? 'email.signInBody' : 'email.signUpBody')}</Text>
                <SegmentedControl
                    value={mode}
                    onChange={chooseMode}
                    options={[
                        { value: 'signIn', label: t('oauth.signIn') },
                        { value: 'signUp', label: t('authGate.createAccount') },
                    ]}
                />
                <AuthProviderButton provider="apple" consent busy={authBusy} nativeAvailable={appleNativeAvailable} onPress={() => void useProvider('apple')} />
                <AuthProviderButton provider="google" consent busy={authBusy} onPress={() => void useProvider('google')} />
                <View style={styles.divider}>
                    <View style={styles.line} />
                    <Text variant="footnote" tone="tertiary">
                        {t('email.orUseEmail')}
                    </Text>
                    <View style={styles.line} />
                </View>
                <TextField
                    label={t('authGate.email')}
                    value={email}
                    onChangeText={setEmail}
                    placeholder={t('email.emailPlaceholder')}
                    autoCapitalize="none"
                    autoComplete="email"
                    keyboardType="email-address"
                    textContentType="emailAddress"
                    returnKeyType="next"
                    blurOnSubmit={false}
                    onSubmitEditing={() => passwordRef.current?.focus()}
                />
                <TextField
                    ref={passwordRef}
                    label={t('email.passwordTitle')}
                    value={password}
                    onChangeText={setPassword}
                    placeholder={t('email.password')}
                    accessibilityLabel={t('email.passwordLabel')}
                    secureTextEntry={!passwordVisible}
                    autoComplete={mode === 'signIn' ? 'current-password' : 'new-password'}
                    textContentType={mode === 'signIn' ? 'password' : 'newPassword'}
                    returnKeyType="done"
                    onSubmitEditing={() => {
                        Keyboard.dismiss();
                        if (ready) void submit();
                    }}
                    trailing={
                        <Button
                            size="sm"
                            variant="tertiary"
                            icon={passwordVisible ? 'eyeOff' : 'eye'}
                            label={t(passwordVisible ? 'email.hide' : 'email.show')}
                            accessibilityLabel={t(passwordVisible ? 'email.hidePassword' : 'email.showPassword')}
                            onPress={() => {
                                void playSelection();
                                setPasswordVisible((shown) => !shown);
                            }}
                        />
                    }
                />
                <View style={styles.security}>
                    <Icon name="shieldCheck" size={20} />
                    <View style={styles.securityCopy}>
                        <Text variant="footnote" tone="tertiary">
                            {t('email.securityTitle')}
                        </Text>
                        {!captcha && !captchaError ? (
                            <Text variant="footnote" tone="tertiary">
                                {t('email.checking')}
                            </Text>
                        ) : null}
                        {captcha ? (
                            <Text variant="footnote" tone="tertiary">
                                {t('email.securityReady')}
                            </Text>
                        ) : null}
                        {captchaError ? (
                            <Text variant="footnote" tone="danger" accessibilityRole="alert">
                                {t('email.captchaFailed')}
                            </Text>
                        ) : null}
                    </View>
                </View>
                <TurnstileView resetKey={resetKey} onMessage={onCaptcha} />
                {captchaError ? <Button variant="tertiary" label={t('email.securityRetry')} onPress={retrySecurityCheck} /> : null}
                <Button label={t(mode === 'signIn' ? 'email.signInCta' : 'email.signUpCta')} loading={busy} disabled={!ready} onPress={submit} />
                {message ? (
                    <Text
                        tone={messageTone === 'error' ? 'danger' : 'secondary'}
                        accessibilityRole={messageTone === 'error' ? 'alert' : undefined}
                        accessibilityLiveRegion="polite"
                    >
                        {message}
                    </Text>
                ) : null}
                <Button
                    variant="tertiary"
                    label={t(mode === 'signIn' ? 'email.newHere' : 'authGate.haveAnAccountSignIn')}
                    onPress={() => chooseMode(mode === 'signIn' ? 'signUp' : 'signIn')}
                />
            </ScrollView>
        </KeyboardAvoidingView>
    );
}
const sheets = themedStyles((p) => ({
    screen: { flex: 1, backgroundColor: p.bg },
    body: { paddingHorizontal: ds.space.gutter, gap: ds.space.md },
    divider: { flexDirection: 'row', alignItems: 'center', gap: ds.space.md },
    line: { flex: 1, height: 1, backgroundColor: p.borderSubtle },
    security: { flexDirection: 'row', alignItems: 'center', gap: ds.space.sm },
    securityCopy: { flex: 1 },
}));
