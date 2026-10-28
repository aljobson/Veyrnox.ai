import { Text, Button, Chip, themedStyles, useThemedStyles } from '../../../components/ui';
import { Stack, useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, ScrollView, View } from 'react-native';
import { useAuth } from '../../../auth/AuthProvider';
import { LibraryItem } from '../../../components/LibraryItem';
import { StaleNote } from '../../../components/StaleNote';
import { appCache, getCacheUser } from '../../../lib/appCache';
import { POLICIES, type CacheMeta } from '../../../lib/cache';
import { observe } from '../../../lib/network';
import { KIND_FILTERS, STATE_FILTERS, canReuse, canSchedule, filterJobs, kindMap, readFavourites, toggled, writeFavourites, type KindFilter, type StateFilter, type View as LayoutView } from '../../../lib/libraryView';
import { fetchCatalogCached, mediaApi, type CatalogModel, type Job, type JobPage } from '../../../lib/media';
import { publishHref, askAboutHref } from '../../../lib/nextSteps';
import { creativeReuseHref } from '../../../lib/creativeReuse';
import { ds, LIST_END_PADDING } from '../../../theme';
import { t } from '../../../lib/i18n';

import { EmptyState } from '../../../components/EmptyState';

export default function Library() {
    const styles = useThemedStyles(sheets);
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
            <Text variant="title2" tone="primary" style={styles.heading} accessibilityRole="header">{t('label.Library')}</Text>
            <Button variant="secondary" accessibilityRole="button" accessibilityLabel={t('library.videoFilesLabel')} onPress={() => router.push('/library/files')} label={t('library.videoFiles')} />
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.barScroll} contentContainerStyle={styles.bar} accessibilityLabel={t('library.filter.type')}>
                {KIND_FILTERS.map((f) => (
                    <Chip key={f} label={t(`library.type.${f}`)} selected={kindFilter === f} onPress={() => setKindFilter(f)} />
                ))}
                <Chip label={t('library.type.favourites')} selected={favOnly} onPress={() => setFavOnly(!favOnly)} />
                {STATE_FILTERS.filter((f) => f !== 'all').map((f) => (
                    <Chip key={f} label={t(`library.state.${f}`)} selected={stateFilter === f} onPress={() => setStateFilter(stateFilter === f ? 'all' : f)} />
                ))}
                <Chip label={t(`library.view.${view === 'grid' ? 'list' : 'grid'}`)} selected={false} onPress={() => setView(view === 'grid' ? 'list' : 'grid')} />
            </ScrollView>
            {failed ? (
                <View>
                    <Text variant="body" tone="danger">{t('library.loadError')}</Text>
                    <Button variant="tertiary" accessibilityRole="button" accessibilityLabel={t('library.loadError')} onPress={load} label={t('recovery.retry')} />
                </View>
            ) : jobs === null ? (
                <ActivityIndicator color={styles.accentInk.color} />
            ) : (
                <FlatList
                    contentContainerStyle={styles.list}
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
                            <Text variant="body" tone="tertiary" style={styles.muted}>{next ? t('library.noMatchOlder') : t('library.noMatch')}</Text>
                        ) : (
                            <EmptyState title={t('empty.library.title')} body={t('library.empty')} actionLabel={t('empty.library.action')} href="/create" />
                        )
                    }
                    ListFooterComponent={
                        next ? (
                            <Button variant="secondary" accessibilityRole="button" onPress={more} label={t('library.older')} />
                        ) : undefined
                    }
                    renderItem={({ item }) => {
                        const kind = kinds.get(item.model_id);
                        return <LibraryItem
                            job={item}
                            name={item.label || names.get(item.model_id) || item.model_id}
                            kind={kind}
                            grid={view === 'grid'}
                            starred={favourites.includes(item.job_id)}
                            canSchedule={canSchedule(item, kinds)}
                            canAsk={kind === 'image' && item.state === 'succeeded' && item.has_asset}
                            onAsk={() => router.push(askAboutHref(item.job_id))}
                            canReuse={canReuse(item, kinds)}
                            onOpen={() => router.push({ pathname: '/job/[id]', params: { id: item.job_id } })}
                            onStar={() => star(item.job_id)}
                            onSchedule={() => router.push(publishHref(item.job_id))}
                            onReuse={() => { if (kind) router.push(creativeReuseHref(item.job_id, kind)); }}
                        />
                    }}
                />
            )}
        </View>
    );
}

const sheets = themedStyles((p) => ({
    accentInk: { color: p.accent },

    list: { paddingBottom: LIST_END_PADDING },
    barScroll: { flexGrow: 0, marginBottom: ds.space.sm },
    bar: { flexDirection: 'row', gap: ds.space.sm },
    screen: { flex: 1, backgroundColor: p.bg, padding: ds.space.lg },
    heading: { color: p.textPrimary, marginBottom: ds.space.xs },
    muted: { color: p.textTertiary },
}));
