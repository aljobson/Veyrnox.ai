import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'expo-router';
import { View } from 'react-native';
import { ListRow, Text, useThemedStyles } from '../../../components/ui';
import { PublicShell, publicSheets } from '../../../components/music/PublicShell';
import { PublicRailRow } from '../../../components/music/PublicRailRow';
import { usePublicMusic } from '../../../lib/music/usePublicMusic';
import { t } from '../../../lib/i18n';
import { discoverAlbums } from '../../../lib/music/albumsClient';
import type { PublicAlbum } from '../../../lib/music/albumTypes';
export default function Explore() {
    const { api, flow, state } = usePublicMusic({ kind: 'explore' }), router = useRouter(), s = useThemedStyles(publicSheets);
    const [albums, setAlbums] = useState<readonly PublicAlbum[]>([]);
    const loadAlbums = useCallback(() => discoverAlbums(api).then(setAlbums).catch(() => {}), [api]);
    useEffect(() => { let live = true; discoverAlbums(api).then(value => { if (live) setAlbums(value); }).catch(() => {}); return () => { live = false; }; }, [api]);
    const data = state.data && 'playlists' in state.data ? state.data : null;
    return <PublicShell title={t('musicPublic.explore')} {...state} goneMessage={t('musicPublic.exploreUnavailable')} refresh={() => { void flow.load(); void loadAlbums(); }}>
        {state.status === 'on' ? <>
            <ListRow title={t('musicPublic.blockedCreators')} accessibilityLabel={t('musicPublic.blockedCreators')} onPress={() => router.push('/music/blocked' as never)} />
            {albums.length ? <View style={s.group}><Text variant="title3">{t('musicAlbums.publicTitle')}</Text>{albums.map(album => <ListRow key={album.slug} title={album.title}
                subtitle={t('musicAlbums.by', { name: album.display_name || album.handle })} accessibilityLabel={album.title}
                onPress={() => router.push({ pathname: '/music/album/[slug]', params: { slug: album.slug } } as never)} />)}</View> : null}
            {!data?.playlists.some(p => p.tracks.length) ? <Text>{t('musicPublic.empty')}</Text> : null}
            {data?.playlists.filter(p => p.tracks.length).map(p => <View key={p.genre} style={s.group}>
                <Text variant="title3">{t(`musicPublic.genre.${p.genre}`)}</Text>
                {p.tracks.map(track => <PublicRailRow key={track.slug} track={track} api={api} flow={flow} busy={state.busy} />)}
            </View>)}
        </> : null}
    </PublicShell>;
}
