import { confirmSignOut } from '../../lib/confirmSignOut';
import { useEffect, useState, type ReactNode } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { useAuth } from '../../auth/AuthProvider';
import { fetchProfile, verifyFactor } from '../../lib/auth/accountCalls';
import { toSession } from '../../lib/auth/supabaseAuth';
import { t } from '../../lib/i18n';
import { isAccountChanged } from '../../auth/sessionTask';
import { aalFromToken, mfaErrorKey, needsChallenge, validCode, verifiedFactors } from '../../lib/mfa';
import { knownMfaEnrolment, markMfaCleared, mfaClearedFor, rememberMfaEnrolment } from '../../lib/mfaCheck';
import { ApiError } from '../../lib/api';
import { consumeRecoveryCode, formatRecoveryInput, recoverErrorKey, validRecoveryCode } from '../../lib/mfaRecovery';
import { CodeField } from './CodeField';
import { Status } from './AccountParts';
import { Button, Text, TextField, themedStyles, useThemedStyles } from '../ui';

// How long a signed-in person waits for the check before the gate decides without it. It fails closed (audit
// 2026-10-27, H2): only an account this phone last saw without two-factor opens; anyone else gets Try again and
// Sign out. A late answer still wins, so a slow check that finishes opens the app or asks for the code.
export const GATE_TIMEOUT_MS = 4000;

type Phase = 'checking' | 'challenge' | 'clear' | 'unavailable';

// Stops sign-in at a six-digit code when the account has a verified authenticator and this session has not
// passed it. Sign out is always on screen: a lost phone must not trap the person on this step.
export function MfaGate({ children }: { children: ReactNode }) {
    const styles = useThemedStyles(sheets);
    const { status, generation, beginSessionTask, adoptSession, signOut, api } = useAuth();
    const [phase, setPhase] = useState<Phase>('checking');
    const [factorId, setFactorId] = useState<string | null>(null);
    const [code, setCode] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [attempt, setAttempt] = useState(0);
    const [recovery, setRecovery] = useState(false);

    useEffect(() => {
        const task = beginSessionTask();
        if (task.gen !== generation || !task.current() || status !== 'signedIn') return;
        let live = true;
        const current = () => live && task.current();
        const userId = task.user;
        // The check did not finish: open only for an account known here to have no authenticator.
        const undecided = async () => {
            const known = await knownMfaEnrolment(userId);
            if (current()) setPhase((p) => (p === 'checking' ? (known === false ? 'clear' : 'unavailable') : p));
        };
        const timer = setTimeout(() => void undecided(), GATE_TIMEOUT_MS);
        (async () => {
            try {
                // Already passed in this launch: a remount of this gate must not ask the server again.
                if (mfaClearedFor(userId)) {
                    if (current()) setPhase('clear');
                    return;
                }
                const profile = await fetchProfile(task.tokens, 'mfa-gate');
                if (!current()) return;
                const aal = aalFromToken(await task.tokens(false, task.gen));
                if (!current()) return;
                void rememberMfaEnrolment(userId, verifiedFactors(profile.factors).length > 0);
                if (needsChallenge(profile, aal)) {
                    setFactorId(verifiedFactors(profile.factors)[0].id);
                    setPhase('challenge');
                } else {
                    markMfaCleared(userId);
                    setPhase('clear');
                }
            } catch (err) {
                if (!current() || isAccountChanged(err)) return;
                clearTimeout(timer);
                await undecided();
            }
        })();
        return () => {
            live = false;
            clearTimeout(timer);
        };
    }, [status, generation, beginSessionTask, attempt]);

    async function submit() {
        const task = beginSessionTask();
        if (!factorId) return;
        setBusy(true);
        setError(null);
        try {
            const session = toSession(await verifyFactor(task.tokens, factorId, code), Date.now());
            if (!task.current()) return;
            await adoptSession(session, task.gen);
            if (!task.current()) return;
            markMfaCleared(task.user);
            setCode('');
            setPhase('clear');
        } catch (err) {
            if (!task.current() || isAccountChanged(err)) return;
            setError(t(mfaErrorKey(err)));
        } finally {
            setBusy(false);
        }
    }

    // A saved recovery code removes the lost authenticator (web ADR-0311). It never gives an aal2 session, so the
    // gate re-reads the account: with no authenticator left the person goes in at aal1 and sets up a new one.
    async function submitRecovery() {
        const task = beginSessionTask();
        setBusy(true);
        setError(null);
        try {
            if ((await consumeRecoveryCode(api, code)) === 'stale') throw new ApiError(409, 'recovery_stale');
            const reread = () => fetchProfile(task.tokens, 'mfa-gate');
            // The code is spent once the server accepts it, so a failed re-read is retried and then taken as done.
            const profile = await reread().catch(() => reread()).catch(() => null);
            if (!task.current()) return;
            const aal = aalFromToken(await task.tokens(false, task.gen));
            if (!task.current()) return;
            if (profile && needsChallenge(profile, aal)) throw new ApiError(502, 'recovery_incomplete');
            void rememberMfaEnrolment(task.user, false);
            markMfaCleared(task.user);
            setCode('');
            setRecovery(false);
            setPhase('clear');
        } catch (err) {
            if (!task.current() || isAccountChanged(err)) return;
            setError(t(recoverErrorKey(err)));
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
            <Text variant="footnote" tone="secondary">{t(recovery ? 'authGate.mfa.recovery.body' : 'acct.mfa.challengeHelp')}</Text>
            {recovery ? (
                <TextField
                    accessibilityLabel={t('authGate.mfa.recovery.codeLabel')}
                    autoCapitalize="characters"
                    autoCorrect={false}
                    maxLength={11}
                    value={code}
                    onChangeText={(v) => setCode(formatRecoveryInput(v))}
                />
            ) : (
                <CodeField value={code} onChange={setCode} />
            )}
            <Button variant="primary" label={t('acct.mfa.verify')} disabled={busy || !(recovery ? validRecoveryCode(code) : validCode(code))} onPress={() => void (recovery ? submitRecovery() : submit())} />
            <Status text={error} error />
            <Button variant="tertiary" tone="secondary" label={t(recovery ? 'authGate.mfa.recovery.useAuthenticator' : 'authGate.mfa.recovery.useCode')} disabled={busy} onPress={() => { setRecovery((r) => !r); setCode(''); setError(null); }} />
            <Button variant="tertiary" tone="secondary" accessibilityRole="button" label={t('public.account.signOut')} onPress={() => confirmSignOut(signOut)} />
        </View>
    );
}

const sheets = themedStyles((p) => ({
    screen: { flex: 1, backgroundColor: p.bg, padding: 24, gap: 16, justifyContent: 'center' },
    accent: { color: p.accent },
}));
