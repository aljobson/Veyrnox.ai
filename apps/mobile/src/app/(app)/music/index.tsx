import { subscribeSongChanges } from '../../../lib/music/songChanges';
import { Stack, useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';
import { useAuth } from '../../../auth/AuthProvider';
import { Button, ListRow, SegmentedControl, Text, TextField, themedStyles, useThemedStyles } from '../../../components/ui';
import { EmptyState } from '../../../components/EmptyState';
import { VeyLoader } from '../../../components/VeyLoader';
import { MusicNotice } from '../../../components/music/MusicNotice';
import { MusicPlayer } from '../../../components/music/MusicPlayer';
import { listSongs, getLibraryTab } from '../../../lib/music/client';
import { probeMusic, type MusicProbe } from '../../../lib/music/probe';
import { hookPlayback } from '../../../lib/music/player';
import type { MusicHook, MusicSongRow } from '../../../lib/music/types';
import { t } from '../../../lib/i18n';
import { useAnnouncement } from '../../../lib/useAnnouncement';
import { ds } from '../../../theme';

type Tab = 'songs' | 'history' | 'hooks';
type Rows = readonly MusicSongRow[] | readonly MusicHook[];
type Result = MusicProbe<Rows>;
export default function MusicLibrary() {
    const { api } = useAuth(); const router = useRouter(); const s = useThemedStyles(sheets);
    const [tab, setTab] = useState<Tab>('songs');
    const [results, setResults] = useState<Partial<Record<Tab, Result>>>({});
    const [previous, setPrevious] = useState<Partial<Record<Tab, Rows>>>({});
    const [searchOn, setSearchOn] = useState(false); const [query, setQuery] = useState('');
    const [applied, setApplied] = useState(''); const [searchRejected, setSearchRejected] = useState(false); const [loading, setLoading] = useState(false);
    const [droppedHooks, setDroppedHooks] = useState(0);
    const [hook, setHook] = useState<MusicHook | null>(null);
    const epoch = useRef(0);
    const load = useCallback(async () => {
        const ticket = ++epoch.current; setLoading(true);
        const readSongs = async () => {
            const result = await probeMusic(() => listSongs(api, { limit: 50, ...(applied ? { q: applied } : {}) }));
            const rejected = Boolean(applied && result.state === 'off' && result.code === 'music_library_unavailable');
            const songs = rejected ? await probeMusic(() => listSongs(api, { limit: 50 })) : result;
            return { songs, rejected };
        };
        const [{ songs, rejected }, history, hookResult] = await Promise.all([
            readSongs(),
            probeMusic(async () => { const v = await getLibraryTab(api, 'history'); return v.tab === 'history' ? v.songs : []; }),
            probeMusic(async () => { const v = await getLibraryTab(api, 'hooks'); return v.tab === 'hooks' ? v : { hooks: [], dropped: 0 }; }),
        ]);
        if (ticket !== epoch.current) return;
        const hooks: Result = hookResult.state === 'on' ? { state: 'on', data: hookResult.data.hooks } : hookResult;
        if (hookResult.state === 'on') setDroppedHooks(hookResult.data.dropped);
        else if (hookResult.state === 'off') setDroppedHooks(0);
        setResults({ songs, history, hooks }); setSearchRejected(rejected);
        if (rejected || songs.state === 'off') setSearchOn(false);
        else if (songs.state === 'on') setSearchOn(true);
        setPrevious(old => ({ ...old, ...Object.fromEntries(Object.entries({ songs, history, hooks }).map(([key, value]) =>
            [key, value.state === 'on' ? value.data : value.state === 'off' ? [] : old[key as Tab]])) }));
        setLoading(false);
    }, [api, applied]);
    useFocusEffect(useCallback(() => { void load(); return () => { epoch.current++; setHook(null); }; }, [load]));
    useEffect(() => subscribeSongChanges(() => { void load(); }), [load]);
    const currentTab = tab !== 'songs' && results[tab]?.state === 'off' ? 'songs' : tab;
    const result = results[currentTab];
    const rows = result?.state === 'on' ? result.data : previous[currentTab] ?? [];
    const off = results.songs?.state === 'off';
    useAnnouncement(!loading && result?.state === 'on' ? t('music.loaded', { count: rows.length }) : null, { everywhere: true });
    const hooksPartial = currentTab === 'hooks' && droppedHooks > 0;
    const partial = !off && (hooksPartial || Object.values(results).some(r => r.state === 'error'));
    const open = (row: MusicSongRow) => router.push({ pathname: '/music/[id]', params: { id: row.id,
        ...(typeof row.revision === 'number' ? { revision: String(row.revision) } : {}) } } as never);
    return <ScrollView style={s.screen} contentContainerStyle={s.content}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={() => void load()} />}>
        <Stack.Screen options={{ title: t('music.title') }} />
        {results.songs?.state === 'on' ? <>
            <Button label={t('music.create.title')} onPress={() => router.push('/music/create' as never)} />
            <ListRow icon="pianoKeys" title={t('beat.title')} accessibilityLabel={t('beat.title')} onPress={() => router.push('/beats' as never)} />
            <ListRow icon="playlist" title={t('musicPlaylists.title')} accessibilityLabel={t('musicPlaylists.title')} onPress={() => router.push('/music/playlists' as never)} />
            <ListRow icon="usersThree" title={t('musicPublic.explore')} accessibilityLabel={t('musicPublic.explore')} onPress={() => router.push('/music/explore' as never)} />
            <ListRow icon="compass" title={t('musicDiscover.title')} accessibilityLabel={t('musicDiscover.title')} onPress={() => router.push('/music/discover' as never)} />
        </> : null}
        {off ? <EmptyState title={t('music.off')} body={t('music.offBody')} actionLabel={t('music.back')} href="/audio" /> : <>
            <SegmentedControl value={currentTab} onChange={value => { setTab(value); setHook(null); }}
                options={(['songs', 'history', 'hooks'] as const).filter(value => value === 'songs' || results[value]?.state === 'on' || (results[value]?.state === 'error' && previous[value] !== undefined))
                    .map(value => ({ value, label: t(`music.tab.${value}`) }))} />
            <Text variant="footnote" tone="secondary">{t('music.bounded')}</Text>
            {searchRejected ? <MusicNotice message={t('music.searchUnavailable', { query: applied })} /> : null}
            {searchOn && currentTab === 'songs' ? <View style={s.search}>
                <TextField label={t('music.search')} value={query} onChangeText={setQuery} maxLength={100} returnKeyType="search" onSubmitEditing={() => setApplied(query.trim())} />
                <Button variant="secondary" label={t('music.search')} onPress={() => setApplied(query.trim())} />
                {applied ? <Button variant="tertiary" label={t('music.clear')} onPress={() => { setQuery(''); setApplied(''); }} /> : null}
            </View> : null}
            {loading && !result ? <VeyLoader label={t('music.loading')} showLabel /> : null}
            {result?.state === 'error' ? <MusicNotice message={t(result.status === 0 ? 'music.offline' : 'music.loadError')} retry={() => void load()} /> :
                partial ? <MusicNotice message={t('music.partial')} retry={() => void load()} /> : null}
            {!loading && result?.state === 'on' && rows.length === 0 && !hooksPartial ? <View>
                <EmptyState title={t('music.empty')} body={applied && !searchRejected ? t('music.noResults', { query: applied }) : t(`music.empty.${currentTab}`)} />
                {!applied || searchRejected ? <Button variant="secondary" label={t('music.refresh')} onPress={() => void load()} /> : null}
            </View> : null}
            {currentTab === 'hooks' ? (rows as readonly MusicHook[]).map(row => <View key={row.id} style={s.search}>
                <ListRow title={row.title} subtitle={row.song_title} accessibilityLabel={t('music.playNamed', { title: row.title })}
                    onPress={() => setHook(row)} />
                {hook?.id === row.id ? <MusicPlayer key={row.id} input={hookPlayback(row)} /> : null}
            </View>) : (rows as readonly MusicSongRow[]).map(row => <ListRow key={row.id} title={row.title}
                subtitle={row.workspace_name} accessibilityLabel={t('music.openNamed', { title: row.title })} onPress={() => open(row)} />)}
        </>}
    </ScrollView>;
}
const sheets = themedStyles(p => ({ screen: { flex: 1, backgroundColor: p.bg }, content: { padding: ds.space.lg, gap: ds.space.lg }, search: { gap: ds.space.sm } }));
