import { rawText } from '../../lib/i18n/translate';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Platform, Pressable, RefreshControl, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { discoveryTarget, typeLabel } from '../../lib/cinemaViewer';
import { CinemaPosterImage } from './CinemaPosterImage';
import { SeriesTile } from './SeriesTile';
import { Card, Text as UiText } from '../ui';
import { fetchDiscovery, type BrowseMode, type DiscoveryCursor, type DiscoveryTitle } from '../../lib/cinemaBrowse';
import { editorialSeriesList, type EditorialSeries } from '../../lib/cinemaSeries';
import { formatLocale, plural, t } from '../../lib/i18n';
import { MIN_TARGET } from '../../lib/a11y';
import { colors } from '../../theme';

interface Props {
    readonly mode: BrowseMode;
    readonly category: string | null;
}

type State = 'loading' | 'ready' | 'closed' | 'error';
const LIST_PADDING = 12;
const GAP = 12;

// The Series grid (two columns of tiles) and the Vote list (one title per row, a poster, the open competition and a
// button to the title page). Pull down to reload page one. The parent remounts it when the mode or category changes, so a late answer cannot land in
// another tab.
export function DiscoveryList({ mode, category }: Props) {
    const router = useRouter();
    const editorial = mode === 'series' ? editorialSeriesList(category) : [];
    const [titles, setTitles] = useState<DiscoveryTitle[]>([]);
    const [next, setNext] = useState<DiscoveryCursor | null>(null);
    const [state, setState] = useState<State>('loading');
    const [moreFailed, setMoreFailed] = useState(false);
    const [refreshing, setRefreshing] = useState(false);
    const screen = useWindowDimensions();
    const [listWidth, setListWidth] = useState(0);
    const busy = useRef(false);
    // Bumped by every first-page load and by unmount: a read applies its answer only while its generation is current.
    const generation = useRef(0);

    const load = useCallback(async (cursor: DiscoveryCursor | null, refresh = false) => {
        if (cursor && busy.current) return;
        let gen = generation.current;
        if (cursor) busy.current = true;
        else { gen = ++generation.current; busy.current = false; }
        setMoreFailed(false);
        if (refresh) setRefreshing(true);
        else if (!cursor) setState('loading');
        const result = await fetchDiscovery(mode, category, cursor);
        if (gen !== generation.current) return;
        if (cursor) busy.current = false;
        if (refresh) setRefreshing(false);
        if (result.kind === 'ok') {
            setTitles((prev) => (cursor ? [...prev, ...result.page.titles.filter((x) => !prev.some((y) => y.id === x.id))] : [...result.page.titles]));
            setNext(result.page.next);
            setState('ready');
        } else if (cursor) {
            setMoreFailed(true);
        } else if (!refresh) {
            setState(result.kind);
        }
    }, [mode, category]);

    useEffect(() => {
        void load(null);
        return () => { generation.current++; };
    }, [load]);

    const refresh = useCallback(() => { void load(null, true); }, [load]);

    if (state === 'loading') return <View style={styles.center}><ActivityIndicator color={colors.accent} /></View>;
    if (state === 'closed' && !editorial.length) return <View style={styles.center}><Text style={styles.muted} accessibilityRole="text">{t(mode === 'voting' ? 'cinemaBrowse.voteClosed' : 'cinemaBrowse.viewingClosed')}</Text></View>;
    if (state === 'error' && !editorial.length) {
        return (
            <Pressable accessibilityRole="button" style={styles.center} onPress={() => load(null)}>
                <Text style={styles.error}>{t('cinemaBrowse.loadFailed')}</Text>
            </Pressable>
        );
    }
    if (titles.length === 0 && editorial.length === 0) return <View style={styles.center}><Text style={styles.muted}>{t(mode === 'voting' ? 'cinemaBrowse.voteEmpty' : 'cinemaBrowse.seriesEmpty')}</Text></View>;
    const tiles = mode === 'series';
    const tileWidth = Math.max(0, ((listWidth || screen.width) - LIST_PADDING * 2 - GAP) / 2);
    return (
        <FlatList<DiscoveryTitle | EditorialSeries>
            data={[...editorial, ...titles]}
            keyExtractor={(x) => 'slug' in x ? x.slug : x.id}
            numColumns={tiles ? 2 : 1}
            columnWrapperStyle={tiles ? styles.columns : undefined}
            contentContainerStyle={styles.list}
            onLayout={(e) => setListWidth(e.nativeEvent.layout.width)}
            onEndReached={() => next && load(next)}
            onEndReachedThreshold={0.6}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.accent} />}
            ListHeaderComponent={mode === 'voting' && titles.length ? <UiText tone="secondary">{t('cinema.discovery.exploreTitlesEligibleForAnOpen')}</UiText> : undefined}
            ListFooterComponent={moreFailed ? (
                <Pressable accessibilityRole="button" style={styles.more} onPress={() => next && load(next)}><Text style={styles.error}>{t('cinemaBrowse.moreFailed')}</Text></Pressable>
            ) : undefined}
            renderItem={({ item }) => {
                const open = () => 'slug' in item ? router.push({ pathname: '/cinema/series/[slug]', params: { slug: item.slug } }) : router.push(discoveryTarget(item));
                if (tiles) return <SeriesTile item={item} width={tileWidth} onOpen={open} />;
                return 'slug' in item ? null : <Row item={item} mode={mode} onOpen={open} />;
            }}
        />
    );
}

function Row({ item, mode, onOpen }: { item: DiscoveryTitle; mode: BrowseMode; onOpen: () => void }) {
    const series = item.contentType === 'SERIES';
    return (
        <Card accessibilityLabel={rawText(item.title)} style={{ padding: 0, overflow: 'hidden' }} onPress={onOpen}>
            <CinemaPosterImage id={item.id} style={{ borderTopLeftRadius: 12, borderTopRightRadius: 12 }} />
            <View style={{ padding: 12, gap: 8 }}>
                <View style={styles.badges}>
                    <UiText variant="micro" style={styles.badge}>{typeLabel(item.contentType)}</UiText>
                    {series ? <UiText variant="micro" style={styles.badge}>{plural('cinemaBrowse.episodes', item.episodeCount)}</UiText>
                        : item.durationSeconds !== null ? <UiText variant="micro" style={styles.badge}>{t('cinema.duration', { n: Math.max(1, Math.round(item.durationSeconds / 60)) })}</UiText> : null}
                </View>
                <UiText variant="title3" accessibilityRole="header">{item.title}</UiText>
                {item.contentType === 'EPISODE' && item.seriesTitle ? <UiText tone="secondary">{t('cinemaViewer.fromSeries', { series: item.seriesTitle })}</UiText> : null}
                {item.creator ? <UiText tone="secondary">{t('cinemaSeries.by', { creator: item.creator })}</UiText> : null}
                <View style={styles.badges}>{item.categories.map(c => <UiText key={c} variant="micro" style={styles.badge}>{t(`cinemaBrowse.cat.${c}`)}</UiText>)}</View>
                {item.synopsis ? <UiText numberOfLines={2}>{item.synopsis}</UiText> : null}
                {mode === 'voting' ? item.competitions.map(comp => <View key={comp.id} style={{ gap: 4 }}>
                    <UiText variant="bodyStrong">{comp.name}</UiText>
                    <UiText tone="secondary">{t('cinemaSocial.voteCount', { count: comp.qualifiedVotes })}</UiText>
                    {Number.isFinite(Date.parse(comp.endsAt)) ? <UiText tone="secondary">{t('cinemaSocial.endsOn', { date: new Date(comp.endsAt).toLocaleDateString(formatLocale()) })}</UiText> : null}
                </View>) : null}
                <View style={styles.watch}><UiText style={styles.watchText}>{series ? t('cinemaBrowse.watch') : mode === 'voting' ? t('cinemaBrowse.openTitle') : t('cinemaBrowse.play')}</UiText></View>
            </View>
        </Card>
    );
}

const styles = StyleSheet.create({
    badges: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
    badge: { fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', backgroundColor: colors.surface, padding: 4, borderRadius: 4 },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
    list: { padding: LIST_PADDING, gap: GAP },
    columns: { gap: GAP },
    muted: { color: colors.muted },
    comp: { color: colors.money, fontSize: 13 },
    watch: { marginTop: 'auto', alignSelf: 'flex-start', minHeight: MIN_TARGET, justifyContent: 'center', backgroundColor: colors.accent, borderRadius: 10, paddingHorizontal: 20 },
    watchText: { color: colors.accentInk, fontWeight: '700' },
    error: { color: colors.danger },
    more: { minHeight: MIN_TARGET, alignItems: 'center', justifyContent: 'center' },
});
