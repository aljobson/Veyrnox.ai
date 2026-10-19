import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Text, TextInput } from 'react-native';
import { usePublishApi } from '../../lib/usePublishApi';
import { plural, t } from '../../lib/i18n';
import { EVENTS, LABEL_MAX, createWebhook, devErrorKey, fetchWebhooks, revokeWebhook, webhookProblem, type Delivery, type Webhook } from '../../lib/publishDeveloper';
import { colors } from '../../theme';
import { Action, Card, Status, styles } from '../account/shared';
import { Choice, Row, SecretCard } from './parts';

export function DeveloperWebhooks() {
    const api = usePublishApi();
    const [data, setData] = useState<{ endpoints: Webhook[]; deliveries: Delivery[] } | null>(null);
    const [label, setLabel] = useState('');
    const [url, setUrl] = useState('https://');
    const [events, setEvents] = useState<string[]>(['post.published']);
    const [secret, setSecret] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const [note, setNote] = useState<{ text: string; error: boolean } | null>(null);

    const load = useCallback(async () => {
        try {
            setData(await fetchWebhooks(api));
        } catch (err) {
            setData(null);
            setNote({ text: t(devErrorKey(err)), error: true });
        }
    }, [api]);

    useEffect(() => {
        void load();
    }, [load]);
    useEffect(() => () => setSecret(null), []);

    async function create() {
        const problem = webhookProblem({ label, url, events });
        if (problem) return setNote({ text: t(`dev.problem.${problem}`), error: true });
        setBusy(true);
        setNote(null);
        try {
            setSecret((await createWebhook(api, { label, url, events })).secret);
            setLabel('');
            setUrl('https://');
            await load();
        } catch (err) {
            setNote({ text: t(devErrorKey(err)), error: true });
        } finally {
            setBusy(false);
        }
    }

    function confirmRevoke(w: Webhook) {
        Alert.alert(t('dev.hooks.revokeTitle', { name: w.label }), t('dev.hooks.revokeBody'), [
            { text: t('acct.cancel'), style: 'cancel' },
            {
                text: t('dev.revoke'),
                style: 'destructive',
                onPress: () =>
                    void revokeWebhook(api, w.id).then(
                        () => load(),
                        (err) => setNote({ text: t(devErrorKey(err)), error: true }),
                    ),
            },
        ]);
    }

    return (
        <>
            {secret ? <SecretCard title={t('dev.hooks.newTitle')} secret={secret} onDone={() => setSecret(null)} /> : null}
            <Card title={t('dev.hooks.title')} help={t('dev.hooks.help')}>
                {data === null && !note ? <ActivityIndicator color={colors.accent} accessibilityLabel={t('dev.loading')} /> : null}
                {data?.endpoints.length === 0 ? <Text style={styles.help}>{t('dev.hooks.none')}</Text> : null}
                {data?.endpoints.map((w) => (
                    <Row key={w.id}>
                        <Text style={styles.name}>{w.label}</Text>
                        <Text selectable style={styles.help}>{w.url}</Text>
                        <Text style={styles.help}>{[w.events.join(', '), w.active ? '' : t('dev.revoked')].filter(Boolean).join(' · ')}</Text>
                        {w.active ? <Action label={t('dev.hooks.revokeNamed', { name: w.label })} danger disabled={busy} onPress={() => confirmRevoke(w)} /> : null}
                    </Row>
                ))}
                <Status text={note?.text ?? null} error={note?.error} />
            </Card>
            {data && data.deliveries.length > 0 ? (
                <Card title={t('dev.hooks.deliveries')}>
                    {data.deliveries.map((d) => (
                        <Row key={d.id}>
                            <Text style={styles.name}>{`${d.event}${d.endpoint ? ` → ${d.endpoint}` : ''}`}</Text>
                            <Text style={styles.help}>{[d.outcome ?? '', d.status !== null ? `HTTP ${d.status}` : '', d.attempts !== null ? plural('dev.hooks.attempts', d.attempts) : '', d.error ?? ''].filter(Boolean).join(' · ')}</Text>
                        </Row>
                    ))}
                </Card>
            ) : null}
            <Card title={t('dev.hooks.createTitle')} help={t('dev.hooks.urlHelp')}>
                <Text style={styles.label}>{t('dev.label')}</Text>
                <TextInput accessibilityLabel={t('dev.label')} style={styles.input} maxLength={LABEL_MAX} value={label} onChangeText={setLabel} placeholderTextColor={colors.muted} />
                <Text style={styles.label}>{t('dev.hooks.url')}</Text>
                <TextInput accessibilityLabel={t('dev.hooks.url')} style={styles.input} autoCapitalize="none" autoCorrect={false} keyboardType="url" maxLength={2048} value={url} onChangeText={setUrl} placeholderTextColor={colors.muted} />
                <Text style={styles.label}>{t('dev.hooks.events')}</Text>
                {EVENTS.map((e) => (
                    <Choice key={e} label={e} on={events.includes(e)} onPress={() => setEvents((cur) => (cur.includes(e) ? cur.filter((x) => x !== e) : [...cur, e]))} />
                ))}
                <Action label={t('dev.hooks.create')} disabled={busy} onPress={() => void create()} />
            </Card>
        </>
    );
}
