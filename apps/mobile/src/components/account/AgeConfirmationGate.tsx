import { usePathname, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Modal, ScrollView, View } from 'react-native';
import { useAuth } from '../../auth/AuthProvider';
import { PRIVACY_EMAIL } from '../../lib/account';
import { AGE_READ_RETRY_MS, confirmAge, isAccountNotReady, MIN_AGE, readAgeCheck } from '../../lib/ageConfirmation';
import { confirmSignOut } from '../../lib/confirmSignOut';
import { t } from '../../lib/i18n';
import { Status } from './AccountParts';
import { Button, Checkbox, Text, themedStyles, useThemedStyles } from '../ui';

type Phase = 'unknown' | 'ask' | 'declined' | 'confirmed';

// Asks signed-in people to confirm they are old enough, once, when the server says the question is on. The app
// stays mounted underneath (nothing unsent is lost); the question covers it. A decline is kept in memory only.
export function AgeConfirmationGate({ children }: { children: ReactNode }) {
    const styles = useThemedStyles(sheets);
    const { api, signOut } = useAuth();
    const router = useRouter();
    const pathname = usePathname();
    const [phase, setPhase] = useState<Phase>('unknown');
    const [checked, setChecked] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const live = useRef(true);
    const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const tries = useRef(0);

    const check = useCallback(async function run() {
        const result = await readAgeCheck(api);
        if (!live.current) return;
        if (result === 'ask' || result === 'confirmed') {
            setPhase(result);
            return;
        }
        const wait = AGE_READ_RETRY_MS[tries.current++];
        if (wait !== undefined) timer.current = setTimeout(() => void run(), wait);
    }, [api]);

    useEffect(() => {
        live.current = true;
        void check();
        return () => {
            live.current = false;
            if (timer.current) clearTimeout(timer.current);
        };
    }, [check]);

    async function confirm() {
        if (!checked || busy) return;
        setBusy(true);
        setError(null);
        try {
            await confirmAge(api);
            if (live.current) setPhase('confirmed');
        } catch (err) {
            if (!live.current) return;
            if (isAccountNotReady(err)) {
                setChecked(false);
                setPhase('unknown');
                tries.current = 0;
                void check();
            } else {
                setError(t('app.age.failed'));
            }
        } finally {
            if (live.current) setBusy(false);
        }
    }

    // Deleting the account is the one way out besides signing out, so the question steps aside for that screen only.
    const onDeletion = phase === 'declined' && pathname.endsWith('/delete-account');
    const blocked = (phase === 'ask' || phase === 'declined') && !onDeletion;
    return (
        <>
            {children}
            <Modal visible={blocked} animationType="none" onRequestClose={() => {}} presentationStyle="fullScreen">
                <ScrollView contentContainerStyle={styles.screen} keyboardShouldPersistTaps="handled">
                    <Text variant="title2" accessibilityRole="header">{t('app.age.title')}</Text>
                    {phase === 'ask' ? (
                        <>
                            <Checkbox checked={checked} onChange={setChecked} disabled={busy}>
                                <Text>{t('app.age.confirm', { age: MIN_AGE })}</Text>
                            </Checkbox>
                            <Button variant="primary" label={t('app.age.continue')} disabled={!checked || busy} onPress={() => void confirm()} />
                            <Button variant="tertiary" tone="secondary" label={t('app.age.decline', { age: MIN_AGE })} disabled={busy} onPress={() => { setError(null); setPhase('declined'); }} />
                        </>
                    ) : (
                        <View style={styles.group}>
                            <Text>{t('app.age.declined')}</Text>
                            <Button variant="secondary" label={t('app.age.delete')} onPress={() => router.push('/delete-account')} />
                            <Text variant="footnote" tone="secondary">{t('app.age.contact')}</Text>
                            <Text selectable variant="bodyStrong">{PRIVACY_EMAIL}</Text>
                            <Button variant="tertiary" tone="secondary" accessibilityRole="button" label={t('app.age.signOut')} onPress={() => confirmSignOut(signOut)} />
                        </View>
                    )}
                    {busy ? <Text accessibilityLiveRegion="polite" variant="footnote" tone="secondary">{t('app.age.saving')}</Text> : null}
                    <Status text={error} error />
                </ScrollView>
            </Modal>
        </>
    );
}

const sheets = themedStyles((p) => ({
    screen: { flexGrow: 1, backgroundColor: p.bg, padding: 24, gap: 16, justifyContent: 'center' },
    group: { gap: 12 },
}));
