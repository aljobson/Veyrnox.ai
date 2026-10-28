import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Linking, View } from 'react-native';
import { useAuth } from '../../auth/AuthProvider';
import { accountErrorKey } from '../../lib/accountSecurity';
import { enrollTotp, fetchProfile, unenrollFactor, verifyFactor, type Enrolment, type Profile } from '../../lib/auth/accountCalls';
import { toSession } from '../../lib/auth/supabaseAuth';
import { t } from '../../lib/i18n';
import { aalFromToken, enrolmentName, isTotpUri, mfaErrorKey, mfaState, validCode, verifiedFactors } from '../../lib/mfa';
import { isAccountChanged, type SessionTask } from '../../auth/sessionTask';
import { rememberMfaEnrolment } from '../../lib/mfaCheck';
import { CodeField } from './CodeField';
import { Card, Status } from './AccountParts';
import { Button, Text, themedStyles, useThemedStyles } from '../ui';

// Two-factor sign-in with an authenticator app (the web's MfaPanel). Removing a factor needs this session to have
// passed the code step, so a locked session is asked for a code first; nothing here can remove the only way in
// without that proof.
export function MfaCard() {
    const styles = useThemedStyles(sheets);
    const { getAccessToken, adoptSession, beginSessionTask } = useAuth();
    const [profile, setProfile] = useState<Profile | null>(null);
    const [aal, setAal] = useState<'aal1' | 'aal2' | null>(null);
    const [failed, setFailed] = useState(false);
    const [pending, setPending] = useState<Enrolment | null>(null);
    const [code, setCode] = useState('');
    const [busy, setBusy] = useState(false);
    const [note, setNote] = useState<{ text: string; error: boolean } | null>(null);

    const load = useCallback(async (task: SessionTask = beginSessionTask()) => {
        if (!task.current()) return;
        setFailed(false);
        try {
            const p = await fetchProfile(task.tokens, 'mfa-card');
            if (!task.current()) return;
            const token = await task.tokens(false, task.gen);
            if (!task.current()) return;
            setAal(aalFromToken(token));
            setProfile(p);
            // Keeps the gate's offline fallback current after turning two-factor on or off here.
            void rememberMfaEnrolment(task.user, verifiedFactors(p.factors).length > 0);
        } catch (err) {
            if (!task.current() || isAccountChanged(err)) return;
            setProfile(null);
            setFailed(true);
        }
    }, [beginSessionTask]);

    useEffect(() => {
        void load();
    }, [load]);

    async function run(action: (task: SessionTask) => Promise<void>, errKey: (e: unknown) => string) {
        const task = beginSessionTask();
        setBusy(true);
        setNote(null);
        try {
            await action(task);
        } catch (err) {
            if (!task.current() || isAccountChanged(err)) return;
            setNote({ text: t(errKey(err) as Parameters<typeof t>[0]), error: true });
        } finally {
            setBusy(false);
        }
    }

    const factors = profile ? verifiedFactors(profile.factors) : [];
    const state = profile ? mfaState(profile, aal) : null;

    // Verifying returns a new aal2 token pair; adopt it before reading the state again.
    async function verify(factorId: string, done: string) {
        await run(async task => {
            const session = toSession(await verifyFactor(task.tokens, factorId, code), Date.now());
            if (!task.current()) return;
            await adoptSession(session, task.gen);
            if (!task.current()) return;
            setPending(null);
            setCode('');
            await load(task);
            if (!task.current()) return;
            setNote({ text: done, error: false });
        }, mfaErrorKey);
    }

    function confirmRemove(factorId: string) {
        Alert.alert(t('acct.mfa.removeTitle'), t('acct.mfa.removeBody'), [
            { text: t('acct.cancel'), style: 'cancel' },
            {
                text: t('acct.mfa.remove'),
                style: 'destructive',
                onPress: () =>
                    void run(async task => {
                        await unenrollFactor(task.tokens, factorId);
                        if (!task.current()) return;
                        await load(task);
                        if (!task.current()) return;
                        setNote({ text: t('acct.mfa.removed'), error: false });
                    }, accountErrorKey),
            },
        ]);
    }

    const intro = failed ? t('acct.mfa.unavailable') : !profile ? t('acct.mfa.loading') : state === 'none' ? t('acct.mfa.intro') : t('acct.mfa.enabled');

    return (
        <Card title={t('acct.mfa.title')} help={intro}>
            {!profile && !failed ? <ActivityIndicator color={styles.accent.color} accessibilityLabel={t('acct.mfa.loading')} /> : null}
            {failed ? <Button variant="tertiary" label={t('acct.mfa.retry')} onPress={() => void load()} /> : null}

            {state === 'none' && !pending ? (
                <Button variant="secondary"
                    label={t('acct.mfa.setup')}
                    disabled={busy}
                    onPress={() => void run(async () => setPending(await enrollTotp(getAccessToken, enrolmentName(Math.random().toString(36).slice(2, 10)))), mfaErrorKey)}
                />
            ) : null}

            {pending ? (
                <View style={styles.group}>
                    <Text variant="footnote" tone="secondary">{t('acct.mfa.setupHelp')}</Text>
                    {isTotpUri(pending.uri) ? <Button variant="tertiary" label={t('acct.mfa.openApp')} onPress={() => void Linking.openURL(pending.uri).catch(() => setNote({ text: t('acct.mfa.noApp'), error: true }))} /> : null}
                    <Text variant="footnote" tone="secondary">{t('acct.mfa.secret')}</Text>
                    <Text selectable variant="bodyStrong" accessibilityLabel={t('acct.mfa.secretSpoken', { secret: pending.secret.split('').join(' ') })}>{pending.secret}</Text>
                    <CodeField value={code} onChange={setCode} />
                    <Button variant="secondary" label={t('acct.mfa.confirm')} disabled={busy || !validCode(code)} onPress={() => void verify(pending.factorId, t('acct.mfa.on'))} />
                    <Button variant="tertiary" label={t('acct.mfa.cancelSetup')} disabled={busy} onPress={() => { setPending(null); setCode(''); setNote(null); }} />
                </View>
            ) : null}

            {state === 'locked' && factors[0] ? (
                <View style={styles.group}>
                    <Text variant="footnote" tone="secondary">{t('acct.mfa.locked')}</Text>
                    <CodeField value={code} onChange={setCode} />
                    <Button variant="secondary" label={t('acct.mfa.unlock')} disabled={busy || !validCode(code)} onPress={() => void verify(factors[0].id, t('acct.mfa.unlocked'))} />
                </View>
            ) : null}

            {state === 'unlocked' && factors[0] ? <Button variant="tertiary" label={t('acct.mfa.remove')} tone="danger" disabled={busy} onPress={() => confirmRemove(factors[0].id)} /> : null}
            <Status text={note?.text ?? null} error={note?.error} />
        </Card>
    );
}

const sheets = themedStyles((p) => ({
    accent: { color: p.accent },
    group: { gap: 12 },
}));
