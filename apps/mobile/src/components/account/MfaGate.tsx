import { useEffect, useState, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useAuth } from '../../auth/AuthProvider';
import { touchTarget } from '../../lib/a11y';
import { fetchProfile, verifyFactor } from '../../lib/auth/accountCalls';
import { toSession } from '../../lib/auth/supabaseAuth';
import { t } from '../../lib/i18n';
import { aalFromToken, mfaErrorKey, needsChallenge, validCode, verifiedFactors } from '../../lib/mfa';
import { colors } from '../../theme';
import { CodeField } from './CodeField';
import { Action, Status } from './shared';

// How long a signed-in person waits for the check before the app opens anyway. The gate is a prompt, not the
// security boundary: the server still requires aal2 where it matters (admin), so a slow or failed check lets the
// app open rather than locking someone out on a bad connection.
export const GATE_TIMEOUT_MS = 4000;

type Phase = 'checking' | 'challenge' | 'clear';

// Stops sign-in at a six-digit code when the account has a verified authenticator and this session has not
// passed it. Sign out is always on screen: a lost phone must not trap the person on this step.
export function MfaGate({ children }: { children: ReactNode }) {
    const { status, getAccessToken, adoptSession, signOut } = useAuth();
    const [phase, setPhase] = useState<Phase>('checking');
    const [factorId, setFactorId] = useState<string | null>(null);
    const [code, setCode] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (status !== 'signedIn') return;
        let live = true;
        const timer = setTimeout(() => live && setPhase((p) => (p === 'checking' ? 'clear' : p)), GATE_TIMEOUT_MS);
        (async () => {
            try {
                const profile = await fetchProfile(getAccessToken);
                const aal = aalFromToken(await getAccessToken());
                if (!live) return;
                if (needsChallenge(profile, aal)) {
                    setFactorId(verifiedFactors(profile.factors)[0].id);
                    setPhase('challenge');
                } else setPhase('clear');
            } catch {
                if (live) setPhase('clear');
            }
        })();
        return () => {
            live = false;
            clearTimeout(timer);
        };
    }, [status, getAccessToken]);

    async function submit() {
        if (!factorId) return;
        setBusy(true);
        setError(null);
        try {
            await adoptSession(toSession(await verifyFactor(getAccessToken, factorId, code), Date.now()));
            setCode('');
            setPhase('clear');
        } catch (err) {
            setError(t(mfaErrorKey(err)));
        } finally {
            setBusy(false);
        }
    }

    if (phase === 'clear') return <>{children}</>;
    if (phase === 'checking') {
        return (
            <View style={styles.screen}>
                <ActivityIndicator color={colors.accent} accessibilityLabel={t('acct.mfa.checking')} />
            </View>
        );
    }
    return (
        <View style={styles.screen}>
            <Text style={styles.title} accessibilityRole="header">{t('acct.mfa.challengeTitle')}</Text>
            <Text style={styles.help}>{t('acct.mfa.challengeHelp')}</Text>
            <CodeField value={code} onChange={setCode} />
            <Action label={t('acct.mfa.verify')} disabled={busy || !validCode(code)} onPress={() => void submit()} />
            <Status text={error} error />
            <Pressable accessibilityRole="button" style={styles.out} onPress={() => void signOut()}>
                <Text style={styles.outText}>{t('public.account.signOut')}</Text>
            </Pressable>
        </View>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background, padding: 24, gap: 16, justifyContent: 'center' },
    title: { color: colors.text, fontSize: 22, fontWeight: '700' },
    help: { color: colors.muted, fontSize: 15 },
    out: { ...touchTarget, alignItems: 'center' },
    outText: { color: colors.muted },
});
