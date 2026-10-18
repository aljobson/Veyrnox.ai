import { Stack } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useAuth } from '../../../auth/AuthProvider';
import { fetchAccounts, fetchAnalytics, lastDays, metricLabel, publishErrorMessage, type Analytics, type PublishAccount } from '../../../lib/publish';
import { colors } from '../../../theme';

const DAYS = 30;

export default function AnalyticsScreen() {
    const { api } = useAuth();
    const [accounts, setAccounts] = useState<PublishAccount[] | null>(null);
    const [accountId, setAccountId] = useState<string | null>(null);
    const [data, setData] = useState<Analytics | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        fetchAccounts(api)
            .then((r) => {
                setAccounts(r.accounts);
                setAccountId(r.accounts[0]?.id ?? null);
            })
            .catch((err) => setError(publishErrorMessage(err)));
    }, [api]);

    useEffect(() => {
        if (!accountId) return;
        let cancelled = false;
        setData(null);
        setError(null);
        const { from, to } = lastDays(DAYS);
        fetchAnalytics(api, accountId, from, to)
            .then((r) => !cancelled && setData(r))
            .catch((err) => !cancelled && setError(publishErrorMessage(err)));
        return () => {
            cancelled = true;
        };
    }, [api, accountId]);

    const latest = data?.days[data.days.length - 1];
    return (
        <ScrollView style={styles.screen} contentContainerStyle={styles.body}>
            <Stack.Screen options={{ title: 'Analytics' }} />
            {accounts && accounts.length > 1 ? (
                <View style={styles.chips}>
                    {accounts.map((a) => (
                        <Pressable key={a.id} accessibilityRole="button" style={[styles.chip, a.id === accountId && styles.chipOn]} onPress={() => setAccountId(a.id)}>
                            <Text style={[styles.chipText, a.id === accountId && styles.chipTextOn]}>{a.displayName}</Text>
                        </Pressable>
                    ))}
                </View>
            ) : null}
            {accounts && accounts.length === 0 ? <Text style={styles.muted}>Connect an account to see analytics.</Text> : null}
            {error ? <Text style={styles.error}>{error}</Text> : !accounts || (accountId && !data) ? <ActivityIndicator color={colors.accent} /> : null}
            {data ? (
                <>
                    <Text style={styles.muted}>Last {DAYS} days{data.syncFailing ? '. Syncing is failing, so the newest numbers may be missing.' : data.lastOkAt ? `. Updated ${new Date(data.lastOkAt).toLocaleString()}.` : '.'}</Text>
                    {latest ? (
                        <View style={styles.card}>
                            <Text style={styles.cardTitle}>Latest day, {latest.date}</Text>
                            {Object.entries(latest.metrics).map(([k, v]) => (
                                <View key={k} style={styles.metric} accessible accessibilityLabel={`${metricLabel(k)}: ${v}`}>
                                    <Text style={styles.body_}>{metricLabel(k)}</Text>
                                    <Text style={styles.value}>{v.toLocaleString()}</Text>
                                </View>
                            ))}
                        </View>
                    ) : (
                        <Text style={styles.muted}>No numbers yet for this period.</Text>
                    )}
                    {data.posts.slice(0, 20).map((p) => (
                        <View key={p.id} style={styles.card}>
                            <Text style={styles.body_} numberOfLines={2}>{p.caption || p.type || 'Post'}</Text>
                            {p.publishedAt ? <Text style={styles.muted}>{new Date(p.publishedAt).toLocaleDateString()}</Text> : null}
                            {Object.entries(p.metrics).slice(0, 4).map(([k, v]) => (
                                <Text key={k} style={styles.small}>{metricLabel(k)}: {v.toLocaleString()}</Text>
                            ))}
                        </View>
                    ))}
                </>
            ) : null}
        </ScrollView>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background },
    body: { padding: 16, gap: 12 },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    chip: { paddingVertical: 8, paddingHorizontal: 12, borderRadius: 10, backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1 },
    chipOn: { backgroundColor: colors.accent, borderColor: colors.accent },
    chipText: { color: colors.body },
    chipTextOn: { color: colors.accentInk, fontWeight: '600' },
    card: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 12, padding: 14, gap: 6 },
    cardTitle: { color: colors.text, fontWeight: '600', fontSize: 16 },
    metric: { flexDirection: 'row', justifyContent: 'space-between' },
    body_: { color: colors.text, fontSize: 15 },
    value: { color: colors.money, fontSize: 15, fontWeight: '600' },
    small: { color: colors.body, fontSize: 13 },
    muted: { color: colors.muted, fontSize: 13 },
    error: { color: colors.danger },
});
