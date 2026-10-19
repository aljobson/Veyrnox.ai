import { Stack } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { touchTarget } from '../../../lib/a11y';
import { t } from '../../../lib/i18n';
import { actionLabel, fetchActivity, teamErrorKey, type ActivityCursor, type ActivityEvent } from '../../../lib/publishTeam';
import { usePublishApi } from '../../../lib/usePublishApi';
import { colors } from '../../../theme';

export default function ActivityScreen() {
    const api = usePublishApi();
    const [events, setEvents] = useState<ActivityEvent[] | null>(null);
    const [next, setNext] = useState<ActivityCursor | null>(null);
    const [limited, setLimited] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [refreshing, setRefreshing] = useState(false);
    const [more, setMore] = useState(false);

    const load = useCallback(async () => {
        try {
            const r = await fetchActivity(api);
            setEvents(r.events);
            setNext(r.next);
            setLimited(r.limited);
            setError(null);
        } catch (err) {
            setEvents(null);
            setError(t(teamErrorKey(err)));
        }
    }, [api]);

    useEffect(() => {
        setEvents(null);
        load();
    }, [load]);

    async function loadMore() {
        if (!next || more) return;
        setMore(true);
        try {
            const r = await fetchActivity(api, next);
            // Entries already shown are skipped, so a repeated page cannot loop.
            setEvents((cur) => {
                const seen = new Set((cur ?? []).map((e) => `${e.source}:${e.id}`));
                return [...(cur ?? []), ...r.events.filter((e) => !seen.has(`${e.source}:${e.id}`))];
            });
            setNext(r.next);
        } catch (err) {
            setError(t(teamErrorKey(err)));
        } finally {
            setMore(false);
        }
    }

    return (
        <View style={styles.screen}>
            <Stack.Screen options={{ title: t('activity.title') }} />
            {error && !events ? (
                <Text style={styles.error} accessibilityRole="alert">{error}</Text>
            ) : !events ? (
                <ActivityIndicator color={colors.accent} />
            ) : (
                <FlatList
                    data={events}
                    keyExtractor={(e) => `${e.source}:${e.id}`}
                    refreshControl={<RefreshControl refreshing={refreshing} tintColor={colors.accent} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}
                    ListHeaderComponent={limited ? <Text style={styles.muted}>{t('activity.limited')}</Text> : undefined}
                    ListEmptyComponent={<Text style={styles.muted}>{t('activity.none')}</Text>}
                    ListFooterComponent={
                        <View>
                            {error ? <Text style={styles.error}>{error}</Text> : null}
                            {next ? (
                                <Pressable accessibilityRole="button" disabled={more} style={[styles.more, touchTarget]} onPress={loadMore}>
                                    {more ? <ActivityIndicator color={colors.accent} /> : <Text style={styles.moreText}>{t('activity.more')}</Text>}
                                </Pressable>
                            ) : null}
                        </View>
                    }
                    renderItem={({ item }) => (
                        <View style={styles.row} accessible accessibilityLabel={`${actionLabel(item.action)}, ${item.actor}, ${item.createdAt ? new Date(item.createdAt).toLocaleString() : ''}`}>
                            <Text style={styles.action}>{actionLabel(item.action)}</Text>
                            <Text style={styles.muted}>{item.actor}{item.createdAt ? ` · ${new Date(item.createdAt).toLocaleString()}` : ''}</Text>
                            {item.detail ? <Text style={styles.detail}>{item.detail}</Text> : null}
                        </View>
                    )}
                />
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background, paddingHorizontal: 16 },
    row: { paddingVertical: 12, gap: 2, borderBottomColor: colors.border, borderBottomWidth: StyleSheet.hairlineWidth },
    action: { color: colors.text, fontSize: 15 },
    detail: { color: colors.body, fontSize: 13 },
    muted: { color: colors.muted, fontSize: 13, paddingVertical: 4 },
    error: { color: colors.danger, paddingTop: 12 },
    more: { alignItems: 'center', justifyContent: 'center' },
    moreText: { color: colors.accent, fontWeight: '600' },
});
