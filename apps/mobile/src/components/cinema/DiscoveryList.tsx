import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { discoveryTarget, typeLabel } from '../../lib/cinemaViewer';
import { CinemaPosterImage } from './CinemaPosterImage';
import { Card, Text as UiText } from '../ui';
import { fetchDiscovery, type BrowseMode, type DiscoveryCursor, type DiscoveryTitle } from '../../lib/cinemaBrowse';
import { editorialSeriesList, phoneCategories, type EditorialSeries } from '../../lib/cinemaSeries';
import { formatLocale, plural, t } from '../../lib/i18n';
import { MIN_TARGET } from '../../lib/a11y';
import { colors } from '../../theme';

interface Props {
    readonly mode: BrowseMode;
    readonly category: string | null;
}

type State = 'loading' | 'ready' | 'closed' | 'error';

// The Series list and the Vote list: one title per row, a poster, the episode count (or the open competition), and a
// button to the title page. The parent remounts it when the mode or category changes, so a late answer cannot land in
// another tab.
export function DiscoveryList({ mode, category }: Props) {
    const router = useRouter();
    const editorial = mode === 'series' ? editorialSeriesList(category) : [];
    const [titles, setTitles] = useState<DiscoveryTitle[]>([]);
    const [next, setNext] = useState<DiscoveryCursor | null>(null);
    const [state, setState] = useState<State>('loading');
    const [moreFailed, setMoreFailed] = useState(false);
    const busy = useRef(false);
    const live = useRef(true);

    const load = useCallback(async (cursor: DiscoveryCursor | null) => {
        if (busy.current) return;
        busy.current = true;
        setMoreFailed(false);
        if (!cursor) setState('loading');
        const result = await fetchDiscovery(mode, category, cursor);
        busy.current = false;
        if (!live.current) return;
        if (result.kind === 'ok') {
            setTitles((prev) => (cursor ? [...prev, ...result.page.titles.filter((x) => !prev.some((y) => y.id === x.id))] : [...result.page.titles]));
            setNext(result.page.next);
            setState('ready');
        } else if (cursor) {
            setMoreFailed(true);
        } else {
            setState(result.kind);
        }
    }, [mode, category]);

    useEffect(() => {
        live.current = true;
        void load(null);
        return () => { live.current = false; };
    }, [load]);

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
    return (
        <FlatList<DiscoveryTitle | EditorialSeries>
            data={[...editorial, ...titles]}
            keyExtractor={(x) => 'slug' in x ? x.slug : x.id}
            contentContainerStyle={styles.list}
            onEndReached={() => next && load(next)}
            onEndReachedThreshold={0.6}
            ListHeaderComponent={mode === 'voting' && titles.length ? <UiText tone="secondary">{t('cinema.discovery.exploreTitlesEligibleForAnOpen')}</UiText> : undefined}
            ListFooterComponent={moreFailed ? (
                <Pressable accessibilityRole="button" style={styles.more} onPress={() => next && load(next)}><Text style={styles.error}>{t('cinemaBrowse.moreFailed')}</Text></Pressable>
            ) : undefined}
            renderItem={({ item }) => 'slug' in item ? <EditorialRow series={item} onOpen={() => router.push({ pathname: '/cinema/series/[slug]', params: { slug: item.slug } })} /> : <Row item={item} mode={mode} onOpen={() => router.push(discoveryTarget(item))} />}
        />
    );
}

function EditorialRow({ series, onOpen }: { series: EditorialSeries; onOpen: () => void }) {
    const meta = `${t('cinemaSeries.by', { creator: series.creatorName })} · ${plural('cinemaBrowse.episodes', series.episodes.length)}`;
    const categories = phoneCategories(series.categories);
    return (
        <Pressable accessibilityRole="button" accessibilityLabel={`${series.title}. ${meta}`} style={styles.row} onPress={onOpen}>
            <Image source={{ uri: series.posterUrl }} style={styles.poster} contentFit="cover" accessible={false} accessibilityIgnoresInvertColors />
            <View style={styles.body}>
                <Text style={styles.name} numberOfLines={2}>{series.title}</Text>
                <Text style={styles.muted} numberOfLines={1}>{meta}</Text>
                {categories.length ? <Text style={styles.cats} numberOfLines={1}>{categories.map(c => t(`cinemaBrowse.cat.${c}`)).join(' · ')}</Text> : null}
                <Text style={styles.synopsis} numberOfLines={2}>{series.description}</Text>
                <View style={styles.watch}><Text style={styles.watchText}>{t('cinemaBrowse.watch')}</Text></View>
            </View>
        </Pressable>
    );
}

function Row({ item, mode, onOpen }: { item: DiscoveryTitle; mode: BrowseMode; onOpen: () => void }) {
    const series = item.contentType === 'SERIES';
    return (
        <Card accessibilityLabel={item.title} style={{ padding: 0, overflow: 'hidden' }} onPress={onOpen}>
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
    list: { padding: 12, gap: 12 },
    row: { flexDirection: 'row', gap: 12, backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 12, padding: 10 },
    poster: { width: 84, height: 126, borderRadius: 8, backgroundColor: colors.border },
    body: { flex: 1, gap: 3 },
    name: { color: colors.text, fontSize: 17, fontWeight: '700' },
    muted: { color: colors.muted },
    cats: { color: colors.muted, fontSize: 13 },
    comp: { color: colors.money, fontSize: 13 },
    synopsis: { color: colors.body, fontSize: 14 },
    watch: { marginTop: 'auto', alignSelf: 'flex-start', minHeight: MIN_TARGET, justifyContent: 'center', backgroundColor: colors.accent, borderRadius: 10, paddingHorizontal: 20 },
    watchText: { color: colors.accentInk, fontWeight: '700' },
    error: { color: colors.danger },
    more: { minHeight: MIN_TARGET, alignItems: 'center', justifyContent: 'center' },
});
