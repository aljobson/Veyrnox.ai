import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Text, View } from 'react-native';
import { useAuth } from '../../auth/AuthProvider';
import { accountErrorKey, normaliseGrants, type Grant } from '../../lib/accountSecurity';
import { fetchGrantsRaw, revokeGrant } from '../../lib/auth/accountCalls';
import { getLocale, t } from '../../lib/i18n';
import { colors } from '../../theme';
import { Action, Card, Status, styles } from './shared';

// The apps and assistants the person has let into their account (the web's Connected assistants).
export function GrantsCard() {
    const { getAccessToken } = useAuth();
    const [grants, setGrants] = useState<Grant[] | null>(null);
    const [busy, setBusy] = useState(false);
    const [note, setNote] = useState<{ text: string; error: boolean } | null>(null);

    const load = useCallback(async () => {
        setNote(null);
        try {
            setGrants(normaliseGrants(await fetchGrantsRaw(getAccessToken)));
        } catch (err) {
            setGrants(null);
            setNote({ text: t(accountErrorKey(err) === 'acct.err.network' ? 'acct.err.network' : 'acct.oauth.loadFailed'), error: true });
        }
    }, [getAccessToken]);

    useEffect(() => {
        void load();
    }, [load]);

    const nameOf = (g: Grant) => g.name ?? t('acct.oauth.assistant');

    async function revoke(g: Grant) {
        setBusy(true);
        setNote(null);
        try {
            await revokeGrant(getAccessToken, g.clientId);
            setGrants((list) => (list ? list.filter((x) => x.clientId !== g.clientId) : list));
            setNote({ text: t('acct.oauth.revoked', { name: nameOf(g) }), error: false });
        } catch (err) {
            setNote({ text: t(accountErrorKey(err)), error: true });
        } finally {
            setBusy(false);
        }
    }

    function confirm(g: Grant) {
        Alert.alert(t('acct.oauth.confirm', { name: nameOf(g) }), t('acct.oauth.body'), [
            { text: t('acct.cancel'), style: 'cancel' },
            { text: t('acct.oauth.revoke'), style: 'destructive', onPress: () => void revoke(g) },
        ]);
    }

    return (
        <Card title={t('acct.oauth.title')} help={t('acct.oauth.help')}>
            {grants === null && !note ? <ActivityIndicator color={colors.accent} accessibilityLabel={t('acct.oauth.loading')} /> : null}
            {grants?.length === 0 ? <Text style={styles.help}>{t('acct.oauth.empty')}</Text> : null}
            {grants?.map((g) => (
                <View key={g.clientId} style={{ gap: 4 }}>
                    <Text style={styles.name}>{nameOf(g)}</Text>
                    <Text style={styles.help}>
                        {g.scopes.length ? t('acct.oauth.access', { scopes: g.scopes.join(', ') }) : t('acct.oauth.defaultAccess')}
                        {g.grantedAt && !Number.isNaN(Date.parse(g.grantedAt)) ? ` ${t('acct.oauth.since', { date: new Date(g.grantedAt).toLocaleDateString(getLocale()) })}` : ''}
                    </Text>
                    <Action label={t('acct.oauth.revokeNamed', { name: nameOf(g) })} disabled={busy} danger onPress={() => confirm(g)} />
                </View>
            ))}
            <Status text={note?.text ?? null} error={note?.error} />
            <Action label={t('acct.oauth.refresh')} disabled={busy} onPress={() => void load()} />
        </Card>
    );
}
