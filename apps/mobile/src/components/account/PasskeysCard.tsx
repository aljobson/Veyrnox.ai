import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Text, View } from 'react-native';
import { useAuth } from '../../auth/AuthProvider';
import { getLocale, t } from '../../lib/i18n';
import { fetchPasskeys, passkeyErrorKey, removePasskey, type Passkey } from '../../lib/passkeys';
import { colors } from '../../theme';
import { Action, Card, Status, styles } from './shared';

const when = (iso: string | null) => (iso && !Number.isNaN(Date.parse(iso)) ? new Date(iso).toLocaleDateString(getLocale()) : '');

// Passkeys on the account: see them and remove one (a passkey on a lost device is only removable from a signed-in
// session). Adding one needs the native module from spike S2, so this says so rather than offering a dead button.
export function PasskeysCard() {
    const { getAccessToken } = useAuth();
    const [list, setList] = useState<Passkey[] | null>(null);
    const [busy, setBusy] = useState(false);
    const [note, setNote] = useState<{ text: string; error: boolean } | null>(null);

    const load = useCallback(async () => {
        try {
            setList(await fetchPasskeys(getAccessToken));
        } catch (err) {
            setList(null);
            setNote({ text: t(passkeyErrorKey(err)), error: true });
        }
    }, [getAccessToken]);

    useEffect(() => {
        void load();
    }, [load]);

    function confirm(p: Passkey) {
        const name = p.name ?? t('pk.unnamed');
        Alert.alert(t('pk.removeTitle', { name }), t('pk.removeBody'), [
            { text: t('acct.cancel'), style: 'cancel' },
            {
                text: t('pk.remove'),
                style: 'destructive',
                onPress: () => {
                    setBusy(true);
                    setNote(null);
                    removePasskey(getAccessToken, p.id)
                        .then(() => {
                            setList((cur) => (cur ? cur.filter((x) => x.id !== p.id) : cur));
                            setNote({ text: t('pk.removed', { name }), error: false });
                        })
                        .catch((err) => setNote({ text: t(passkeyErrorKey(err)), error: true }))
                        .finally(() => setBusy(false));
                },
            },
        ]);
    }

    return (
        <Card title={t('pk.title')} help={t('pk.help')}>
            {list === null && !note ? <ActivityIndicator color={colors.accent} accessibilityLabel={t('pk.loading')} /> : null}
            {list?.length === 0 ? <Text style={styles.help}>{t('pk.none')}</Text> : null}
            {list?.map((p) => (
                <View key={p.id} style={{ gap: 4 }}>
                    <Text style={styles.name}>{p.name ?? t('pk.unnamed')}</Text>
                    <Text style={styles.help}>
                        {[p.createdAt ? t('pk.added', { date: when(p.createdAt) }) : '', p.lastUsedAt ? t('pk.used', { date: when(p.lastUsedAt) }) : ''].filter(Boolean).join(' · ')}
                    </Text>
                    <Action label={t('pk.removeNamed', { name: p.name ?? t('pk.unnamed') })} danger disabled={busy} onPress={() => confirm(p)} />
                </View>
            ))}
            <Text style={styles.help}>{t('pk.addLater')}</Text>
            <Status text={note?.text ?? null} error={note?.error} />
        </Card>
    );
}
