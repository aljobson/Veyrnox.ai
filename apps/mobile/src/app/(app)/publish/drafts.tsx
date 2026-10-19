import * as WebBrowser from 'expo-web-browser';
import { Stack } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { API_BASE } from '../../../lib/api';
import { touchTarget } from '../../../lib/a11y';
import { t, plural } from '../../../lib/i18n';
import { batchGroups, draftsErrorKey, fetchDrafts, type Draft } from '../../../lib/publishDrafts';
import { usePublishApi } from '../../../lib/usePublishApi';
import { colors } from '../../../theme';

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : null);

export default function Drafts() {
    const api = usePublishApi();
    const [drafts, setDrafts] = useState<Draft[] | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [refreshing, setRefreshing] = useState(false);

    const load = useCallback(async () => {
        try {
            setDrafts((await fetchDrafts(api)).drafts);
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
                    {groups.length === 0 ? <Text style={styles.muted}>{t('drafts.none')}</Text> : null}
                    {groups.map((g, gi) => (
                        <View key={g.batchId ?? `none-${gi}`} style={styles.group}>
                            <Text style={styles.groupTitle} accessibilityRole="header">{plural(g.batchId ? 'drafts.inBatch' : 'drafts.noBatch', g.drafts.length)}</Text>
                            {g.drafts.map((d) => (
                                <View key={d.id} style={styles.card} accessible accessibilityLabel={`${d.text.slice(0, 80)}. ${d.networks.join(', ')}`}>
                                    <Text style={styles.text} numberOfLines={4}>{d.text || t('drafts.noText')}</Text>
                                    {d.scheduledAt ? <Text style={styles.muted}>{t('drafts.plannedFor', { when: when(d.scheduledAt) ?? '' })}</Text> : null}
                                    {d.networks.length ? <Text style={styles.networks}>{d.networks.join(', ')}</Text> : null}
                                    {d.mediaTypes.length ? <Text style={styles.muted}>{d.mediaTypes.join(', ')}</Text> : null}
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
});
