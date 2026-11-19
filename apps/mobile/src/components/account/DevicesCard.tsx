import { isAccountChanged } from '../../auth/sessionTask';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert } from 'react-native';
import { useAuth } from '../../auth/AuthProvider';
import { accountErrorKey } from '../../lib/accountSecurity';
import { revokeSessions, type SessionScope } from '../../lib/auth/accountCalls';
import { endDevice, listDevices, sessionIdOf, type DeviceRow } from '../../lib/accountDevices';
import { getLocale, t } from '../../lib/i18n';
import { Card, Status } from './AccountParts';
import { Button, Text, Card as Surface, themedStyles, useThemedStyles } from '../ui';

function nameOf(d: DeviceRow): string {
    if (d.kind === 'app_ios') return t('acct.dev.appIos');
    if (d.kind === 'app_android') return t('acct.dev.appAndroid');
    const parts = [d.browser, d.system].filter(Boolean);
    return parts.length ? parts.join(' · ') : t('acct.dev.unknown');
}

export function DevicesCard() {
    const { beginSessionTask, signOut, api, getAccessToken } = useAuth();
    const styles = useThemedStyles(sheets);
    const [rows, setRows] = useState<DeviceRow[] | null>(null);
    const [current, setCurrent] = useState('');
    const [loadFailed, setLoadFailed] = useState(false);
    const [busy, setBusy] = useState(false);
    const [note, setNote] = useState<{ text: string; error: boolean } | null>(null);

    const load = useCallback(async () => {
        setLoadFailed(false);
        try {
            const token = await getAccessToken();
            if (!token) { setRows([]); return; }
            setCurrent(sessionIdOf(token));
            setRows(await listDevices(api));
        } catch {
            setRows([]);
            setLoadFailed(true);
        }
    }, [api, getAccessToken]);
    useEffect(() => { void load(); }, [load]);

    async function endOne(d: DeviceRow) {
        setBusy(true);
        setNote(null);
        const ok = await endDevice(api, d.id);
        if (ok) setRows((r) => (r ?? []).filter((x) => x.id !== d.id));
        setNote({ text: t(ok ? 'acct.dev.ended' : 'acct.dev.endFailed'), error: !ok });
        setBusy(false);
    }

    function confirmOne(d: DeviceRow) {
        Alert.alert(t('acct.dev.confirm', { name: nameOf(d) }), t('acct.dev.confirmBody'), [
            { text: t('acct.cancel'), style: 'cancel' },
            { text: t('acct.dev.signOut'), style: 'destructive', onPress: () => void endOne(d) },
        ]);
    }

    async function end(scope: SessionScope) {
        const task = beginSessionTask();
        setBusy(true);
        setNote(null);
        try {
            await revokeSessions(task.tokens, scope);
            if (!task.current()) return;
            if (scope === 'others') void load();
            // Everywhere includes this phone: leave the same way the Sign out button does.
            if (scope === 'global') return await signOut(task.gen);
            setNote({ text: t('acct.dev.othersDone'), error: false });
        } catch (err) {
            if (!task.current() || isAccountChanged(err)) return;
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
            {rows === null ? <ActivityIndicator color={styles.accent.color} accessibilityLabel={t('acct.dev.loading')} /> : null}
            {loadFailed ? <Status text={t('acct.dev.loadFailed')} error /> : null}
            {rows && !loadFailed && rows.length === 0 ? <Text variant="footnote" tone="secondary">{t('acct.dev.empty')}</Text> : null}
            {rows?.map((d) => {
                const mine = d.id === current;
                const when = d.lastUsed && !Number.isNaN(Date.parse(d.lastUsed)) ? t('acct.dev.lastUsed', { date: new Date(d.lastUsed).toLocaleString(getLocale()) }) : null;
                return (
                    <Surface key={d.id} style={styles.row}>
                        <Text variant="bodyStrong">{nameOf(d)}{mine ? ` · ${t('acct.dev.thisDevice')}` : ''}</Text>
                        {when ? <Text variant="footnote" tone="secondary">{when}</Text> : null}
                        {mine ? null : <Button variant="tertiary" label={`${t('acct.dev.signOut')}: ${nameOf(d)}`} tone="danger" disabled={busy} onPress={() => confirmOne(d)} />}
                    </Surface>
                );
            })}
            {loadFailed ? <Button variant="tertiary" label={t('acct.oauth.refresh')} disabled={busy} onPress={() => void load()} /> : null}
            <Button variant="tertiary" label={t('acct.dev.others')} tone="danger" disabled={busy} onPress={() => confirm('others')} />
            <Button variant="tertiary" label={t('acct.dev.everywhere')} disabled={busy} tone="danger" onPress={() => confirm('global')} />
            <Status text={note?.text ?? null} error={note?.error} />
        </Card>
    );
}

const sheets = themedStyles((p) => ({
    accent: { color: p.accent },
    row: { gap: 4 },
}));
