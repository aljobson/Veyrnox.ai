import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'expo-router';
import { View } from 'react-native';
import { ListRow, Text, useThemedStyles } from '../../../components/ui';
import { PublicShell, publicSheets } from '../../../components/music/PublicShell';
import { PublicRailRow } from '../../../components/music/PublicRailRow';
import { usePublicMusic } from '../../../lib/music/usePublicMusic';
import { t } from '../../../lib/i18n';
import { discoverAlbums } from '../../../lib/music/albumsClient';
import type { PublicAlbum } from '../../../lib/music/albumTypes';
import { getEntitlements } from '../../../lib/music/client';
import type { MusicDailyChallenge } from '../../../lib/music/types';
import { isCurrentMusicDailyChallenge } from '../../../lib/music/dailyChallenge';
export default function Explore() {
    const { api, flow, state } = usePublicMusic({ kind: 'explore' }), router = useRouter(), s = useThemedStyles(publicSheets);
    const [albums, setAlbums] = useState<readonly PublicAlbum[]>([]);
    const [challenge, setChallenge] = useState<MusicDailyChallenge | null>(null);
    const challengeRequest = useRef(0), mounted = useRef(true);
    const loadAlbums = useCallback(() => discoverAlbums(api).then(setAlbums).catch(() => {}), [api]);
    const loadChallenge = useCallback(async () => {
        const mine = ++challengeRequest.current;
        try {
            const value = await getEntitlements(api);
            if (!mounted.current || mine !== challengeRequest.current) return;
            const next = value.features.dailyChallenge ? value.daily_challenge : undefined;
            setChallenge(next && isCurrentMusicDailyChallenge(next) ? next : null);
        } catch {
            if (mounted.current && mine === challengeRequest.current) setChallenge(null);
        }
    }, [api]);
    useEffect(() => { let live = true; discoverAlbums(api).then(value => { if (live) setAlbums(value); }).catch(() => {}); return () => { live = false; }; }, [api]);
    useEffect(() => {
        mounted.current = true;
        const mine = ++challengeRequest.current;
        getEntitlements(api).then(value => {
            if (!mounted.current || mine !== challengeRequest.current) return;
            const next = value.features.dailyChallenge ? value.daily_challenge : undefined;
            setChallenge(next && isCurrentMusicDailyChallenge(next) ? next : null);
        }).catch(() => { if (mounted.current && mine === challengeRequest.current) setChallenge(null); });
        return () => { mounted.current = false; if (challengeRequest.current === mine) challengeRequest.current += 1; };
    }, [api]);
    const data = state.data && 'playlists' in state.data ? state.data : null;
    return <PublicShell title={t('musicPublic.explore')} {...state} goneMessage={t('musicPublic.exploreUnavailable')} refresh={() => { void flow.load(); void loadAlbums(); void loadChallenge(); }}>
        {state.status === 'on' ? <>
            <ListRow title={t('musicPublic.blockedCreators')} accessibilityLabel={t('musicPublic.blockedCreators')} onPress={() => router.push('/music/blocked' as never)} />
            {challenge ? <View style={s.group}><Text variant="title3">{t('music.dailyChallenge.eyebrow')}</Text>
                <ListRow title={t(challenge.title_key)} subtitle={`${t(challenge.prompt_key)} ${t('music.dailyChallenge.noReward')}`}
                    accessibilityLabel={`${t('music.dailyChallenge.cta')}: ${t(challenge.title_key)}`}
                    onPress={() => router.push({ pathname: '/music/create', params: { challenge: challenge.id } } as never)} />
            </View> : null}
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
