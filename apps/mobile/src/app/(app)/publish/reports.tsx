import { rawText } from '../../../lib/i18n/translate';
import { Text as StatusText } from '../../../components/ui/Text';
import { LoadError } from '../../../components/publish/LoadError';
import { Stack, useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { touchTarget } from '../../../lib/a11y';
import { formatLocale, t } from '../../../lib/i18n';
import { FORMATS, canEditReports, deleteReport, reportParams, fetchReports, reportsErrorKey, shareReport, type Report, type ReportFormat } from '../../../lib/publishReports';
import { usePublishApi } from '../../../lib/usePublishApi';
import { colors, LIST_END_PADDING } from '../../../theme';

export default function Reports() {
    const api = usePublishApi();
    const router = useRouter();
    const [canEdit, setCanEdit] = useState(false);
    const pending = useRef(false);
    const generation = useRef(0);
    const [reports, setReports] = useState<Report[] | null>(null);
    const [exportsEnabled, setExportsEnabled] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [notice, setNotice] = useState<string | null>(null);
    const [busy, setBusy] = useState<string | null>(null);
    const [refreshing, setRefreshing] = useState(false);

    const load = useCallback(async () => {
        const version = generation.current;
        try {
            const r = await fetchReports(api);
            if (version !== generation.current) return;
            setReports(r.reports);
            setExportsEnabled(r.exportsEnabled);
            setCanEdit(canEditReports(r.brandRole));
            setError(null);
        } catch (err) {
            if (version !== generation.current) return;
            setReports(null);
            setError(t(reportsErrorKey(err)));
        }
    }, [api]);

    useFocusEffect(useCallback(() => { generation.current++; setReports(null); setCanEdit(false); void load(); return () => { generation.current++; pending.current = false; }; }, [load]));

    async function share(r: Report, f: ReportFormat) {
        if (busy) return;
        setBusy(`${r.id}:${f}`);
        setNotice(null);
        try {
            await shareReport(api, r.id, f);
        } catch (err) {
            setNotice(t(reportsErrorKey(err)));
        } finally {
            setBusy(null);
        }
    }

    function remove(report: Report) {
        if (busy || pending.current || !canEdit) return;
        pending.current = true;
        const version = generation.current;
        Alert.alert(t('publishReporting.delete'), t('publishReporting.deleteConfirm', { name: report.name }), [
            { text: t('publishReporting.cancel'), style: 'cancel', onPress: () => { pending.current = false; } },
            { text: t('publishReporting.delete'), style: 'destructive', onPress: async () => {
                if (version !== generation.current) return;
                setBusy(report.id); setNotice(null);
                try { await deleteReport(api, report.id); if (version === generation.current) { setNotice(t('publishReporting.deleted')); await load(); } }
                catch (err) { if (version === generation.current) setNotice(t(reportsErrorKey(err, 'delete'))); }
                finally { pending.current = false; if (version === generation.current) setBusy(null); }
            } },
        ], { cancelable: true, onDismiss: () => { pending.current = false; } });
    }

    return (
        <View style={styles.screen}>
            <Stack.Screen options={{ title: t('reports.title') }} />
            {error && !reports ? (
                <LoadError message={error} onRetry={() => { void load(); }} />
            ) : !reports ? (
                <ActivityIndicator color={colors.accent} />
            ) : (
                <FlatList
                    data={reports}
                    keyExtractor={(r) => r.id}
                    contentContainerStyle={{ paddingBottom: LIST_END_PADDING }}
                    refreshControl={<RefreshControl refreshing={refreshing} tintColor={colors.accent} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}
                    ListHeaderComponent={<View><Text style={styles.muted}>{t('publishReporting.intro')}</Text>{notice ? <StatusText variant="inherit" style={styles.muted} accessibilityLiveRegion="polite">{notice}</StatusText> : null}{busy ? <StatusText variant="inherit" style={styles.muted} accessibilityLiveRegion="polite">{t('publishReporting.working')}</StatusText> : null}</View>}
                    ListFooterComponent={canEdit ? <Pressable accessibilityRole="button" style={[styles.btn, touchTarget]} onPress={() => router.push('/publish/report-edit')}><Text style={styles.btnText}>{t('publishReporting.new')}</Text></Pressable> : <Text style={styles.muted}>{t('publishReporting.roleNote')}</Text>}
                    ListEmptyComponent={<Text style={styles.muted}>{t('reports.none')}</Text>}
                    renderItem={({ item }) => (
                        <View style={styles.card}>
                            <Text style={styles.name} accessibilityRole="header">{item.name}</Text>
                            <Text style={styles.muted}>{t('reports.range', { days: item.rangeDays })}{item.comparePrevious ? ` · ${t('reports.compared')}` : ''}{item.cadence !== 'manual' ? ` · ${t(`reports.cadence.${item.cadence}`)}` : ''}</Text>
                            {item.lastDeliveryAt ? <Text style={styles.muted}>{t('reports.lastSent', { when: new Date(item.lastDeliveryAt).toLocaleDateString(formatLocale()) })}</Text> : null}
                            <View style={styles.row}>
                                <Pressable accessibilityRole="button" accessibilityLabel={rawText(t('publishReporting.openFor', { name: item.name }))} style={[styles.btn, touchTarget]} onPress={() => router.push({ pathname: '/publish/analytics', params: reportParams(item) })}><Text style={styles.btnText}>{t('publishReporting.open')}</Text></Pressable>
                                {canEdit ? <>
                                    <Pressable accessibilityRole="button" accessibilityLabel={rawText(t('publishReporting.editFor', { name: item.name }))} style={[styles.btn, touchTarget]} onPress={() => router.push({ pathname: '/publish/report-edit', params: { id: item.id } })}><Text style={styles.btnText}>{t('publishReporting.edit')}</Text></Pressable>
                                    <Pressable accessibilityRole="button" accessibilityLabel={rawText(t('publishReporting.deleteFor', { name: item.name }))} accessibilityState={{ disabled: !!busy, busy: busy === item.id }} disabled={!!busy} style={[styles.btn, touchTarget]} onPress={() => remove(item)}><Text style={styles.btnText}>{t('publishReporting.delete')}</Text></Pressable>
                                </> : null}
                            </View>
                            {exportsEnabled ? (
                                <View style={styles.row}>
                                    {FORMATS.map((f) => (
                                        <Pressable key={f} accessibilityRole="button" accessibilityLabel={rawText(t('reports.shareAs', { name: item.name, format: t(`reports.format.${f}`) }))} disabled={busy !== null} accessibilityState={{ disabled: busy !== null }} style={[styles.btn, touchTarget, busy !== null && styles.off]} onPress={() => share(item, f)}>
                                            {busy === `${item.id}:${f}` ? <ActivityIndicator color={colors.accent} /> : <Text style={styles.btnText}>{t(`reports.format.${f}`)}</Text>}
                                        </Pressable>
                                    ))}
                                </View>
                            ) : <Text style={styles.muted}>{t('reports.exportsOff')}</Text>}
                        </View>
                    )}
                />
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background, paddingHorizontal: 16 },
    card: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 12, padding: 14, gap: 4, marginTop: 10 },
    name: { color: colors.text, fontSize: 16, fontWeight: '600' },
    muted: { color: colors.muted, fontSize: 13, paddingVertical: 2 },
    row: { flexDirection: 'row', gap: 8, marginTop: 6 },
    btn: { flex: 1, alignItems: 'center', backgroundColor: colors.background, borderColor: colors.accent, borderWidth: 1, borderRadius: 10 },
    btnText: { color: colors.accent, fontWeight: '600' },
    off: { opacity: 0.5 },
    error: { color: colors.danger, paddingTop: 12 },
});
