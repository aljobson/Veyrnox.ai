import { useSyncExternalStore } from 'react';
import { isTrackAddUnavailable, subscribeTrackAddAvailability } from '../../lib/music/trackAddAvailability';
import { useRouter } from 'expo-router';
import { Button } from '../ui';
import { t } from '../../lib/i18n';
import type { MusicSongDetail } from '../../lib/music/types';
export function MusicSongActions({ song }: { song: MusicSongDetail }) {
    const router = useRouter();
    const trackAddOff = useSyncExternalStore(subscribeTrackAddAvailability, isTrackAddUnavailable, isTrackAddUnavailable);
    if (song.lifecycle_status === 'trashed') return null;
    return <>{!trackAddOff && song.actions.includes('add_track') ? <Button variant="secondary" icon="plus" label={t('musicTrackAdd.title')}
        onPress={() => router.push({ pathname: '/music/track-add', params: { id: song.id } } as never)} /> : null}{(['add_section', 'replace_section'] as const).filter(name => song.actions.includes(name)).map(name =>
        <Button key={name} variant="secondary" icon={name === 'add_section' ? 'plus' : 'swap'} label={t(`musicSectionActions.${name}.title`)}
            onPress={() => router.push({ pathname: name === 'add_section' ? '/music/add-section' : '/music/replace-section', params: { id: song.id } } as never)} />)}{(['stems', 'crop'] as const).filter(name => song.actions.includes(name)).map(name =>
        <Button key={name} variant="secondary" icon={name === 'stems' ? 'faders' : 'scissors'} label={t(`musicActions.${name}.title`)}
            onPress={() => router.push({ pathname: `/music/${name}`, params: { id: song.id } } as never)} />)}
        {song.actions.includes('target_stem') ? <Button variant="secondary" icon="crosshair" label={t('musicTargetStems.title')}
            onPress={() => router.push({ pathname: '/music/target-stems', params: { id: song.id } } as never)} /> : null}
        {(['extend', 'cover'] as const).filter(name => song.actions.includes(name)).map(name =>
            <Button key={name} variant="secondary" icon={name === 'extend' ? 'arrowsHorizontal' : 'magicWand'} label={t(`musicGenerationActions.${name}.title`)}
                onPress={() => router.push({ pathname: `/music/${name}`, params: { id: song.id } } as never)} />)}</>;
}
