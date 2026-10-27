import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, View } from 'react-native';
import { useAuth } from '../../auth/AuthProvider';
import { getLocale, t } from '../../lib/i18n';
import { addPasskey, passkeyGate, passkeyAddErrorKey, fetchPasskeys, passkeyErrorKey, removePasskey, type Passkey } from '../../lib/passkeys';
import { Card, Status } from './AccountParts';
import { Button, Text, TextField, Card as Surface, themedStyles, useThemedStyles } from '../ui';

const when = (iso: string | null) => (iso && !Number.isNaN(Date.parse(iso)) ? new Date(iso).toLocaleDateString(getLocale()) : '');

export function PasskeysCard() {
    const styles = useThemedStyles(sheets);
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
            {list === null && !note ? <ActivityIndicator color={styles.accent.color} accessibilityLabel={t('pk.loading')} /> : null}
            {list?.length === 0 ? <Text variant="footnote" tone="secondary">{t('pk.none')}</Text> : null}
            {list?.map((p) => (
                <Surface key={p.id} style={styles.row}>
                    <Text variant="bodyStrong">{p.name ?? t('pk.unnamed')}</Text>
                    <Text variant="footnote" tone="secondary">
                        {[p.createdAt ? t('pk.added', { date: when(p.createdAt) }) : '', p.lastUsedAt ? t('pk.used', { date: when(p.lastUsedAt) }) : ''].filter(Boolean).join(' · ')}
                    </Text>
                    <Button variant="tertiary" label={t('pk.removeNamed', { name: p.name ?? t('pk.unnamed') })} tone="danger" disabled={busy} onPress={() => confirm(p)} />
                </Surface>
            ))}
            {available ? (
                <View style={styles.group} accessibilityState={{ busy }}>
                    <Text variant="footnote" tone="secondary">{t('passkey.nameLabel')}</Text>
                    <TextField  value={name} onChangeText={setName} editable={!busy}
                        accessibilityLabel={t('passkey.nameLabel')} placeholder={t('passkey.namePlaceholder')}
                         maxLength={64} />
                    <Button variant="tertiary" label={t('passkey.add')} disabled={busy} onPress={() => void add()} />
                    {busy ? <Text variant="footnote" tone="secondary" accessibilityLiveRegion="polite">{t('passkey.busy')}</Text> : null}
                </View>
            ) : <Text variant="footnote" tone="secondary">{t('pk.addLater')}</Text>}
            <Status text={note?.text ?? null} error={note?.error} />
        </Card>
    );
}

const sheets = themedStyles((p) => ({
    accent: { color: p.accent },
    group: { gap: 12 },
    row: { gap: 4 },
}));
