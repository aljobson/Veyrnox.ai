import { Stack } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { approvalErrorKey, approvalStatusLabel, decisionLabel, fetchApprovals, type ApprovalRequest } from '../../../lib/publishApprovals';
import { t } from '../../../lib/i18n';
import { usePublishApi } from '../../../lib/usePublishApi';
import { colors } from '../../../theme';

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : null);

export default function Approvals() {
    const api = usePublishApi();
    const [requests, setRequests] = useState<ApprovalRequest[] | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [refreshing, setRefreshing] = useState(false);

    const load = useCallback(async () => {
        try {
            setRequests(await fetchApprovals(api));
            setError(null);
        } catch (err) {
            setRequests(null);
            setError(t(approvalErrorKey(err)));
        }
    }, [api]);

    useEffect(() => {
        setRequests(null);
        load();
    }, [load]);

    return (
        <View style={styles.screen}>
            <Stack.Screen options={{ title: t('approvals.title') }} />
            {error ? (
                <Text style={styles.error} accessibilityRole="alert">{error}</Text>
            ) : !requests ? (
                <ActivityIndicator color={colors.accent} />
            ) : (
                <FlatList
                    data={requests}
                    keyExtractor={(r) => r.id}
                    refreshControl={<RefreshControl refreshing={refreshing} tintColor={colors.accent} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}
                    ListHeaderComponent={<Text style={styles.intro}>{t('approvals.intro')}</Text>}
                    ListEmptyComponent={<Text style={styles.muted}>{t('approvals.none')}</Text>}
                    renderItem={({ item }) => (
                        <View style={styles.card} accessible accessibilityLabel={`${approvalStatusLabel(item.status)}. ${item.text}`}>
                            <Text style={[styles.status, item.status === 'rejected' && styles.bad]}>{approvalStatusLabel(item.status)}</Text>
                            {item.text ? <Text style={styles.text} numberOfLines={4}>{item.text}</Text> : null}
                            {item.scheduledAt ? <Text style={styles.muted}>{t('approvals.scheduledFor', { when: when(item.scheduledAt) ?? '' })}</Text> : null}
                            {item.reviewers.map((v) => (
                                <View key={v.id} style={styles.reviewer}>
                                    <Text style={styles.email}>{v.email}</Text>
                                    <Text style={[styles.muted, v.decision === 'rejected' && styles.bad]}>{decisionLabel(v.decision)}{v.decidedAt ? ` · ${when(v.decidedAt)}` : ''}</Text>
                                    {v.comment ? <Text style={styles.comment}>{v.comment}</Text> : null}
                                </View>
                            ))}
                        </View>
                    )}
                />
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background, paddingHorizontal: 16 },
    intro: { color: colors.body, paddingVertical: 14 },
    card: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 12, padding: 14, gap: 6, marginBottom: 12 },
    status: { color: colors.accent, fontWeight: '600' },
    bad: { color: colors.danger },
    text: { color: colors.text, fontSize: 15 },
    muted: { color: colors.muted, fontSize: 13 },
    reviewer: { paddingTop: 8, gap: 2, borderTopColor: colors.border, borderTopWidth: StyleSheet.hairlineWidth },
    email: { color: colors.body, fontSize: 14 },
    comment: { color: colors.text, fontSize: 14, fontStyle: 'italic' },
    error: { color: colors.danger, paddingTop: 16 },
});
