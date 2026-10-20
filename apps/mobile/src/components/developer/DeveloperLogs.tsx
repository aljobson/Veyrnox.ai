import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, Text, TextInput, View } from 'react-native';
import { usePublishApi } from '../../lib/usePublishApi';
import { t } from '../../lib/i18n';
import { devErrorKey, fetchLogs, type LogEntry, type LogFilters } from '../../lib/publishDeveloper';
import { colors } from '../../theme';
import { Action, Card, Status, styles } from '../account/shared';
import { Row, shortDate } from './parts';

const STATUSES = ['success', 'error', 'pending'] as const;

export function DeveloperLogs() {
    const api = usePublishApi();
    const [logs, setLogs] = useState<LogEntry[] | null>(null);
    const [status, setStatus] = useState<LogFilters['status']>(undefined);
    const [q, setQ] = useState('');
    const [error, setError] = useState<string | null>(null);

    const load = useCallback(async () => {
        setError(null);
        try {
            setLogs(await fetchLogs(api, { status, q }));
        } catch (err) {
            setLogs(null);
            setError(t(devErrorKey(err)));
        }
    }, [api, status, q]);

    useEffect(() => {
        void load();
        // Typing searches when the person submits, not on every key.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [api, status]);

    return (
        <Card title={t('dev.logs.title')} help={t('dev.logs.help')}>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }} accessibilityRole="tablist">
                {[undefined, ...STATUSES].map((s) => (
                    <Pressable key={s ?? 'all'} accessibilityRole="tab" accessibilityState={{ selected: status === s }} onPress={() => setStatus(s)} style={{ minHeight: 44, justifyContent: 'center', paddingHorizontal: 14, borderRadius: 999, borderWidth: 1, borderColor: status === s ? colors.accent : colors.border }}>
                        <Text style={{ color: colors.text }}>{t(`dev.logs.s.${s ?? 'all'}`)}</Text>
                    </Pressable>
                ))}
            </View>
            <TextInput accessibilityLabel={t('dev.logs.search')} placeholder={t('dev.logs.search')} placeholderTextColor={colors.muted} style={styles.input} maxLength={80} returnKeyType="search" autoCapitalize="none" value={q} onChangeText={setQ} onSubmitEditing={() => void load()} />
            {logs === null && !error ? <ActivityIndicator color={colors.accent} accessibilityLabel={t('dev.loading')} /> : null}
            {logs?.length === 0 ? <Text style={styles.help}>{t('dev.logs.none')}</Text> : null}
            {logs?.map((l) => (
                <Row key={l.id}>
                    <Text style={styles.name}>{`${l.method} ${l.route}`}</Text>
                    <Text style={styles.help}>{[l.status !== null ? `HTTP ${l.status}` : '', l.errorCode ?? '', l.keyLabel ?? l.keyPrefix ?? '', shortDate(l.at)].filter(Boolean).join(' · ')}</Text>
                </Row>
            ))}
            <Status text={error} error />
            <Action label={t('acct.oauth.refresh')} onPress={() => void load()} />
        </Card>
    );
}
