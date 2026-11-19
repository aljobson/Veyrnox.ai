import { useRouter } from 'expo-router';
import { Button } from '../ui';
import { t } from '../../lib/i18n';
import type { MusicSongDetail } from '../../lib/music/types';
export function MusicSongActions({ song }: { song: MusicSongDetail }) {
    const router = useRouter();
    if (song.lifecycle_status === 'trashed') return null;
    return <>{(['stems', 'crop'] as const).filter(name => song.actions.includes(name)).map(name =>
        <Button key={name} variant="secondary" label={t(`musicActions.${name}.title`)}
            onPress={() => router.push({ pathname: `/music/${name}`, params: { id: song.id } } as never)} />)}
        {song.actions.includes('target_stem') ? <Button variant="secondary" label={t('musicTargetStems.title')}
            onPress={() => router.push({ pathname: '/music/target-stems', params: { id: song.id } } as never)} /> : null}</>;
}
