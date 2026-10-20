import { useState } from 'react';
import { Alert } from 'react-native';
import { useAuth } from '../../auth/AuthProvider';
import { accountErrorKey } from '../../lib/accountSecurity';
import { revokeSessions, type SessionScope } from '../../lib/auth/accountCalls';
import { t } from '../../lib/i18n';
import { Action, Card, Status } from './shared';

export function DevicesCard() {
    const { getAccessToken, signOut } = useAuth();
    const [busy, setBusy] = useState(false);
    const [note, setNote] = useState<{ text: string; error: boolean } | null>(null);

    async function end(scope: SessionScope) {
        setBusy(true);
        setNote(null);
        try {
            await revokeSessions(getAccessToken, scope);
            // Everywhere includes this phone: leave the same way the Sign out button does.
            if (scope === 'global') return await signOut();
            setNote({ text: t('acct.dev.othersDone'), error: false });
        } catch (err) {
            setNote({ text: t(accountErrorKey(err)), error: true });
        } finally {
            setBusy(false);
        }
    }

    function confirm(scope: SessionScope) {
        const everywhere = scope === 'global';
        Alert.alert(t(everywhere ? 'acct.dev.everywhereTitle' : 'acct.dev.othersTitle'), t(everywhere ? 'acct.dev.everywhereBody' : 'acct.dev.othersBody'), [
            { text: t('acct.cancel'), style: 'cancel' },
            { text: t(everywhere ? 'acct.dev.everywhere' : 'acct.dev.others'), style: 'destructive', onPress: () => void end(scope) },
        ]);
    }

    return (
        <Card title={t('acct.dev.title')} help={t('acct.dev.help')}>
            <Action label={t('acct.dev.others')} disabled={busy} onPress={() => confirm('others')} />
            <Action label={t('acct.dev.everywhere')} disabled={busy} danger onPress={() => confirm('global')} />
            <Status text={note?.text ?? null} error={note?.error} />
        </Card>
    );
}
