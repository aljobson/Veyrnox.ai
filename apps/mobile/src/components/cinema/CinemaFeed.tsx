import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { TitleCard } from './TitleCard';
import { fetchTitlesPage, type CinemaTitle, type Cursor } from '../../lib/cinema';
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
    const loadingMore = useRef(false);

    const load = useCallback(async () => {
        setFailed(false);
        try {
            const page = await fetchTitlesPage(null, fetch, undefined, category);
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
            const page = await fetchTitlesPage(next, fetch, undefined, category);
            setTitles((t) => [...(t ?? []), ...page.titles.filter((x) => !(t ?? []).some((y) => y.id === x.id))]);
            setNext(page.next);
        } catch {
            // The next scroll to the end tries again.
        } finally {
            loadingMore.current = false;
        }
    }

    // A page that scrolls out of view stops; nothing starts by itself.
    const onViewable = useCallback(({ viewableItems }: { viewableItems: ViewToken[] }) => {
        const visible = viewableItems[0]?.item as CinemaTitle | undefined;
        setPlayingId((current) => (current && current === visible?.id ? current : null));
    }, []);

    return (
        <View style={styles.screen} onLayout={(e) => setHeight(e.nativeEvent.layout.height)}>
            {failed ? (
                <Pressable accessibilityRole="button" style={styles.center} onPress={load}>
                    <Text style={styles.error}>Could not load Cinema. Tap to retry.</Text>
                </Pressable>
            ) : !titles || height === 0 ? (
                <View style={styles.center}><ActivityIndicator color={colors.accent} /></View>
            ) : titles.length === 0 ? (
                <View style={styles.center}><Text style={styles.muted}>{category ? t('cinemaBrowse.emptyCategory') : 'Nothing to watch yet. Check back soon.'}</Text></View>
            ) : (
                <FlatList
                    data={titles}
                    keyExtractor={(t) => t.id}
                    pagingEnabled
                    showsVerticalScrollIndicator={false}
                    getItemLayout={(_, index) => ({ length: height, offset: height * index, index })}
                    onEndReached={more}
                    onEndReachedThreshold={1}
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
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
    error: { color: colors.danger },
    muted: { color: colors.muted },
});
