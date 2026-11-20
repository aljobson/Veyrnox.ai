import { useEffect, useState } from 'react';
import { useRouter } from 'expo-router';
import { View } from 'react-native';
import { Button, ListRow, useThemedStyles } from '../ui';
import type { RailTrack } from '../../lib/music/publicTypes';
import type { createPublicFlow } from '../../lib/music/publicFlow';
import type { ApiClient } from '../../lib/api';
import { getSocial } from '../../lib/music/publicClient';
import { t } from '../../lib/i18n';
import { publicSheets } from './PublicShell';
export function PublicRailRow({ track, api, flow, busy }: { track: RailTrack; api: ApiClient; flow: ReturnType<typeof createPublicFlow>; busy: boolean }) {
    const router = useRouter(), s = useThemedStyles(publicSheets);
    const [ownership, setOwnership] = useState<{ revision: number; slug: string; other: boolean } | null>(null);
    const revision = flow.session.snapshot().revision;
    const other = ownership?.revision === revision && ownership.slug === track.slug && ownership.other;
    useEffect(() => {
        let active = true;
        void getSocial(api, { slug: track.slug }).then(v => { if (active && revision === flow.session.snapshot().revision) setOwnership({ revision, slug: track.slug, other: !v.is_own }); }).catch(() => {});
        return () => { active = false; };
    }, [api, flow, track.slug, revision]);
    return <View style={s.group}>
        <ListRow title={track.title} subtitle={track.display_name} accessibilityLabel={t('music.openNamed', { title: track.title })}
            onPress={() => router.push({ pathname: '/music/track/[slug]', params: { slug: track.slug } } as never)} />
        {other ? <><Button variant="tertiary" label={t('musicPublic.blockNamed', { name: track.display_name })} disabled={busy}
            onPress={() => void flow.block(track.creator_id, true, track.display_name)} />
            <Button variant="tertiary" label={t('musicPublic.reportTrack')} onPress={() => router.push({ pathname: '/music/report-track', params: { slug: track.slug } } as never)} />
        </> : null}
    </View>;
}
