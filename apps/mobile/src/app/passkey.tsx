import { Redirect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text } from 'react-native';
import { useAuth } from '../auth/AuthProvider';
import { TurnstileView } from '../auth/TurnstileView';
import type { TurnstileMessage } from '../lib/auth/turnstile';
import { passkeyGate, passkeysServerAvailable, passkeySignInErrorKey } from '../lib/passkeys';
import { touchTarget } from '../lib/a11y';
import { t } from '../lib/i18n';
import { colors, fonts } from '../theme';

export default function PasskeyAuth() {
    const { status } = useAuth();
    const router = useRouter();
    const insets = useSafeAreaInsets();
    if (status === 'signedIn') return <Redirect href="/(app)/(tabs)" />;
    return (
        <ScrollView style={styles.screen} contentContainerStyle={[styles.body, { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 16 }]}>
            <Pressable accessibilityRole="button" accessibilityLabel={t('public.vey.back')} style={touchTarget} onPress={() => router.back()}>
                <Text style={styles.back}>{t('public.vey.back')}</Text>
            </Pressable>
            <Text accessibilityRole="header" style={styles.heading}>{t('passkey.title')}</Text>
            {passkeyGate() ? <PasskeyAttempt /> : <Text style={styles.message} accessibilityLiveRegion="polite">{t('passkey.err.off')}</Text>}
        </ScrollView>
    );
}

function PasskeyAttempt() {
    const { signInWithPasskey } = useAuth();
    const [captcha, setCaptcha] = useState<string | null>(null);
    const [captchaError, setCaptchaError] = useState(false);
    const [resetKey, setResetKey] = useState(0);
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState<string | null>(null);
    const inFlight = useRef(false);
    const captchaReady = useRef(false);

    useEffect(() => {
        captchaReady.current = false;
        const timer = setTimeout(() => { if (!captchaReady.current) setCaptchaError(true); }, 15000);
        return () => clearTimeout(timer);
    }, [resetKey]);

    function onCaptcha(m: TurnstileMessage) {
        if (m.type === 'interactive') return;
        if (m.type === 'ready') { captchaReady.current = true; return; }
        if (m.type === 'token') {
            setCaptcha(m.token);
            setCaptchaError(false);
        } else {
            setCaptcha(null);
            setCaptchaError(m.type !== 'expired');
        }
    }

    async function submit() {
        if (!passkeyGate() || !captcha || inFlight.current) return;
        inFlight.current = true;
        setBusy(true);
        setMessage(null);
        const token = captcha;
        try {
            if (!(await passkeysServerAvailable())) {
                setMessage(t('passkey.err.off'));
                return;
            }
            await signInWithPasskey(token);
        } catch (err) {
            const key = passkeySignInErrorKey(err);
            if (key) setMessage(t(key));
        } finally {
            setCaptcha(null);
            setCaptchaError(false);
            setResetKey((k) => k + 1);
            inFlight.current = false;
            setBusy(false);
        }
    }

    const ready = !busy && captcha !== null;
    return <>
        <TurnstileView resetKey={resetKey} onMessage={onCaptcha} />
        {!captcha && !captchaError ? <Text style={styles.message}>{t('email.checking')}</Text> : null}
        {captchaError ? <Text style={styles.error} accessibilityRole="alert">{t('email.captchaFailed')}</Text> : null}
        <Pressable accessibilityRole="button" accessibilityLabel={t('passkey.continue')} accessibilityState={{ busy, disabled: !ready }}
            disabled={!ready} style={[styles.submit, !ready && styles.off]} onPress={() => void submit()}>
            {busy ? <ActivityIndicator color={colors.accentInk} /> : <Text style={styles.submitText}>{t('passkey.continue')}</Text>}
        </Pressable>
        {busy ? <Text style={styles.message} accessibilityLiveRegion="polite">{t('passkey.busy')}</Text> : null}
        {message ? <Text style={styles.message} accessibilityLiveRegion="polite">{message}</Text> : null}
    </>;
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background },
    body: { padding: 24, gap: 12 },
    heading: { color: colors.text, fontFamily: fonts.display, fontSize: 28 },
    back: { color: colors.accent },
    message: { color: colors.muted },
    error: { color: colors.danger },
    submit: { ...touchTarget, backgroundColor: colors.accent, borderRadius: 12, paddingVertical: 16, alignItems: 'center' },
    submitText: { color: colors.accentInk, fontWeight: '600', fontSize: 16 },
    off: { opacity: 0.4 },
});
