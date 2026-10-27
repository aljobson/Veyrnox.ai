import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert } from 'react-native';
import { useAuth } from '../../auth/AuthProvider';
import { accountErrorKey, normaliseGrants, type Grant } from '../../lib/accountSecurity';
import { fetchGrantsRaw, revokeGrant } from '../../lib/auth/accountCalls';
import { getLocale, t } from '../../lib/i18n';
import { Card, Status } from './AccountParts';
import { Button, Text, Card as Surface, themedStyles, useThemedStyles } from '../ui';

// The apps and assistants the person has let into their account (the web's Connected assistants).
export function GrantsCard() {
    const styles = useThemedStyles(sheets);
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
            {grants === null && !note ? <ActivityIndicator color={styles.accent.color} accessibilityLabel={t('acct.oauth.loading')} /> : null}
            {grants?.length === 0 ? <Text variant="footnote" tone="secondary">{t('acct.oauth.empty')}</Text> : null}
            {grants?.map((g) => (
                <Surface key={g.clientId} style={styles.row}>
                    <Text variant="bodyStrong">{nameOf(g)}</Text>
                    <Text variant="footnote" tone="secondary">
                        {g.scopes.length ? t('acct.oauth.access', { scopes: g.scopes.join(', ') }) : t('acct.oauth.defaultAccess')}
                        {g.grantedAt && !Number.isNaN(Date.parse(g.grantedAt)) ? ` ${t('acct.oauth.since', { date: new Date(g.grantedAt).toLocaleDateString(getLocale()) })}` : ''}
                    </Text>
                    <Button variant="tertiary" label={t('acct.oauth.revokeNamed', { name: nameOf(g) })} disabled={busy} tone="danger" onPress={() => confirm(g)} />
                </Surface>
            ))}
            <Status text={note?.text ?? null} error={note?.error} />
            <Button variant="tertiary" label={t('acct.oauth.refresh')} disabled={busy} onPress={() => void load()} />
        </Card>
    );
}

const sheets = themedStyles((p) => ({
    accent: { color: p.accent },
    row: { gap: 4 },
}));
