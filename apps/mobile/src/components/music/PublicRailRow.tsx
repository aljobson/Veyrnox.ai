import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'expo-router';
import { View } from 'react-native';
import { Button, ListRow, Text, useThemedStyles } from '../ui';
import { creatorName, type RailTrack } from '../../lib/music/publicTypes';
import type { createPublicFlow } from '../../lib/music/publicFlow';
import type { ApiClient } from '../../lib/api';
import { getSocial } from '../../lib/music/publicClient';
import { t } from '../../lib/i18n';
import { publicSheets } from './PublicShell';
export function PublicRailRow({ track, api, flow, busy }: { track: RailTrack; api: ApiClient; flow: ReturnType<typeof createPublicFlow>; busy: boolean }) {
    const router = useRouter(), s = useThemedStyles(publicSheets), mounted = useRef(false);
    const [menu, setMenu] = useState<{ account: number; creator: string; other: boolean | null; loading: boolean } | null>(null);
    const account = flow.session.snapshot().account, name = creatorName(track);
    const open = menu?.account === account && menu.creator === track.creator_id;
    useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
    async function actions() {
        if (open) { setMenu(null); return; }
        setMenu({ account, creator: track.creator_id, other: null, loading: true });
        const other = await flow.session.ownership(track.creator_id, async () => !(await getSocial(api, { slug: track.slug })).is_own);
        if (mounted.current && account === flow.session.snapshot().account) {
            setMenu(current => current?.creator === track.creator_id ? { ...current, other, loading: false } : current);
        }
    }
    return <View style={s.group}>
        <ListRow title={track.title} subtitle={name} accessibilityLabel={t('music.openNamed', { title: track.title })}
            onPress={() => router.push({ pathname: '/music/track/[slug]', params: { slug: track.slug } } as never)} />
        <Button variant="tertiary" label={t('musicPublic.actions', { title: track.title })} accessibilityState={{ expanded: open }} onPress={() => void actions()} />
        {open && menu.loading ? <Text accessibilityLiveRegion="polite">{t('music.loading')}</Text> : null}
        {open && !menu.loading && menu.other === null ? <Text>{t('musicPublic.socialUnavailable')}</Text> : null}
        {open && menu.other ? <><Button variant="tertiary" label={t('musicPublic.blockNamed', { name })} disabled={busy}
            onPress={() => void flow.block(track.creator_id, true, name)} />
            <Button variant="tertiary" label={t('musicPublic.reportTrack')} onPress={() => router.push({ pathname: '/music/report-track', params: { slug: track.slug } } as never)} />
        </> : null}
    </View>;
}
