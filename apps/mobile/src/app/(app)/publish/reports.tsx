import { Stack, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { VEY_CLEARANCE } from '../../../components/VeyMascot';
import { touchTarget } from '../../../lib/a11y';
import { t } from '../../../lib/i18n';
import { FORMATS, fetchReports, reportsErrorKey, shareReport, type Report, type ReportFormat } from '../../../lib/publishReports';
import { usePublishApi } from '../../../lib/usePublishApi';
import { colors } from '../../../theme';

export default function Reports() {
    const api = usePublishApi();
    const [reports, setReports] = useState<Report[] | null>(null);
    const [exportsEnabled, setExportsEnabled] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [notice, setNotice] = useState<string | null>(null);
    const [busy, setBusy] = useState<string | null>(null);
    const [refreshing, setRefreshing] = useState(false);

    const load = useCallback(async () => {
        try {
            const r = await fetchReports(api);
            setReports(r.reports);
            setExportsEnabled(r.exportsEnabled);
            setError(null);
        } catch (err) {
            setReports(null);
            setError(t(reportsErrorKey(err)));
        }
    }, [api]);

    useFocusEffect(useCallback(() => { void load(); }, [load]));

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

    return (
        <View style={styles.screen}>
            <Stack.Screen options={{ title: t('reports.title') }} />
            {error && !reports ? (
                <Text style={styles.error} accessibilityRole="alert">{error}</Text>
            ) : !reports ? (
                <ActivityIndicator color={colors.accent} />
            ) : (
                <FlatList
                    data={reports}
                    keyExtractor={(r) => r.id}
                    contentContainerStyle={{ paddingBottom: VEY_CLEARANCE }}
                    refreshControl={<RefreshControl refreshing={refreshing} tintColor={colors.accent} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}
                    ListHeaderComponent={<View><Text style={styles.muted}>{t('reports.intro')}</Text>{notice ? <Text style={styles.error} accessibilityRole="alert">{notice}</Text> : null}</View>}
                    ListEmptyComponent={<Text style={styles.muted}>{t('reports.none')}</Text>}
                    renderItem={({ item }) => (
                        <View style={styles.card}>
                            <Text style={styles.name}>{item.name}</Text>
                            <Text style={styles.muted}>{t('reports.range', { days: item.rangeDays })}{item.comparePrevious ? ` · ${t('reports.compared')}` : ''}{item.cadence !== 'manual' ? ` · ${t(`reports.cadence.${item.cadence}`)}` : ''}</Text>
                            {item.lastDeliveryAt ? <Text style={styles.muted}>{t('reports.lastSent', { when: new Date(item.lastDeliveryAt).toLocaleDateString() })}</Text> : null}
                            {exportsEnabled ? (
                                <View style={styles.row}>
                                    {FORMATS.map((f) => (
                                        <Pressable key={f} accessibilityRole="button" accessibilityLabel={t('reports.shareAs', { name: item.name, format: t(`reports.format.${f}`) })} disabled={busy !== null} accessibilityState={{ disabled: busy !== null }} style={[styles.btn, touchTarget, busy !== null && styles.off]} onPress={() => share(item, f)}>
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
