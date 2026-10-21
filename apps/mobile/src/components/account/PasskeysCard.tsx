import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Text, TextInput, View } from 'react-native';
import { useAuth } from '../../auth/AuthProvider';
import { getLocale, t } from '../../lib/i18n';
import { addPasskey, passkeyGate, passkeyAddErrorKey, fetchPasskeys, passkeyErrorKey, removePasskey, type Passkey } from '../../lib/passkeys';
import { colors } from '../../theme';
import { Action, Card, Status, styles } from './shared';

const when = (iso: string | null) => (iso && !Number.isNaN(Date.parse(iso)) ? new Date(iso).toLocaleDateString(getLocale()) : '');

export function PasskeysCard() {
    const { getAccessToken } = useAuth();
    const [list, setList] = useState<Passkey[] | null>(null);
    const [name, setName] = useState('');
    const adding = useRef(false);
    const available = passkeyGate();
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

    async function add() {
        if (!passkeyGate() || busy || adding.current) return;
        adding.current = true;
        setBusy(true);
        setNote(null);
        try {
            const result = await addPasskey(getAccessToken, name);
            if (result === null) return;
            setName('');
            setNote({ text: t('passkey.added'), error: false });
            try {
                setList(await fetchPasskeys(getAccessToken));
            } catch {
                // The passkey was added; a failed list reload must not report a failure.
            }
        } catch (err) {
            const key = passkeyAddErrorKey(err);
            if (key) setNote({ text: t(key), error: true });
        } finally {
            adding.current = false;
            setBusy(false);
        }
    }

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
            {available ? (
                <View style={{ gap: 12 }} accessibilityState={{ busy }}>
                    <Text style={styles.label}>{t('passkey.nameLabel')}</Text>
                    <TextInput style={styles.input} value={name} onChangeText={setName} editable={!busy}
                        accessibilityLabel={t('passkey.nameLabel')} placeholder={t('passkey.namePlaceholder')}
                        placeholderTextColor={colors.muted} maxLength={64} />
                    <Action label={t('passkey.add')} disabled={busy} onPress={() => void add()} />
                    {busy ? <Text style={styles.help} accessibilityLiveRegion="polite">{t('passkey.busy')}</Text> : null}
                </View>
            ) : <Text style={styles.help}>{t('pk.addLater')}</Text>}
            <Status text={note?.text ?? null} error={note?.error} />
        </Card>
    );
}
