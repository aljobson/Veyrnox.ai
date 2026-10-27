import { confirmSignOut } from '../../lib/confirmSignOut';
import { useEffect, useState, type ReactNode } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { useAuth } from '../../auth/AuthProvider';
import { fetchProfile, verifyFactor } from '../../lib/auth/accountCalls';
import { toSession } from '../../lib/auth/supabaseAuth';
import { t } from '../../lib/i18n';
import { userIdFromToken } from '../../lib/appCache';
import { aalFromToken, mfaErrorKey, needsChallenge, validCode, verifiedFactors } from '../../lib/mfa';
import { knownMfaEnrolment, markMfaCleared, mfaClearedFor, rememberMfaEnrolment } from '../../lib/mfaCheck';
import { CodeField } from './CodeField';
import { Status } from './AccountParts';
import { Button, Text, themedStyles, useThemedStyles } from '../ui';

// How long a signed-in person waits for the check before the gate decides without it. It fails closed (audit
// 2026-10-27, H2): only an account this phone last saw without two-factor opens; anyone else gets Try again and
// Sign out. A late answer still wins, so a slow check that finishes opens the app or asks for the code.
export const GATE_TIMEOUT_MS = 4000;

type Phase = 'checking' | 'challenge' | 'clear' | 'unavailable';

// Stops sign-in at a six-digit code when the account has a verified authenticator and this session has not
// passed it. Sign out is always on screen: a lost phone must not trap the person on this step.
export function MfaGate({ children }: { children: ReactNode }) {
    const styles = useThemedStyles(sheets);
    const { status, getAccessToken, adoptSession, signOut } = useAuth();
    const [phase, setPhase] = useState<Phase>('checking');
    const [factorId, setFactorId] = useState<string | null>(null);
    const [code, setCode] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [attempt, setAttempt] = useState(0);

    useEffect(() => {
        if (status !== 'signedIn') return;
        let live = true;
        const userIdOf = getAccessToken().then((token) => (token ? userIdFromToken(token) : null)).catch(() => null);
        // The check did not finish: open only for an account known here to have no authenticator.
        const undecided = async () => {
            const known = await knownMfaEnrolment(await userIdOf);
            if (live) setPhase((p) => (p === 'checking' ? (known === false ? 'clear' : 'unavailable') : p));
        };
        const timer = setTimeout(() => void undecided(), GATE_TIMEOUT_MS);
        (async () => {
            try {
                const userId = await userIdOf;
                // Already passed in this launch: a remount of this gate must not ask the server again.
                if (mfaClearedFor(userId)) {
                    if (live) setPhase('clear');
                    return;
                }
                const profile = await fetchProfile(getAccessToken, 'mfa-gate');
                const aal = aalFromToken(await getAccessToken());
                if (!live) return;
                void rememberMfaEnrolment(userId, verifiedFactors(profile.factors).length > 0);
                if (needsChallenge(profile, aal)) {
                    setFactorId(verifiedFactors(profile.factors)[0].id);
                    setPhase('challenge');
                } else {
                    markMfaCleared(userId);
                    setPhase('clear');
                }
            } catch {
                clearTimeout(timer);
                await undecided();
            }
        })();
        return () => {
            live = false;
            clearTimeout(timer);
        };
    }, [status, getAccessToken, attempt]);

    async function submit() {
        if (!factorId) return;
        setBusy(true);
        setError(null);
        try {
            const session = toSession(await verifyFactor(getAccessToken, factorId, code), Date.now());
            await adoptSession(session);
            markMfaCleared(userIdFromToken(session.accessToken));
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
                <ActivityIndicator color={styles.accent.color} accessibilityLabel={t('acct.mfa.checking')} />
            </View>
        );
    }
    if (phase === 'unavailable') {
        return (
            <View style={styles.screen}>
                <Text variant="body" accessibilityRole="alert">{t('acct.mfa.unavailable')}</Text>
                <Button variant="primary" label={t('acct.mfa.retry')} onPress={() => { setPhase('checking'); setAttempt((n) => n + 1); }} />
                <Button variant="tertiary" tone="secondary" accessibilityRole="button" label={t('public.account.signOut')} onPress={() => confirmSignOut(signOut)} />
            </View>
        );
    }
    return (
        <View style={styles.screen}>
            <Text variant="title2" accessibilityRole="header">{t('acct.mfa.challengeTitle')}</Text>
            <Text variant="footnote" tone="secondary">{t('acct.mfa.challengeHelp')}</Text>
            <CodeField value={code} onChange={setCode} />
            <Button variant="primary" label={t('acct.mfa.verify')} disabled={busy || !validCode(code)} onPress={() => void submit()} />
            <Status text={error} error />
            <Button variant="tertiary" tone="secondary" accessibilityRole="button" label={t('public.account.signOut')} onPress={() => confirmSignOut(signOut)} />
        </View>
    );
}

const sheets = themedStyles((p) => ({
    screen: { flex: 1, backgroundColor: p.bg, padding: 24, gap: 16, justifyContent: 'center' },
    accent: { color: p.accent },
}));
