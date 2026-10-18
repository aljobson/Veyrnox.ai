import { Stack, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { touchTarget } from '../../../lib/a11y';
import { t } from '../../../lib/i18n';
import { postStatusLabel, targetStatusLabel } from '../../../lib/publish';
import { calendarErrorKey, dayGroups, fetchCalendar, weekBounds, type CalendarPost } from '../../../lib/publishCalendar';
import { usePublishApi } from '../../../lib/usePublishApi';
import { colors } from '../../../theme';

const MAX_PAGES = 5; // 100 posts a page: a week is never expected to need more than this
const short = (d: Date) => d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
const time = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }) : '');

export default function Calendar() {
    const api = usePublishApi();
    const router = useRouter();
    const [offset, setOffset] = useState(0);
    const [posts, setPosts] = useState<CalendarPost[] | null>(null);
    const [truncated, setTruncated] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [refreshing, setRefreshing] = useState(false);
    const week = useMemo(() => weekBounds(new Date(), offset), [offset]);

    const load = useCallback(async () => {
        try {
            const all: CalendarPost[] = [];
            let cursor = null as { at: string; id: string } | null;
            let pages = 0;
            do {
                const page = await fetchCalendar(api, week.start, week.end, cursor);
                all.push(...page.posts);
                cursor = page.next;
                pages += 1;
            } while (cursor && pages < MAX_PAGES);
            setPosts(all);
            setTruncated(cursor !== null);
            setError(null);
        } catch (err) {
            setPosts(null);
            setError(t(calendarErrorKey(err)));
        }
    }, [api, week]);

    useEffect(() => {
        setPosts(null);
        load();
    }, [load]);

    const groups = useMemo(() => (posts ? dayGroups(posts) : []), [posts]);
    const last = new Date(week.end.getFullYear(), week.end.getMonth(), week.end.getDate() - 1);

    return (
        <View style={styles.screen}>
            <Stack.Screen options={{ title: t('calendar.title') }} />
            <View style={styles.nav}>
                <Pressable accessibilityRole="button" accessibilityLabel={t('calendar.prev')} style={[styles.arrow, touchTarget]} onPress={() => setOffset((o) => o - 1)}><Text style={styles.arrowText}>‹</Text></Pressable>
                <Pressable accessibilityRole="button" accessibilityLabel={t('calendar.thisWeek')} disabled={offset === 0} style={touchTarget} onPress={() => setOffset(0)}>
                    <Text style={styles.range}>{short(week.start)} – {short(last)}</Text>
                </Pressable>
                <Pressable accessibilityRole="button" accessibilityLabel={t('calendar.next')} style={[styles.arrow, touchTarget]} onPress={() => setOffset((o) => o + 1)}><Text style={styles.arrowText}>›</Text></Pressable>
            </View>
            {error ? (
                <Text style={styles.error} accessibilityRole="alert">{error}</Text>
            ) : !posts ? (
                <ActivityIndicator color={colors.accent} />
            ) : (
                <ScrollView refreshControl={<RefreshControl refreshing={refreshing} tintColor={colors.accent} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}>
                    {groups.length === 0 ? <Text style={styles.muted}>{t('calendar.none')}</Text> : null}
                    {groups.map((g) => (
                        <View key={g.key}>
                            <Text style={styles.day} accessibilityRole="header">{g.date.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}</Text>
                            {g.posts.map((p) => (
                                <Pressable
                                    key={p.id}
                                    accessibilityRole="button"
                                    accessibilityLabel={`${time(p.scheduledAt)}, ${postStatusLabel(p.status)}. ${p.text.slice(0, 80)}`}
                                    style={[styles.row, touchTarget]}
                                    onPress={() => router.push({ pathname: '/publish/post/[id]', params: { id: p.id } })}
                                >
                                    <Text style={styles.time}>{time(p.scheduledAt)}</Text>
                                    <View style={styles.rowText}>
                                        <Text style={styles.text} numberOfLines={2}>{p.text || t('calendar.noText')}</Text>
                                        <Text style={[styles.status, p.status === 'failed' && styles.bad]}>
                                            {postStatusLabel(p.status)}
                                            {p.targets.length ? `  ·  ${p.targets.map((x) => `${x.network}${x.publishStatus === 'failed' ? ` (${targetStatusLabel(x.publishStatus)})` : ''}`).join(', ')}` : ''}
                                        </Text>
                                    </View>
                                </Pressable>
                            ))}
                        </View>
                    ))}
                    {truncated ? <Text style={styles.muted}>{t('calendar.more')}</Text> : null}
                </ScrollView>
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background, paddingHorizontal: 16 },
    nav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 8 },
    arrow: { alignItems: 'center', justifyContent: 'center' },
    arrowText: { color: colors.accent, fontSize: 30 },
    range: { color: colors.text, fontSize: 17, fontWeight: '600' },
    day: { color: colors.muted, fontSize: 13, textTransform: 'uppercase', paddingTop: 16, paddingBottom: 4 },
    row: { flexDirection: 'row', gap: 12, paddingVertical: 10, borderBottomColor: colors.border, borderBottomWidth: StyleSheet.hairlineWidth },
    time: { color: colors.body, fontSize: 15, width: 52 },
    rowText: { flex: 1, gap: 2 },
    text: { color: colors.text, fontSize: 15 },
    status: { color: colors.accent, fontSize: 13 },
    bad: { color: colors.danger },
    muted: { color: colors.muted, paddingVertical: 16 },
    error: { color: colors.danger, paddingTop: 16 },
});
