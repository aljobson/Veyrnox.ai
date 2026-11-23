import { useSyncExternalStore } from 'react';
import { isTrackAddUnavailable, subscribeTrackAddAvailability } from '../../lib/music/trackAddAvailability';
import { isExportUnavailable, subscribeExportAvailability } from '../../lib/music/exportAvailability';
import { renderAvailability, subscribeRenderAvailability } from '../../lib/music/renderAvailability';
import { useRouter } from 'expo-router';
import { Button, Text } from '../ui';
import { t } from '../../lib/i18n';
import type { MusicSongDetail, MusicVersionCapabilities } from '../../lib/music/types';
const capability = (value: MusicVersionCapabilities | undefined, key: keyof MusicVersionCapabilities) => value?.[key] !== false;
export function MusicSongActions({ song }: { song: MusicSongDetail }) {
    const router = useRouter();
    const trackAddOff = useSyncExternalStore(subscribeTrackAddAvailability, isTrackAddUnavailable, isTrackAddUnavailable);
    const exportOff = useSyncExternalStore(subscribeExportAvailability, isExportUnavailable, isExportUnavailable);
    const render = useSyncExternalStore(subscribeRenderAvailability, renderAvailability, renderAvailability);
    if (song.lifecycle_status === 'trashed') return null;
    const capabilities = song.current_version?.capabilities;
    const formatEditsUnavailable = capabilities?.playback === true && (capabilities.render === false || capabilities.crop === false);
    return <>{render.editing && song.actions.includes('render') && capability(capabilities, 'render') ? <Button variant="secondary" icon="faders" label={t('musicRender.title')}
        onPress={() => router.push({ pathname: '/music/render', params: { id: song.id } } as never)} /> : null}{!exportOff && song.actions.includes('download_mp3') ? <Button variant="secondary" icon="arrowDown" label={t('musicExport.title')}
        onPress={() => router.push({ pathname: '/music/export', params: { id: song.id } } as never)} /> : null}{!trackAddOff && song.actions.includes('add_track') && capability(capabilities, 'track_add') ? <Button variant="secondary" icon="plus" label={t('musicTrackAdd.title')}
        onPress={() => router.push({ pathname: '/music/track-add', params: { id: song.id } } as never)} /> : null}{(['add_section', 'replace_section'] as const).filter(name => song.actions.includes(name)
            && capability(capabilities, name)).map(name =>
        <Button key={name} variant="secondary" icon={name === 'add_section' ? 'plus' : 'swap'} label={t(`musicSectionActions.${name}.title`)}
            onPress={() => router.push({ pathname: name === 'add_section' ? '/music/add-section' : '/music/replace-section', params: { id: song.id } } as never)} />)}{(['stems', 'crop'] as const).filter(name => song.actions.includes(name)
                && capability(capabilities, name)).map(name =>
        <Button key={name} variant="secondary" icon={name === 'stems' ? 'faders' : 'scissors'} label={t(`musicActions.${name}.title`)}
            onPress={() => router.push({ pathname: `/music/${name}`, params: { id: song.id } } as never)} />)}
        {song.actions.includes('target_stem') && capability(capabilities, 'target_stem') ? <Button variant="secondary" icon="crosshair" label={t('musicTargetStems.title')}
            onPress={() => router.push({ pathname: '/music/target-stems', params: { id: song.id } } as never)} /> : null}
        {(['extend', 'cover'] as const).filter(name => song.actions.includes(name) && capability(capabilities, name)).map(name =>
            <Button key={name} variant="secondary" icon={name === 'extend' ? 'arrowsHorizontal' : 'magicWand'} label={t(`musicGenerationActions.${name}.title`)}
                onPress={() => router.push({ pathname: `/music/${name}`, params: { id: song.id } } as never)} />)}
        {formatEditsUnavailable ? <Text variant="footnote" tone="secondary" accessibilityRole="note">
            {t('music.actions.editUnavailableForFormat')}
        </Text> : null}</>;
}
