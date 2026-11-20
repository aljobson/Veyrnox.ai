import { useState } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { View } from 'react-native';
import { Button, ListRow, Text, useThemedStyles } from '../../../../components/ui';
import { PublicShell, publicSheets } from '../../../../components/music/PublicShell';
import { PublicBlocked } from '../../../../components/music/PublicBlocked';
import { PublicRailRow } from '../../../../components/music/PublicRailRow';
import { PublicSocial } from '../../../../components/music/PublicSocial';
import { PublicComments } from '../../../../components/music/PublicComments';
import { PublicPlayer } from '../../../../components/music/PublicPlayer';
import { PublicAttemptNotice } from '../../../../components/music/PublicAttemptNotice';
import { usePublicMusic } from '../../../../lib/music/usePublicMusic';
import { creatorName } from '../../../../lib/music/publicTypes';
import { t } from '../../../../lib/i18n';
export default function PublicTrackScreen() {
    const params = useLocalSearchParams<{ slug: string }>(), slug = typeof params.slug === 'string' ? params.slug : '';
    const { api, flow, state, session } = usePublicMusic({ kind: 'track', slug });
    const router = useRouter(), s = useThemedStyles(publicSheets), [position, setPosition] = useState(0);
    const data = state.data && 'track' in state.data ? state.data : null;
    const blocked = state.data && 'blocked' in state.data ? state.data.blocked : null;
    return <PublicShell title={data?.track.title ?? t('musicPublic.track')} {...state} refresh={() => void flow.load()}>
        {blocked ? <PublicBlocked blocked={blocked} busy={state.busy} unblock={() => void flow.block(blocked.creator_id, false)} /> : null}
        {data ? <>
            <ListRow title={creatorName(data.track)} subtitle={`@${data.track.handle}`} accessibilityLabel={creatorName(data.track)}
                onPress={() => router.push({ pathname: '/music/creator/[handle]', params: { handle: data.track.handle } } as never)} />
            <PublicPlayer key={`player:${slug}:${session.snapshot().account}`} slug={slug} creatorId={data.track.creator_id} session={session} onPosition={setPosition} />
            {data.plays ? <Text>{t('musicPublic.plays', { count: data.plays.count })}</Text> : null}
            {data.lyrics ? <View style={s.group}><Text variant="title3">{t('musicPublic.lyrics')}</Text><Text>{data.lyrics}</Text></View> : null}
            <PublicSocial counts={data.social} social={state.social} slug={slug} handle={data.track.handle} flow={flow} busy={state.busy} />
            {state.social && !state.social.is_own ? <>
                {data.reports ? <Button variant="secondary" label={t('musicPublic.reportTrack')} onPress={() => router.push({ pathname: '/music/report-track', params: { slug } } as never)} /> : null}
                <Button variant="tertiary" label={t('musicPublic.blockNamed', { name: creatorName(data.track) })} disabled={state.busy}
                    onPress={() => void flow.block(data.track.creator_id, true, creatorName(data.track))} />
            </> : null}
            <PublicAttemptNotice flow={flow} state={state} />
            {data.comments ? <PublicComments key={`comments:${slug}:${session.snapshot().account}`} comments={data.comments} flow={flow} state={state} slug={slug} position={position} /> : null}
            {data.rails ? <>
                {(['by_creator', 'similar'] as const).map(kind => data.rails![kind].length ? <View key={kind} style={s.group}>
                    <Text variant="title3">{t(kind === 'by_creator' ? 'musicPublic.moreCreator' : 'musicPublic.similar')}</Text>
                    {data.rails![kind].map(track => <PublicRailRow key={track.slug} track={track} api={api} flow={flow} busy={state.busy} />)}
                </View> : null)}
            </> : null}
        </> : null}
    </PublicShell>;
}
