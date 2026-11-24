import { MusicLinkShare } from '../../../../components/music/MusicLinkShare';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Button, ListRow, Text } from '../../../../components/ui';
import { PublicShell } from '../../../../components/music/PublicShell';
import { PublicBlocked } from '../../../../components/music/PublicBlocked';
import { PublicRailRow } from '../../../../components/music/PublicRailRow';
import { PublicSocial } from '../../../../components/music/PublicSocial';
import { PublicAttemptNotice } from '../../../../components/music/PublicAttemptNotice';
import { usePublicMusic } from '../../../../lib/music/usePublicMusic';
import { creatorName } from '../../../../lib/music/publicTypes';
import { t } from '../../../../lib/i18n';
export default function PublicCreatorScreen() {
    const params = useLocalSearchParams<{ handle: string }>(), handle = typeof params.handle === 'string' ? params.handle : '';
    const router = useRouter();
    const { api, flow, state } = usePublicMusic({ kind: 'creator', handle });
    const data = state.data && 'profile' in state.data ? state.data : null;
    const blocked = state.data && 'blocked' in state.data ? state.data.blocked : null;
    return <PublicShell title={data ? creatorName(data.profile) : t('musicPublic.creator')} {...state} refresh={() => void flow.load()}>
        {blocked ? <PublicBlocked blocked={blocked} busy={state.busy} unblock={() => void flow.block(blocked.creator_id, false)} /> : null}
        {data ? <>
            <Text>{`@${data.profile.handle}`}</Text>
            <MusicLinkShare handle={handle} />
            <PublicSocial counts={data.social} social={state.social} handle={handle} flow={flow} busy={state.busy} />
            {state.social && !state.social.is_own ? <Button variant="tertiary" label={t('musicPublic.blockNamed', { name: creatorName(data.profile) })}
                disabled={state.busy} onPress={() => void flow.block(data.profile.creator_id, true, creatorName(data.profile))} /> : null}
            <PublicAttemptNotice flow={flow} state={state} />
            {data.albums?.map(album => <ListRow key={album.slug} title={album.title} subtitle={t('musicAlbums.publicSummary', { count: album.tracks.length })}
                accessibilityLabel={album.title} onPress={() => router.push({ pathname: '/music/album/[slug]', params: { slug: album.slug } } as never)} />)}
            {!data.tracks.length ? <Text>{t('musicPublic.empty')}</Text> : null}
            {data.tracks.map(track => <PublicRailRow key={track.slug} track={{ ...track, ...data.profile }} api={api} flow={flow} busy={state.busy} />)}
        </> : null}
    </PublicShell>;
}
