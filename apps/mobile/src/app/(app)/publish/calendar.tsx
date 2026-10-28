import { NetworkLogo } from '../../../components/publish/NetworkLogo';
import { networkName } from '../../../lib/networkLogos';
import { PHONE_CATALOGUE } from '../../../lib/publishConnect';
import { publishScope } from '../../../lib/usePublishRole';
import { subscribeCacheUser } from '../../../lib/appCache';
import { brandStore } from '../../../lib/publishBrand';
import { Button, Text as ThemedText, themedStyles, useThemedStyles, Icon } from '../../../components/ui';
import { Stack, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { touchTarget } from '../../../lib/a11y';
import { formatLocale, t } from '../../../lib/i18n';
import { postStatusLabel, targetStatusLabel } from '../../../lib/publish';
import { ApiError } from '../../../lib/api';
import { CALENDAR_STATUSES, type CalendarStatus, calendarErrorKey, countByDay, dayGroups, fetchCalendar, monthBounds, weekBounds, type CalendarPost } from '../../../lib/publishCalendar';
import { CalendarMonth } from '../../../components/CalendarMonth';
import { UnlockCard } from '../../../components/UnlockCard';
import { usePublishApi } from '../../../lib/usePublishApi';
import { colors } from '../../../theme';

const MAX_PAGES = 5; // 100 posts a page: a week is never expected to need more than this
const short = (d: Date) => d.toLocaleDateString(formatLocale(undefined), { day: 'numeric', month: 'short' });
const time = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString(formatLocale(undefined), { hour: '2-digit', minute: '2-digit' }) : '');

export default function Calendar() {
    const api = usePublishApi();
    const router = useRouter();
    const filterStyles = useThemedStyles(filterSheets);
    const [status, setStatus] = useState<CalendarStatus | null>(null);
    const [network, setNetwork] = useState<string | null>(null);
    const generation = useRef(0), currentApi = useRef(api);
    currentApi.current = api;
    const [view, setView] = useState<'week' | 'month'>('week');
    const [offset, setOffset] = useState(0);
    const [picked, setPicked] = useState<string | null>(null);
    const [locked, setLocked] = useState(false);
    const [reloadKey, setReloadKey] = useState(0);
    const [posts, setPosts] = useState<CalendarPost[] | null>(null);
    const [truncated, setTruncated] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [refreshing, setRefreshing] = useState(false);
    const week = useMemo(() => (view === 'week' ? weekBounds(new Date(), offset) : monthBounds(new Date(), offset)), [view, offset]);

    const query = JSON.stringify([week.start, week.end, status, network]);
    const currentQuery = useRef(query); currentQuery.current = query;
    const load = useCallback(async () => {
        const version = ++generation.current, scope = publishScope();
        const valid = () => version === generation.current && scope === publishScope() && api === currentApi.current && query === currentQuery.current;
        setPosts(null); setError(null); setLocked(false); setTruncated(false);
        try {
            const all: CalendarPost[] = [];
            let cursor = null as { at: string; id: string } | null;
            let pages = 0;
            do {
                const page = await fetchCalendar(api, week.start, week.end, cursor, { status, network });
                if (!valid()) return;
                all.push(...page.posts);
                cursor = page.next;
                pages += 1;
            } while (cursor && pages < MAX_PAGES);
            if (!valid()) return;
            setPosts(all); setTruncated(cursor !== null); setError(null); setLocked(false);
        } catch (err) {
            if (!valid()) return;
            setPosts(null);
            if (err instanceof ApiError && err.status === 402) setLocked(true);
            else setError(t(calendarErrorKey(err)));
        } finally { if (valid()) setRefreshing(false); }
    }, [api, week, status, network, query]);

    useEffect(() => {
        const reset = () => {
            generation.current++; setPosts(null); setError(null); setLocked(false); setTruncated(false); setRefreshing(false);
            setReloadKey(value => value + 1);
        };
        const userOff = subscribeCacheUser(reset), brandOff = brandStore.subscribe(reset);
        return () => { generation.current++; userOff(); brandOff(); };
    }, []);
    useEffect(() => {
        void load();
        return () => { generation.current++; };
    }, [load, reloadKey]);

    function filter(nextStatus: CalendarStatus | null, nextNetwork: string | null) {
        if (nextStatus === status && nextNetwork === network) return;
        generation.current++; setPosts(null); setPicked(null);
        setStatus(nextStatus); setNetwork(nextNetwork);
    }

    function switchView(next: 'week' | 'month') {
        setView(next);
        setOffset(0);
        setPicked(null);
    }

    const groups = useMemo(() => {
        const all = posts ? dayGroups(posts) : [];
        return view === 'month' && picked ? all.filter((g) => g.key === picked) : all;
    }, [posts, view, picked]);
    const counts = useMemo(() => countByDay(posts ?? []), [posts]);
    const last = new Date(week.end.getFullYear(), week.end.getMonth(), week.end.getDate() - 1);

    return (
        <View style={styles.screen}>
            <Stack.Screen options={{ title: t('calendar.title') }} />
            <View style={styles.nav}>
                <Pressable accessibilityRole="button" accessibilityLabel={t(view === 'week' ? 'calendar.prev' : 'calendar.prevMonth')} style={[styles.arrow, touchTarget]} onPress={() => setOffset((o) => o - 1)}><Icon name="arrowLeft" size={24} tint={styles.arrowText.color} /></Pressable>
                <Pressable accessibilityRole="button" accessibilityLabel={t(view === 'week' ? 'calendar.thisWeek' : 'calendar.thisMonth')} disabled={offset === 0} style={[touchTarget, styles.rangeBox]} onPress={() => setOffset(0)}>
                    <Text style={styles.range}>{view === 'week' ? `${short(week.start)} – ${short(last)}` : week.start.toLocaleDateString(formatLocale(undefined), { month: 'long', year: 'numeric' })}</Text>
                </Pressable>
                <Pressable accessibilityRole="button" accessibilityLabel={t(view === 'week' ? 'calendar.next' : 'calendar.nextMonth')} style={[styles.arrow, touchTarget]} onPress={() => setOffset((o) => o + 1)}><Icon name="arrowRight" size={24} tint={styles.arrowText.color} /></Pressable>
            </View>
            <View style={styles.views}>
                {(['week', 'month'] as const).map((v) => (
                    <Pressable key={v} accessibilityRole="button" accessibilityState={{ selected: view === v }} style={[styles.viewChip, touchTarget, view === v && styles.viewOn]} onPress={() => switchView(v)}>
                        <Text style={[styles.viewText, view === v && styles.viewTextOn]}>{t(v === 'week' ? 'calendar.week' : 'calendar.month')}</Text>
                    </Pressable>
                ))}
            </View>
            <ThemedText accessibilityRole="header" variant="bodyStrong">{t('publishParity.calendar.status')}</ThemedText>
            <ScrollView horizontal contentContainerStyle={filterStyles.chips} style={filterStyles.scroll}>
                {([null, ...CALENDAR_STATUSES] as const).map(value => <Button key={value ?? 'all'} size="md" variant="secondary" label={value ? postStatusLabel(value) : t('publishParity.calendar.allStatuses')} accessibilityState={{ selected: status === value }} style={status === value ? filterStyles.selected : undefined} onPress={() => filter(value, network)} />)}
            </ScrollView>
            <ThemedText accessibilityRole="header" variant="bodyStrong">{t('publishParity.calendar.network')}</ThemedText>
            <ScrollView horizontal contentContainerStyle={filterStyles.chips} style={filterStyles.scroll}>
                <Button size="md" variant="secondary" label={t('publishParity.calendar.allNetworks')} accessibilityState={{ selected: network === null }} style={network === null ? filterStyles.selected : undefined} onPress={() => filter(status, null)} />
                {PHONE_CATALOGUE.map(value => <Button key={value} size="md" variant="secondary" label={networkName(value)} accessibilityState={{ selected: network === value }} style={network === value ? filterStyles.selected : undefined} onPress={() => filter(status, value)}><NetworkLogo network={value} /><ThemedText>{networkName(value)}</ThemedText></Button>)}
            </ScrollView>
            <ThemedText tone="secondary">{t('publishParity.calendar.timezone', { zone: Intl.DateTimeFormat().resolvedOptions().timeZone })}</ThemedText>
            {locked ? (
                <UnlockCard feature="calendar" onUnlocked={() => setReloadKey((n) => n + 1)} />
            ) : error ? (
                <Text style={styles.error} accessibilityRole="alert">{error}</Text>
            ) : !posts ? (
                <ActivityIndicator color={colors.accent} />
            ) : (
                <ScrollView refreshControl={<RefreshControl refreshing={refreshing} tintColor={colors.accent} onRefresh={async () => { setRefreshing(true); await load(); }} />}>
                    {view === 'month' ? <CalendarMonth monthStart={week.start} counts={counts} selected={picked} onSelect={(k) => setPicked((cur) => (cur === k ? null : k))} /> : null}
                    {groups.length === 0 ? <Text style={styles.muted}>{t(status || network ? 'publishParity.calendar.noneFiltered' : view === 'week' ? 'calendar.none' : picked ? 'calendar.noneDay' : 'calendar.noneMonth')}</Text> : null}
                    {groups.map((g) => (
                        <View key={g.key}>
                            <Text style={styles.day} accessibilityRole="header">{g.date.toLocaleDateString(formatLocale(undefined), { weekday: 'long', day: 'numeric', month: 'long' })}</Text>
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
                                        </Text>
                                        {p.targets.map(target => <View key={target.id} style={filterStyles.target}><NetworkLogo network={target.network} /><ThemedText tone={target.publishStatus === 'failed' ? 'danger' : 'secondary'}>{target.publishStatus === 'failed' ? t('publishParity.networkStatus', { network: networkName(target.network), status: targetStatusLabel(target.publishStatus) }) : networkName(target.network)}</ThemedText></View>)}
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
    range: { color: colors.text, fontSize: 17, fontWeight: '600', textAlign: 'center' },
    rangeBox: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    day: { color: colors.muted, fontSize: 13, textTransform: 'uppercase', paddingTop: 16, paddingBottom: 4 },
    row: { flexDirection: 'row', gap: 12, paddingVertical: 10, borderBottomColor: colors.border, borderBottomWidth: StyleSheet.hairlineWidth },
    time: { color: colors.body, fontSize: 15, flexShrink: 0 },
    rowText: { flex: 1, gap: 2 },
    text: { color: colors.text, fontSize: 15 },
    status: { color: colors.accent, fontSize: 13 },
    bad: { color: colors.danger },
    muted: { color: colors.muted, paddingVertical: 16 },
    error: { color: colors.danger, paddingTop: 16 },
    views: { flexDirection: 'row', gap: 8, paddingBottom: 8 },
    viewChip: { paddingHorizontal: 14, borderRadius: 10, backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1 },
    viewOn: { backgroundColor: colors.accent, borderColor: colors.accent },
    viewText: { color: colors.body },
    viewTextOn: { color: colors.accentInk, fontWeight: '600' },
});

const filterSheets = themedStyles(p => ({
    chips: { gap: 8, paddingVertical: 8 }, scroll: { flexGrow: 0, flexShrink: 0 },
    selected: { borderWidth: 2, borderColor: p.accent },
    target: { flexDirection: 'row', alignItems: 'center', gap: 6 },
}));
