import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Linking, View } from 'react-native';
import { useAuth } from '../../auth/AuthProvider';
import { accountErrorKey } from '../../lib/accountSecurity';
import { enrollTotp, fetchProfile, unenrollFactor, verifyFactor, type Enrolment, type Profile } from '../../lib/auth/accountCalls';
import { toSession } from '../../lib/auth/supabaseAuth';
import { t } from '../../lib/i18n';
import { aalFromToken, enrolmentName, isTotpUri, mfaErrorKey, mfaState, validCode, verifiedFactors } from '../../lib/mfa';
import { CodeField } from './CodeField';
import { Card, Status } from './AccountParts';
import { Button, Text, themedStyles, useThemedStyles } from '../ui';

// Two-factor sign-in with an authenticator app (the web's MfaPanel). Removing a factor needs this session to have
// passed the code step, so a locked session is asked for a code first; nothing here can remove the only way in
// without that proof.
export function MfaCard() {
    const styles = useThemedStyles(sheets);
    const { getAccessToken, adoptSession } = useAuth();
    const [profile, setProfile] = useState<Profile | null>(null);
    const [aal, setAal] = useState<'aal1' | 'aal2' | null>(null);
    const [failed, setFailed] = useState(false);
    const [pending, setPending] = useState<Enrolment | null>(null);
    const [code, setCode] = useState('');
    const [busy, setBusy] = useState(false);
    const [note, setNote] = useState<{ text: string; error: boolean } | null>(null);

    const load = useCallback(async () => {
        setFailed(false);
        try {
            const p = await fetchProfile(getAccessToken, 'mfa-card');
            setAal(aalFromToken(await getAccessToken()));
            setProfile(p);
        } catch {
            setProfile(null);
            setFailed(true);
        }
    }, [getAccessToken]);

    useEffect(() => {
        void load();
    }, [load]);

    async function run(action: () => Promise<void>, errKey: (e: unknown) => string) {
        setBusy(true);
        setNote(null);
        try {
            await action();
        } catch (err) {
            setNote({ text: t(errKey(err) as Parameters<typeof t>[0]), error: true });
        } finally {
            setBusy(false);
        }
    }

    const factors = profile ? verifiedFactors(profile.factors) : [];
    const state = profile ? mfaState(profile, aal) : null;

    // Verifying returns a new aal2 token pair; adopt it before reading the state again.
    async function verify(factorId: string, done: string) {
        await run(async () => {
            await adoptSession(toSession(await verifyFactor(getAccessToken, factorId, code), Date.now()));
            setPending(null);
            setCode('');
            await load();
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
                    void run(async () => {
                        await unenrollFactor(getAccessToken, factorId);
                        await load();
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
                <Button variant="tertiary"
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
                    <Button variant="tertiary" label={t('acct.mfa.confirm')} disabled={busy || !validCode(code)} onPress={() => void verify(pending.factorId, t('acct.mfa.on'))} />
                    <Button variant="tertiary" label={t('acct.mfa.cancelSetup')} disabled={busy} onPress={() => { setPending(null); setCode(''); setNote(null); }} />
                </View>
            ) : null}

            {state === 'locked' && factors[0] ? (
                <View style={styles.group}>
                    <Text variant="footnote" tone="secondary">{t('acct.mfa.locked')}</Text>
                    <CodeField value={code} onChange={setCode} />
                    <Button variant="tertiary" label={t('acct.mfa.unlock')} disabled={busy || !validCode(code)} onPress={() => void verify(factors[0].id, t('acct.mfa.unlocked'))} />
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
