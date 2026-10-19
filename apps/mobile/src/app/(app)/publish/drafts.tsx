import * as WebBrowser from 'expo-web-browser';
import { Stack } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { API_BASE } from '../../../lib/api';
import { touchTarget } from '../../../lib/a11y';
import { t, plural } from '../../../lib/i18n';
import { approveBatch, batchGroups, discardDrafts, draftActionErrorKey, draftsErrorKey, fetchDrafts, groupNetworks, type Draft } from '../../../lib/publishDrafts';
import { usePublishApi } from '../../../lib/usePublishApi';
import { colors } from '../../../theme';

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : null);

export default function Drafts() {
    const api = usePublishApi();
    const [drafts, setDrafts] = useState<Draft[] | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [refreshing, setRefreshing] = useState(false);
    const [approvalEnabled, setApprovalEnabled] = useState(true);
    const [busy, setBusy] = useState(false);
    const [notice, setNotice] = useState<string | null>(null);

    const load = useCallback(async () => {
        try {
            const r = await fetchDrafts(api);
            setDrafts(r.drafts);
            setApprovalEnabled(r.approvalEnabled);
            setError(null);
        } catch (err) {
            setDrafts(null);
            setError(t(draftsErrorKey(err)));
        }
    }, [api]);

    useEffect(() => {
        setDrafts(null);
        load();
    }, [load]);

    const groups = useMemo(() => (drafts ? batchGroups(drafts) : []), [drafts]);

    // Each action is confirmed with the networks named; nothing is sent before the person agrees.
    function confirm(title: string, body: string, action: string, destructive: boolean, run: () => Promise<string>) {
        Alert.alert(title, body, [
            { text: t('drafts.cancel'), style: 'cancel' },
            {
                text: action,
                style: destructive ? 'destructive' : 'default',
                onPress: () => {
                    if (busy) return;
                    setBusy(true);
                    setNotice(null);
                    run()
                        .then(setNotice)
                        .catch((err) => setNotice(t(draftActionErrorKey(err))))
                        .finally(() => {
                            setBusy(false);
                            void load();
                        });
                },
            },
        ]);
    }

    const names = (list: readonly Draft[]) => groupNetworks(list).join(', ') || t('drafts.noNetworks');
    const approve = (batchId: string, list: readonly Draft[]) =>
        confirm(t('drafts.approveTitle'), plural('drafts.approveBody', list.length, { networks: names(list) }), t('drafts.approve'), false, async () => {
            const r = await approveBatch(api, batchId);
            return r.failed > 0 ? t('drafts.approvedSome', { approved: r.approved, failed: r.failed }) : plural('drafts.approved', r.approved);
        });
    const discard = (batchId: string, list: readonly Draft[], postId?: string) =>
        confirm(t('drafts.discardTitle'), postId ? t('drafts.discardOneBody', { networks: names(list) }) : plural('drafts.discardBody', list.length, { networks: names(list) }), t('drafts.discard'), true, async () => plural('drafts.discarded', await discardDrafts(api, batchId, postId)));

    return (
        <ScrollView style={styles.screen} contentContainerStyle={styles.body} refreshControl={<RefreshControl refreshing={refreshing} tintColor={colors.accent} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}>
            <Stack.Screen options={{ title: t('drafts.title') }} />
            {error ? (
                <Text style={styles.error} accessibilityRole="alert">{error}</Text>
            ) : !drafts ? (
                <ActivityIndicator color={colors.accent} />
            ) : (
                <>
                    <Text style={styles.intro}>{t('drafts.intro')}</Text>
                    {notice ? <Text style={styles.notice} accessibilityLiveRegion="polite">{notice}</Text> : null}
                    {groups.length === 0 ? <Text style={styles.muted}>{t('drafts.none')}</Text> : null}
                    {groups.map((g, gi) => (
                        <View key={g.batchId ?? `none-${gi}`} style={styles.group}>
                            <Text style={styles.groupTitle} accessibilityRole="header">{plural(g.batchId ? 'drafts.inBatch' : 'drafts.noBatch', g.drafts.length)}</Text>
                            {g.batchId ? (
                                <View style={styles.actions}>
                                    {approvalEnabled ? (
                                        <Pressable accessibilityRole="button" disabled={busy} accessibilityState={{ disabled: busy }} style={[styles.approve, touchTarget, busy && styles.off]} onPress={() => approve(g.batchId as string, g.drafts)}>
                                            <Text style={styles.approveText}>{t('drafts.approveBatch')}</Text>
                                        </Pressable>
                                    ) : null}
                                    <Pressable accessibilityRole="button" disabled={busy} accessibilityState={{ disabled: busy }} style={[styles.discardBtn, touchTarget, busy && styles.off]} onPress={() => discard(g.batchId as string, g.drafts)}>
                                        <Text style={styles.discardText}>{t('drafts.discardBatch')}</Text>
                                    </Pressable>
                                </View>
                            ) : null}
                            {g.drafts.map((d) => (
                                <View key={d.id} style={styles.card} accessible accessibilityLabel={`${d.text.slice(0, 80)}. ${d.networks.join(', ')}`}>
                                    <Text style={styles.text} numberOfLines={4}>{d.text || t('drafts.noText')}</Text>
                                    {d.scheduledAt ? <Text style={styles.muted}>{t('drafts.plannedFor', { when: when(d.scheduledAt) ?? '' })}</Text> : null}
                                    {d.networks.length ? <Text style={styles.networks}>{d.networks.join(', ')}</Text> : null}
                                    {d.mediaTypes.length ? <Text style={styles.muted}>{d.mediaTypes.join(', ')}</Text> : null}
                                    {g.batchId ? (
                                        <Pressable accessibilityRole="button" accessibilityLabel={t('drafts.discardOne')} disabled={busy} style={[styles.discardBtn, touchTarget, busy && styles.off]} onPress={() => discard(g.batchId as string, [d], d.id)}>
                                            <Text style={styles.discardText}>{t('drafts.discard')}</Text>
                                        </Pressable>
                                    ) : null}
                                </View>
                            ))}
                        </View>
                    ))}
                    <Pressable accessibilityRole="link" style={[styles.web, touchTarget]} onPress={() => WebBrowser.openBrowserAsync(`${API_BASE}/app/publish`)}>
                        <Text style={styles.webText}>{t('drafts.openWeb')}</Text>
                    </Pressable>
                </>
            )}
        </ScrollView>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background },
    body: { padding: 16, gap: 10 },
    intro: { color: colors.body },
    group: { gap: 8, marginTop: 8 },
    groupTitle: { color: colors.muted, fontSize: 13, textTransform: 'uppercase' },
    card: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 12, padding: 14, gap: 4 },
    text: { color: colors.text, fontSize: 15 },
    networks: { color: colors.accent, fontSize: 13 },
    muted: { color: colors.muted, fontSize: 13 },
    web: { alignItems: 'center', justifyContent: 'center', marginTop: 12 },
    webText: { color: colors.accent, textDecorationLine: 'underline' },
    error: { color: colors.danger },
    notice: { color: colors.accent },
    off: { opacity: 0.4 },
    actions: { flexDirection: 'row', gap: 10, flexWrap: 'wrap' },
    approve: { backgroundColor: colors.accent, borderRadius: 10, paddingHorizontal: 14, alignItems: 'center' },
    approveText: { color: colors.accentInk, fontWeight: '700' },
    discardBtn: { paddingHorizontal: 12, alignItems: 'flex-start' },
    discardText: { color: colors.danger, fontWeight: '600' },
});
