import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { TitleCard } from './TitleCard';
import { fetchFeedPage, type CinemaTitle, type Cursor } from '../../lib/cinema';
import { MIN_TARGET } from '../../lib/a11y';
import { t } from '../../lib/i18n';
import { colors } from '../../theme';

interface ViewToken {
    readonly item: unknown;
}

const VIEWABILITY = { itemVisiblePercentThreshold: 80 } as const;

// The one-title-per-screen feed. A category narrows it; the parent remounts it when the category changes.
export function CinemaFeed({ category = null }: { readonly category?: string | null }) {
    const router = useRouter();
    const [titles, setTitles] = useState<CinemaTitle[] | null>(null);
    const [next, setNext] = useState<Cursor | null>(null);
    const [failed, setFailed] = useState(false);
    const [height, setHeight] = useState(0);
    const [playingId, setPlayingId] = useState<string | null>(null);
    const [searching, setSearching] = useState(false);
    // The last read past the first page kept nothing although the server has more: the list did not grow, so the end
    // is not reached again by itself. The reader is offered Show more instead.
    const [stalled, setStalled] = useState(false);
    const loadingMore = useRef(false);

    const load = useCallback(async () => {
        setFailed(false);
        try {
            const page = await fetchFeedPage(null, fetch, undefined, category);
            setTitles([...page.titles]);
            setNext(page.next);
        } catch {
            setFailed(true);
        }
    }, []);

    // Leaving the feed (a title page, the report form) stops playback; coming back shows posters.
    useFocusEffect(
        useCallback(() => {
            if (!titles) void load();
            return () => setPlayingId(null);
        }, [load, titles]),
    );

    async function more() {
        if (!next || loadingMore.current) return;
        loadingMore.current = true;
        try {
            const page = await fetchFeedPage(next, fetch, undefined, category);
            const grew = page.titles.some((x) => !(titles ?? []).some((y) => y.id === x.id));
            setTitles((t) => [...(t ?? []), ...page.titles.filter((x) => !(t ?? []).some((y) => y.id === x.id))]);
            setNext(page.next);
            setStalled(!grew && page.next !== null);
        } catch {
            // Nothing was added, so the end is not reached again by itself: Show more tries again.
            setStalled(true);
        } finally {
            loadingMore.current = false;
        }
    }

    // Three pages of only short clips (at the start or further on): the reader asks for more rather than the feed reading on by itself.
    async function showMore() {
        setSearching(true);
        try { await more(); } finally { setSearching(false); }
    }

    const onlyShort = (
        <>
            <Text style={styles.muted}>{t('cinemaBrowse.watchOnlyShort')}</Text>
            {searching ? <ActivityIndicator color={colors.accent} /> : (
                <Pressable accessibilityRole="button" style={styles.more} onPress={showMore}>
                    <Text style={styles.moreText}>{t('cinemaBrowse.showMore')}</Text>
                </Pressable>
            )}
        </>
    );

    // A page that scrolls out of view stops; nothing starts by itself.
    const onViewable = useCallback(({ viewableItems }: { viewableItems: ViewToken[] }) => {
        const visible = viewableItems[0]?.item as CinemaTitle | undefined;
        setPlayingId((current) => (current && current === visible?.id ? current : null));
    }, []);

    return (
        <View style={styles.screen} onLayout={(e) => setHeight(e.nativeEvent.layout.height)}>
            {failed ? (
                <Pressable accessibilityRole="button" style={styles.center} onPress={load}>
                    <Text style={styles.error}>{t('cinema.couldnotloadCinemaTaptoretry')}</Text>
                </Pressable>
            ) : !titles || height === 0 ? (
                <View style={styles.center}><ActivityIndicator color={colors.accent} /></View>
            ) : titles.length === 0 && next !== null ? (
                <View style={styles.center}>{onlyShort}</View>
            ) : titles.length === 0 ? (
                <View style={styles.center}><Text style={styles.muted}>{category ? t('cinemaBrowse.emptyCategory') : t('cinema.nothingtowatchyetCheckbacksoon')}</Text></View>
            ) : (
                <FlatList
                    data={titles}
                    keyExtractor={(t) => t.id}
                    pagingEnabled
                    showsVerticalScrollIndicator={false}
                    getItemLayout={(_, index) => ({ length: height, offset: height * index, index })}
                    onEndReached={more}
                    onEndReachedThreshold={1}
                    ListFooterComponent={stalled && next !== null ? <View style={[styles.center, { height }]}>{onlyShort}</View> : undefined}
                    viewabilityConfig={VIEWABILITY}
                    onViewableItemsChanged={onViewable}
                    extraData={playingId}
                    windowSize={3}
                    renderItem={({ item }) => (
                        <TitleCard
                            item={item}
                            height={height}
                            playing={playingId === item.id}
                            onPlay={() => setPlayingId(item.id)}
                            onOpen={() => router.push({ pathname: '/cinema/[id]', params: { id: item.id } })}
                            onReport={() => router.push({ pathname: '/report', params: { kind: 'cinema_title', id: item.id } })}
                        />
                    )}
                />
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 12 },
    more: { minHeight: MIN_TARGET, justifyContent: 'center', paddingHorizontal: 20 },
    moreText: { color: colors.accent, fontWeight: '600' },
    error: { color: colors.danger },
    muted: { color: colors.muted },
});
