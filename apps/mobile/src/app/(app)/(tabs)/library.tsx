import { Image } from 'expo-image';
import { useVideoPlayer, type VideoThumbnail } from 'expo-video';
import { createAssetLinks, type AssetLink } from '../../../lib/libraryMedia';
import { posterFor, clearPosters } from '../../../lib/videoPoster';
import { applyStatus, inFlightIds, mergePage } from '../../../lib/libraryPoll';
import { Text, Button, Chip, themedStyles, useThemedStyles } from '../../../components/ui';
import { Stack, useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, AppState, FlatList, ScrollView, View } from 'react-native';
import { useAuth } from '../../../auth/AuthProvider';
import { LibraryItem } from '../../../components/LibraryItem';
import { StaleNote } from '../../../components/StaleNote';
import { appCache, getCacheUser, subscribeCacheUser } from '../../../lib/appCache';
import { POLICIES, type CacheMeta } from '../../../lib/cache';
import { observe } from '../../../lib/network';
import { KIND_FILTERS, STATE_FILTERS, expiryOf, canReuse, canSchedule, filterJobs, kindMap, readFavourites, toggled, writeFavourites, type KindFilter, type StateFilter, type View as LayoutView } from '../../../lib/libraryView';
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
    const [view, setView] = useState<LayoutView>('grid');
    const [favourites, setFavourites] = useState<string[]>([]);
    const [models, setModels] = useState<CatalogModel[]>([]);
    const kinds = useMemo(() => kindMap(models), [models]);
    const names = useMemo(() => new Map(models.map((m) => [m.id, m.name])), [models]);
    const shown = useMemo(() => filterJobs(jobs ?? [], { state: stateFilter, kind: kindFilter, favourites: favOnly ? favourites : null }, kinds), [jobs, stateFilter, kindFilter, favOnly, favourites, kinds]);

    const [focused, setFocused] = useState(false);
    const [active, setActive] = useState(AppState.currentState === 'active');
    const [unreachable, setUnreachable] = useState(false);
    const [olderFailed, setOlderFailed] = useState(false);
    const [media, setMedia] = useState<Record<string, { link: AssetLink; poster?: VideoThumbnail | null }>>({});
    const links = useMemo(() => createAssetLinks({ getAsset: mediaApi(api).getAsset }), [api]);
    const unresolved = useRef(new Map<string, number>());
    const [, wakePoll] = useState(0);
    const hasWork = inFlightIds(jobs ?? []).length > 0 || unresolved.current.size > 0;
    const failures = useRef(0);
    const version = useRef(0);
    const jobsRef = useRef(jobs); jobsRef.current = jobs;
    const player = useVideoPlayer(null, p => { p.muted = true; });
    const [playing, setPlaying] = useState<string | null>(null);
    const audioVersion = useRef(0);
    const pause = useCallback(() => { audioVersion.current++; player.pause(); setPlaying(null); }, [player]);
    useEffect(() => {
        const sub = AppState.addEventListener('change', value => { setActive(value === 'active'); if (value !== 'active') pause(); });
        return () => sub.remove();
    }, [pause]);
    useEffect(() => {
        const clear = () => { version.current++; links.clear(); clearPosters(); void Image.clearMemoryCache?.().catch(() => {}); unresolved.current.clear(); setMedia({}); setFavourites([]); setSaved(null); setJobs(null); setNext(null); setFocused(false); pause(); void player.replaceAsync(null).catch(() => {}); };
        const unsubscribe = subscribeCacheUser(clear);
        return () => { unsubscribe(); version.current++; links.clear(); clearPosters(); };
    }, [links, pause]);
    const resolveAsset = useCallback(async (id: string) => {
        const generation = version.current;
        const result = await links.request(id);
        if (generation !== version.current) return result;
        if (result.kind === 'cooldown') { unresolved.current.set(id, result.until); wakePoll(n => n + 1); }
        if (result.kind === 'file' || result.kind === 'held') {
            unresolved.current.delete(id);
            setMedia(m => ({ ...m, [id]: { link: result } }));
            setJobs(rows => rows?.map(j => j.job_id === id ? { ...j, ...(result.kind === 'held' ? { held: true } : { has_asset: true, asset_expires_at: result.expiresAt }) } : j) ?? null);
            if (result.kind === 'file' && result.mime.startsWith('video/')) {
                void posterFor(id, result.url).then(poster => { if (generation === version.current) setMedia(m => ({ ...m, [id]: { link: result, poster } })); });
            }
        }
        return result;
    }, [links]);
    const resolveRef = useRef(resolveAsset); resolveRef.current = resolveAsset;
    const onViewableItemsChanged = useRef(({ viewableItems }: { viewableItems: { item: Job }[] }) => {
        for (const { item } of viewableItems) {
            if (item.state === 'succeeded' && item.has_asset && !item.held && expiryOf(item).kind !== 'gone') void resolveRef.current(item.job_id);
        }
    }).current;
    useEffect(() => {
        if (!focused || !active || unreachable || !hasWork) return;
        let live = true, running = false;
        const generation = version.current;
        const current = () => live && generation === version.current;
        const timer = setInterval(() => void (async () => {
            if (running || !current()) return;
            running = true;
            const outcomes: boolean[] = [];
            try {
                await Promise.all(inFlightIds(jobsRef.current ?? []).map(async id => {
                    try {
                        const status = await mediaApi(api).getJob(id);
                        if (!current()) return;
                        outcomes.push(true);
                        setJobs(rows => applyStatus(rows ?? [], id, status));
                        if (status.state === 'succeeded') unresolved.current.set(id, 0);
                    } catch { if (current()) outcomes.push(false); }
                }));
                if (!current()) return;
                await Promise.all([...unresolved.current].filter(([, until]) => Date.now() >= until).map(async ([id]) => {
                    const result = await resolveAsset(id);
                    if (result.kind !== 'cooldown') outcomes.push(result.kind !== 'none');
                }));
                if (!current()) return;
                if (outcomes.some(Boolean)) failures.current = 0;
                else if (outcomes.length) failures.current++;
                if (failures.current >= 20) setUnreachable(true);
            } finally { running = false; }
        })(), 3000);
        return () => { live = false; clearInterval(timer); };
    }, [api, focused, active, unreachable, hasWork, resolveAsset]);
    async function toggleAudio(id: string) {
        const wasPlaying = playing === id;
        pause();
        if (wasPlaying) return;
        const ticket = audioVersion.current;
        const generation = version.current;
        const link = await links.request(id);
        if (link.kind !== 'file' || ticket !== audioVersion.current || generation !== version.current) return;
        try {
            await player.replaceAsync(link.url);
            if (ticket !== audioVersion.current || generation !== version.current) return;
            player.muted = false; player.play(); setPlaying(id);
        } catch { pause(); }
    }

    function star(jobId: string) {
        const nextList = toggled(favourites, jobId);
        setFavourites(nextList);
        void writeFavourites(appCache, getCacheUser(), nextList);
    }

    const load = useCallback(async () => {
        setFailed(false);
        const generation = version.current;
        try {
            // First page only is saved (labels are personal data: per user, wiped on sign-out). Older pages load live.
            const out = await appCache.swr({
                policy: POLICIES.library,
                userId: getCacheUser(),
                fetcher: () => observe(mediaApi(api).listJobs()),
                onData: (page) => {
                    if (generation !== version.current) return;
                    setJobs(rows => mergePage(rows ?? [], page.jobs));
                    setNext(page.next);
                },
            });
            if (generation === version.current) setSaved(out.meta);
        } catch {
            if (generation === version.current) setFailed(true);
        }
    }, [api]);

    useFocusEffect(
        useCallback(() => {
            setFocused(true);
            void load();
            const generation = version.current;
            void readFavourites(appCache, getCacheUser()).then(ids => { if (generation === version.current) setFavourites(ids); });
            // The model list only names and sorts what the server returned; a failed read leaves them unfiltered by type.
            fetchCatalogCached((list) => setModels(list)).catch(() => undefined);
            return () => { setFocused(false); pause(); };
        }, [load, pause]),
    );

    async function more() {
        if (!next || loadingMore.current) return;
        loadingMore.current = true;
        setOlderFailed(false);
        const generation = version.current;
        try {
            const page = await observe(mediaApi(api).listJobs(next));
            if (generation !== version.current) return;
            setJobs((j) => mergePage(j ?? [], page.jobs));
            setNext(page.next);
        } catch {
            if (generation === version.current) setOlderFailed(true);
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
            {unreachable ? <View><Text variant="body" tone="danger">{t('libraryCreate.unreachable')}</Text><Button label={t('recovery.retry')} onPress={() => { failures.current = 0; setUnreachable(false); }} /></View> : null}
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
                    onViewableItemsChanged={onViewableItemsChanged}
                    viewabilityConfig={{ itemVisiblePercentThreshold: 10 }}
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
                            <View>{olderFailed ? <Text variant="body" tone="danger">{t('libraryCreate.olderFailed')}</Text> : null}<Button variant="secondary" accessibilityRole="button" onPress={more} label={t(olderFailed ? 'recovery.retry' : 'library.older')} /></View>
                        ) : undefined
                    }
                    renderItem={({ item }) => {
                        const kind = kinds.get(item.model_id);
                        return <LibraryItem
                            job={item}
                            media={{ ...media[item.job_id], audio: { playing: playing === item.job_id, toggle: () => void toggleAudio(item.job_id) } }}
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
