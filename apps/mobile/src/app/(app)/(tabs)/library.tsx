import { Stack, useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useAuth } from '../../../auth/AuthProvider';
import { LibraryItem } from '../../../components/LibraryItem';
import { StaleNote } from '../../../components/StaleNote';
import { appCache, getCacheUser } from '../../../lib/appCache';
import { POLICIES, type CacheMeta } from '../../../lib/cache';
import { observe } from '../../../lib/network';
import { KIND_FILTERS, STATE_FILTERS, VIEWS, canSchedule, filterJobs, kindMap, readFavourites, toggled, writeFavourites, type KindFilter, type StateFilter, type View as LayoutView } from '../../../lib/libraryView';
import { fetchCatalogCached, mediaApi, type CatalogModel, type Job, type JobPage } from '../../../lib/media';
import { publishHref } from '../../../lib/nextSteps';
import { VEY_CLEARANCE } from '../../../components/VeyMascot';
import { colors } from '../../../theme';
import { t } from '../../../lib/i18n';
import { selectedState, touchTarget } from '../../../lib/a11y';
import { EmptyState } from '../../../components/EmptyState';
import { useVeyScroll } from '../../../lib/useVeyScroll';

export default function Library() {
    const onScroll = useVeyScroll();
    const { api } = useAuth();
    const router = useRouter();
    const [jobs, setJobs] = useState<Job[] | null>(null);
    const [next, setNext] = useState<JobPage['next']>(null);
    const [failed, setFailed] = useState(false);
    const [saved, setSaved] = useState<CacheMeta | null>(null);
    const loadingMore = useRef(false);
    const [stateFilter, setStateFilter] = useState<StateFilter>('all');
    const [kindFilter, setKindFilter] = useState<KindFilter>('all');
    const [favOnly, setFavOnly] = useState(false);
    const [view, setView] = useState<LayoutView>('list');
    const [favourites, setFavourites] = useState<string[]>([]);
    const [models, setModels] = useState<CatalogModel[]>([]);
    const kinds = useMemo(() => kindMap(models), [models]);
    const names = useMemo(() => new Map(models.map((m) => [m.id, m.name])), [models]);
    const shown = useMemo(() => filterJobs(jobs ?? [], { state: stateFilter, kind: kindFilter, favourites: favOnly ? favourites : null }, kinds), [jobs, stateFilter, kindFilter, favOnly, favourites, kinds]);

    function star(jobId: string) {
        const nextList = toggled(favourites, jobId);
        setFavourites(nextList);
        void writeFavourites(appCache, getCacheUser(), nextList);
    }

    const load = useCallback(async () => {
        setFailed(false);
        try {
            // First page only is saved (labels are personal data: per user, wiped on sign-out). Older pages load live.
            const out = await appCache.swr({
                policy: POLICIES.library,
                userId: getCacheUser(),
                fetcher: () => observe(mediaApi(api).listJobs()),
                onData: (page) => {
                    setJobs(page.jobs);
                    setNext(page.next);
                },
            });
            setSaved(out.meta);
        } catch {
            setFailed(true);
        }
    }, [api]);

    useFocusEffect(
        useCallback(() => {
            void load();
            void readFavourites(appCache, getCacheUser()).then(setFavourites);
            // The model list only names and sorts what the server returned; a failed read leaves them unfiltered by type.
            fetchCatalogCached((list) => setModels(list)).catch(() => undefined);
        }, [load]),
    );

    async function more() {
        if (!next || loadingMore.current) return;
        loadingMore.current = true;
        try {
            const page = await observe(mediaApi(api).listJobs(next));
            setJobs((j) => [...(j ?? []), ...page.jobs]);
            setNext(page.next);
        } catch {
            // The next scroll retries.
        } finally {
            loadingMore.current = false;
        }
    }

    return (
        <View style={styles.screen}>
            <Stack.Screen options={{ title: t('label.Library') }} />
            <Pressable accessibilityRole="button" accessibilityLabel={t('library.videoFilesLabel')} style={[styles.filesLink, touchTarget]} onPress={() => router.push('/library/files')}>
                <Text style={styles.filesText}>{t('library.videoFiles')}</Text>
            </Pressable>
            <View style={styles.bar} accessibilityLabel={t('library.filter.state')}>
                {STATE_FILTERS.map((f) => (
                    <Chip key={f} label={t(`library.state.${f}`)} on={stateFilter === f} onPress={() => setStateFilter(f)} />
                ))}
            </View>
            <View style={styles.bar} accessibilityLabel={t('library.filter.type')}>
                {KIND_FILTERS.map((f) => (
                    <Chip key={f} label={t(`library.type.${f}`)} on={kindFilter === f} onPress={() => setKindFilter(f)} />
                ))}
                <Chip label={t('library.type.favourites')} on={favOnly} onPress={() => setFavOnly(!favOnly)} />
            </View>
            <View style={styles.bar} accessibilityLabel={t('library.view.label')}>
                {VIEWS.map((v) => (
                    <Chip key={v} label={t(`library.view.${v}`)} on={view === v} onPress={() => setView(v)} />
                ))}
            </View>
            {failed ? (
                <Pressable accessibilityRole="button" style={touchTarget} onPress={load}>
                    <Text style={styles.error}>{t('library.loadError')}</Text>
                </Pressable>
            ) : jobs === null ? (
                <ActivityIndicator color={colors.accent} />
            ) : (
                <FlatList
                    contentContainerStyle={styles.list}
                    onScroll={onScroll}
                    scrollEventThrottle={64}
                    key={view}
                    numColumns={view === 'grid' ? 2 : 1}
                    data={shown}
                    ListHeaderComponent={<StaleNote meta={saved} />}
                    keyExtractor={(j) => j.job_id}
                    onEndReached={more}
                    onRefresh={load}
                    refreshing={false}
                    ListEmptyComponent={
                        jobs && jobs.length > 0 ? (
                            <Text style={styles.muted}>{next ? t('library.noMatchOlder') : t('library.noMatch')}</Text>
                        ) : (
                            <EmptyState title={t('empty.library.title')} body={t('library.empty')} actionLabel={t('empty.library.action')} href="/create" />
                        )
                    }
                    ListFooterComponent={
                        next ? (
                            <Pressable accessibilityRole="button" style={[styles.older, touchTarget]} onPress={more}>
                                <Text style={styles.filesText}>{t('library.older')}</Text>
                            </Pressable>
                        ) : undefined
                    }
                    renderItem={({ item }) => (
                        <LibraryItem
                            job={item}
                            name={item.label || names.get(item.model_id) || item.model_id}
                            kind={kinds.get(item.model_id)}
                            grid={view === 'grid'}
                            starred={favourites.includes(item.job_id)}
                            canSchedule={canSchedule(item, kinds)}
                            onOpen={() => router.push({ pathname: '/job/[id]', params: { id: item.job_id } })}
                            onStar={() => star(item.job_id)}
                            onSchedule={() => router.push(publishHref(item.job_id))}
                        />
                    )}
                />
            )}
        </View>
    );
}

function Chip({ label, on, onPress }: { readonly label: string; readonly on: boolean; readonly onPress: () => void }) {
    return (
        <Pressable accessibilityRole="button" accessibilityState={selectedState(on)} style={[styles.chip, on && styles.chipOn]} onPress={onPress}>
            <Text style={[styles.chipText, on && styles.chipTextOn]}>{label}</Text>
        </Pressable>
    );
}

const styles = StyleSheet.create({
    // The mascot sits in the bottom corner of every tab; the last row scrolls clear of it.
    list: { paddingBottom: VEY_CLEARANCE },
    bar: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingBottom: 8 },
    chip: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 12, borderRadius: 10, backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1 },
    chipOn: { backgroundColor: colors.accent, borderColor: colors.accent },
    chipText: { color: colors.body, fontWeight: '600' },
    chipTextOn: { color: colors.accentInk },
    older: { alignItems: 'center', paddingVertical: 12 },
    screen: { flex: 1, backgroundColor: colors.background, padding: 16 },
    filesLink: { alignSelf: 'flex-start', paddingBottom: 8 },
    filesText: { color: colors.accent, fontSize: 16 },
    muted: { color: colors.muted },
    error: { color: colors.danger },
});
