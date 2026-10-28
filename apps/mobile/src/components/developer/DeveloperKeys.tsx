import { usePublishScope } from '../../lib/usePublishScope';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Text, TextInput } from 'react-native';
import { usePublishApi } from '../../lib/usePublishApi';
import { t } from '../../lib/i18n';
import { EXPIRY_DAYS, LABEL_MAX, SCOPES, createKey, devErrorKey, fetchKeys, keyLive, keyProblem, revokeKey, type ApiKey } from '../../lib/publishDeveloper';
import { colors } from '../../theme';
import { Action, Card, Status, styles } from '../account/shared';
import { Choice, Row, SecretCard, shortDate } from './parts';

export function DeveloperKeys() {
    const api = usePublishApi();
    const [keys, setKeys] = useState<ApiKey[] | null>(null);
    const [label, setLabel] = useState('');
    const [scopes, setScopes] = useState<string[]>(['accounts:read']);
    const [days, setDays] = useState<number>(90);
    const [secret, setSecret] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const [note, setNote] = useState<{ text: string; error: boolean } | null>(null);

    const running = useRef(false);
    const { guard, nextRead, scopeTick } = usePublishScope(api, () => {
        running.current = false; setKeys(null); setNote(null); setBusy(false); setLabel(''); setSecret(null);
        setScopes(['accounts:read']); setDays(90);
    });

    const load = useCallback(async () => {
        const valid = nextRead('list');
        try {
            const next = await fetchKeys(api);
            if (valid()) { setKeys(next); setNote(null); }
        } catch (err) {
            if (!valid()) return;
            setKeys(null);
            setNote({ text: t(devErrorKey(err)), error: true });
        }
    }, [api, nextRead, scopeTick]);

    useEffect(() => {
        void load();
    }, [load]);

    // A key shown once must not outlive the screen.
    useEffect(() => () => setSecret(null), []);

    async function create() {
        if (running.current) return;
        const valid = guard();
        const problem = keyProblem({ label, scopes, days });
        if (problem) return setNote({ text: t(`dev.problem.${problem}`), error: true });
        running.current = true; setBusy(true);
        setNote(null);
        try {
            const created = await createKey(api, { label, scopes, days });
            if (!valid()) return;
            setSecret(created.secret);
            setLabel('');
            await load();
        } catch (err) {
            if (!valid()) return;
            setNote({ text: t(devErrorKey(err)), error: true });
        } finally {
            if (valid()) { running.current = false; setBusy(false); }
        }
    }

    function confirmRevoke(k: ApiKey) {
        const valid = guard(); let used = false;
        Alert.alert(t('dev.keys.revokeTitle', { name: k.label }), t('dev.keys.revokeBody'), [
            { text: t('acct.cancel'), style: 'cancel' },
            {
                text: t('dev.revoke'),
                style: 'destructive',
                onPress: async () => {
                    if (used || !valid() || running.current) return;
                    used = true; running.current = true; setBusy(true);
                    try { await revokeKey(api, k.id); if (valid()) await load(); }
                    catch (err) { if (valid()) setNote({ text: t(devErrorKey(err)), error: true }); }
                    finally { if (valid()) { running.current = false; setBusy(false); } }
                },
            },
        ]);
    }

    return (
        <>
            {secret ? <SecretCard title={t('dev.keys.newTitle')} secret={secret} onDone={() => setSecret(null)} /> : null}
            <Card title={t('dev.keys.title')} help={t('dev.keys.help')}>
                {keys === null && !note ? <ActivityIndicator color={colors.accent} accessibilityLabel={t('dev.loading')} /> : null}
                {keys?.length === 0 ? <Text style={styles.help}>{t('dev.keys.none')}</Text> : null}
                {keys?.map((k) => (
                    <Row key={k.id}>
                        <Text style={styles.name}>{`${k.label}  ${k.prefix}…`}</Text>
                        <Text style={styles.help}>{[k.scopes.join(', '), k.revokedAt ? t('dev.revoked') : k.expiresAt ? t('dev.keys.expires', { date: shortDate(k.expiresAt) }) : '', k.lastUsedAt ? t('dev.keys.used', { date: shortDate(k.lastUsedAt) }) : t('dev.keys.neverUsed')].filter(Boolean).join(' · ')}</Text>
                        {keyLive(k) ? <Action label={t('dev.keys.revokeNamed', { name: k.label })} danger disabled={busy} onPress={() => confirmRevoke(k)} /> : null}
                    </Row>
                ))}
                <Status text={note?.text ?? null} error={note?.error} />
            </Card>
            <Card title={t('dev.keys.createTitle')}>
                <Text style={styles.label}>{t('dev.label')}</Text>
                <TextInput accessibilityLabel={t('dev.label')} style={styles.input} maxLength={LABEL_MAX} value={label} onChangeText={setLabel} placeholderTextColor={colors.muted} />
                <Text style={styles.label}>{t('dev.keys.scopes')}</Text>
                {SCOPES.map((s) => (
                    <Choice key={s} label={s} on={scopes.includes(s)} onPress={() => setScopes((cur) => (cur.includes(s) ? cur.filter((x) => x !== s) : [...cur, s]))} />
                ))}
                <Text style={styles.label}>{t('dev.keys.expiry')}</Text>
                {EXPIRY_DAYS.map((d) => (
                    <Choice key={d} label={t('dev.keys.days', { days: d })} on={days === d} onPress={() => setDays(d)} />
                ))}
                <Action label={t('dev.keys.create')} disabled={busy} onPress={() => void create()} />
            </Card>
        </>
    );
}
