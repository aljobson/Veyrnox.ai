import { useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { TurnstileView } from '../auth/TurnstileView';
import { useAuth } from '../auth/AuthProvider';
import { SignedInRedirect } from '../components/SignedInRedirect';
import { Button, Icon, Text, TextField, themedStyles, useThemedStyles } from '../components/ui';
import { AuthError } from '../lib/auth/supabaseAuth';
import type { TurnstileMessage } from '../lib/auth/turnstile';
import { emailAuthMessage } from '../lib/auth/emailForm';
import { ds } from '../theme';
import { t } from '../lib/i18n';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function EmailCodeSignIn() {
    const { status, requestEmailSignInCode, verifyEmailSignInCode } = useAuth();
    const router = useRouter(), insets = useSafeAreaInsets(), styles = useThemedStyles(sheets);
    const [email, setEmail] = useState(''), [code, setCode] = useState('');
    const [sentTo, setSentTo] = useState<string | null>(null), [captcha, setCaptcha] = useState<string | null>(null);
    const [captchaError, setCaptchaError] = useState(false), [resetKey, setResetKey] = useState(0);
    const [busy, setBusy] = useState(false), [message, setMessage] = useState<string | null>(null);
    const [deadline, setDeadline] = useState(0), [seconds, setSeconds] = useState(0);
    const running = useRef(false);
    useEffect(() => {
        if (!deadline) return;
        const timer = setInterval(() => setSeconds(Math.max(0, Math.ceil((deadline - Date.now()) / 1000))), 1_000);
        return () => clearInterval(timer);
    }, [deadline]);
    if (status === 'signedIn') return <SignedInRedirect />;

    function onCaptcha(event: TurnstileMessage) {
        if (event.type === 'token') { setCaptcha(event.token); setCaptchaError(false); setMessage(null); }
        else if (event.type === 'expired') setCaptcha(null);
        else if (event.type !== 'ready' && event.type !== 'interactive') { setCaptcha(null); setCaptchaError(true); }
    }
    async function send() {
        const address = email.trim().toLowerCase();
        if (running.current || !EMAIL.test(address)) { setMessage(t('email.err.invalid')); return; }
        if (!captcha) { setMessage(captchaError ? t('email.securityFirst') : t('email.checking')); return; }
        running.current = true; setBusy(true); setMessage(null);
        try {
            await requestEmailSignInCode(address, captcha);
            setSentTo(address); setCode(''); setDeadline(Date.now() + 60_000); setSeconds(60);
        } catch (error) { setMessage(emailAuthMessage(error instanceof AuthError ? error.code : 'unknown')); }
        finally { running.current = false; setBusy(false); setCaptcha(null); setResetKey(value => value + 1); }
    }
    async function verify() {
        if (running.current || !sentTo || !/^\d{6}$/.test(code)) { setMessage(t('acct.pw.badCode')); return; }
        running.current = true; setBusy(true); setMessage(null);
        try { await verifyEmailSignInCode(sentTo, code); }
        catch (error) { setMessage(emailAuthMessage(error instanceof AuthError ? error.code : 'unknown')); }
        finally { running.current = false; setBusy(false); }
    }
    function changeAddress() { setSentTo(null); setCode(''); setMessage(null); setDeadline(0); setSeconds(0); }

    return <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={[styles.body, { paddingTop: insets.top + ds.space.lg, paddingRight: insets.right + ds.space.gutter,
            paddingBottom: insets.bottom + ds.space.xxl, paddingLeft: insets.left + ds.space.gutter }]} keyboardShouldPersistTaps="handled">
            <Button variant="tertiary" icon="arrowLeft" label={t('public.vey.back')} onPress={() => router.canGoBack() ? router.back() : router.replace('/email')} />
            <Text variant="display">{t('email.signInTitle')}</Text>
            <Text tone="secondary">{t('email.signInBody')}</Text>
            <TextField label={t('authGate.email')} value={sentTo || email} editable={!sentTo && !busy} onChangeText={setEmail}
                autoCapitalize="none" autoComplete="email" keyboardType="email-address" textContentType="emailAddress" />
            {sentTo ? <>
                <TextField label={t('acct.pw.code')} value={code} editable={!busy} onChangeText={value => setCode(value.replace(/\D/g, '').slice(0, 6))}
                    keyboardType="number-pad" textContentType="oneTimeCode" autoComplete="one-time-code" returnKeyType="done" onSubmitEditing={() => void verify()} />
                <Button label={t('acct.mfa.verify')} loading={busy} disabled={busy || code.length !== 6} onPress={() => void verify()} />
                <Button variant="secondary" label={seconds > 0 ? t('email.resendIn', { seconds }) : t('email.resendEmail')} disabled={busy || seconds > 0 || !captcha}
                    onPress={() => void send()} />
                <Button variant="tertiary" label={t('email.changeAddress')} disabled={busy} onPress={changeAddress} />
            </> : <Button label={t('acct.pw.send')} loading={busy} disabled={busy || !EMAIL.test(email.trim())} onPress={() => void send()} />}
            <View style={styles.security}><Icon name="shieldCheck" size={20} /><Text variant="footnote" tone="tertiary">{captcha ? t('email.securityReady') : t('email.securityTitle')}</Text></View>
            <TurnstileView resetKey={resetKey} onMessage={onCaptcha} />
            {captchaError ? <Button variant="tertiary" label={t('email.securityRetry')} onPress={() => { setCaptchaError(false); setResetKey(value => value + 1); }} /> : null}
            {message ? <Text tone="danger" accessibilityRole="alert" accessibilityLiveRegion="polite">{message}</Text> : null}
        </ScrollView>
    </KeyboardAvoidingView>;
}

const sheets = themedStyles(p => ({
    screen: { flex: 1, backgroundColor: p.bg }, body: { gap: ds.space.md }, security: { flexDirection: 'row', alignItems: 'center', gap: ds.space.sm },
}));
