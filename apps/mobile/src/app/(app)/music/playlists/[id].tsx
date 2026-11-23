import { useAnnouncement } from '../../../../lib/useAnnouncement';
import { EmptyState } from '../../../../components/EmptyState';
import { Stack, useLocalSearchParams } from 'expo-router';
import { RefreshControl, View } from 'react-native';
import { Button, Text, themedStyles, useThemedStyles } from '../../../../components/ui';
import { MusicNotice } from '../../../../components/music/MusicNotice';
import { PlaylistPlayer } from '../../../../components/music/PlaylistPlayer';
import { usePlaylists } from '../../../../lib/music/usePlaylists';
import { playlistMessage } from '../../../../lib/music/playlistMessages';
import { addPlaylistSongs, removePlaylistSong, movePlaylistSong, playlistIds, playlistReplace } from '../../../../lib/music/playlistEdits';
import { plural, t } from '../../../../lib/i18n';
import { ds } from '../../../../theme';
import { SafeContentScrollView } from '../../../../components/SafeContentScrollView';
export default function PlaylistDetail() {
    const { id } = useLocalSearchParams<{ id: string }>(), { flow, state } = usePlaylists(id), s = useThemedStyles(sheets);
    const playlist = flow.selected(), pending = flow.attempts.snapshot();
    const disabled = state.busy || state.refreshing || !!pending || state.status !== 'on';
    const ids = playlist ? playlistIds(playlist) : [];
    useAnnouncement(state.notice ? playlistMessage(state.notice) : state.busy ? t('musicPlaylists.working') : state.status === 'on' ? t('music.loaded', { count: ids.length }) : null, { everywhere: true });
    return <SafeContentScrollView style={s.screen} contentContainerStyle={s.content} gutter={ds.space.gutter}
        refreshControl={<RefreshControl refreshing={state.refreshing} onRefresh={() => { if (!state.busy) void flow.load(); }} />}>
        <Stack.Screen options={{ title: playlist?.title ?? t('musicPlaylists.title') }} />
        {state.status === 'off' ? <><EmptyState title={t('music.off')} body={t('music.offBody')} /><Button variant="secondary" label={t('music.refresh')} onPress={() => void flow.load()} /></> : <>
            {state.status === 'loading' ? <Text>{t('music.loading')}</Text> : null}
            {state.error ? <MusicNotice message={playlistMessage(state.error)} retry={() => void flow.retry()} /> : null}
            {state.notice ? <Text accessibilityLiveRegion="polite">{playlistMessage(state.notice)}</Text> : null}
            {pending ? <><Text>{t('musicPlaylists.pending')}</Text><Button label={t('music.retry')} disabled={state.busy || state.refreshing} onPress={() => void flow.retry()} /></> : null}
            {state.busy ? <Text accessibilityLiveRegion="polite">{t('musicPlaylists.working')}</Text> : null}
            {state.status === 'on' && !playlist ? <EmptyState title={t('musicPlaylists.missing')} body={t('musicPlaylists.refreshBody')} /> : null}
            {playlist ? <>
                <Button label={t(playlist.pinned ? 'musicPlaylists.unpin' : 'musicPlaylists.pin')} disabled={disabled}
                    onPress={() => void flow.edit({ action: 'pin', expected_revision: playlist.revision, pinned: !playlist.pinned })} />
                <PlaylistPlayer playlist={playlist} />
                {!ids.length ? <Text>{t('musicPlaylists.noSongs')}</Text> : null}
                {playlist.songs.map((song, index) => <View key={song.id} style={s.song}>
                    <Text variant="bodyStrong">{song.title}</Text>
                    <View style={s.controls}>
                        <Button variant="secondary" label={t('musicPlaylists.up', { title: song.title })} disabled={disabled || index === 0}
                            onPress={() => void flow.edit(playlistReplace(playlist, movePlaylistSong(ids, song.id, -1)))} />
                        <Button variant="secondary" label={t('musicPlaylists.down', { title: song.title })} disabled={disabled || index === ids.length - 1}
                            onPress={() => void flow.edit(playlistReplace(playlist, movePlaylistSong(ids, song.id, 1)))} />
                        <Button variant="tertiary" label={t('musicPlaylists.remove', { title: song.title })} disabled={disabled}
                            onPress={() => void flow.edit(playlistReplace(playlist, removePlaylistSong(ids, song.id)))} />
                    </View>
                </View>)}
                {ids.length >= 100 ? <Text>{t('musicPlaylists.cap')}</Text> : null}
                <Button label={t('musicPlaylists.add')} disabled={disabled || ids.length >= 100} onPress={() => void flow.openPicker()} />
                {state.picker ? <View style={s.song}>
                    <Text variant="footnote">{t('musicPlaylists.pickerBody')}</Text>
                    {!state.picker.some(song => !ids.includes(song.id)) ? <Text>{t('musicPlaylists.pickerEmpty')}</Text> : null}
                    {state.picker.filter(song => !ids.includes(song.id)).map(song => <Button key={song.id} variant="secondary"
                        label={t('musicPlaylists.addNamed', { title: song.title })} disabled={disabled || ids.length >= 100}
                        onPress={() => void flow.edit(playlistReplace(playlist, addPlaylistSongs(ids, [song.id])))} />)}
                    <Button variant="tertiary" label={t('musicPlaylists.closePicker')} onPress={flow.closePicker} />
                </View> : null}
                <Button variant="secondary" label={t('musicPlaylists.checkUnavailable')} disabled={disabled} onPress={() => void flow.scan()} />
                {state.scan?.unavailable.length ? <Button variant="secondary" label={plural('musicPlaylists.removeUnavailable', state.scan.unavailable.length)}
                    disabled={disabled} onPress={() => void flow.removeUnavailable()} /> : null}
            </> : null}
        </>}
    </SafeContentScrollView>;
}
const sheets = themedStyles(p => ({ screen: { flex: 1, backgroundColor: p.bg }, content: { gap: ds.space.md },
    song: { gap: ds.space.sm }, controls: { flexDirection: 'row', flexWrap: 'wrap', gap: ds.space.sm } }));
