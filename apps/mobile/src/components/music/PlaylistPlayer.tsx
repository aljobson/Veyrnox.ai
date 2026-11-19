import { useCallback, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { AppState, View } from 'react-native';
import { createAudioPlayer, setAudioModeAsync } from 'expo-audio';
import { useAuth } from '../../auth/AuthProvider';
import { subscribeCacheUser } from '../../lib/appCache';
import { mediaApi } from '../../lib/media';
import { recordListen } from '../../lib/music/client';
import { createMusicPlayer } from '../../lib/music/player';
import { createPlaylistPlayback, type PlaylistPlaybackState } from '../../lib/music/playlistPlayback';
import type { Playlist } from '../../lib/music/playlistTypes';
import { Button, Text, themedStyles, useThemedStyles } from '../ui';
import { ds } from '../../theme';
import { useAnnouncement } from '../../lib/useAnnouncement';
import { t } from '../../lib/i18n';
export function PlaylistPlayer({ playlist }: { playlist: Playlist }) {
    const s = useThemedStyles(sheets);
    const { api } = useAuth(), ref = useRef<ReturnType<typeof createPlaylistPlayback> | null>(null);
    const songs = useRef(playlist.songs);
    songs.current = playlist.songs;
    const membership = playlist.songs.map(song => song.id).join(',');
    const [state, setState] = useState<PlaylistPlaybackState | null>(null);
    useFocusEffect(useCallback(() => {
        const playback = createPlaylistPlayback({ api, songs: songs.current, getAppState: () => AppState.currentState,
            subscribeAppState: cb => { const sub = AppState.addEventListener('change', cb); return () => sub.remove(); },
            onState: setState,
            makePlayer: onState => createMusicPlayer({ getAsset: mediaApi(api).getAsset,
                factory: url => createAudioPlayer({ uri: url }, { updateInterval: 100 }), setAudioMode: setAudioModeAsync,
                recordListen: id => recordListen(api, id), onState,
                subscribeAppState: cb => { const sub = AppState.addEventListener('change', cb); return () => sub.remove(); },
            }),
        });
        ref.current = playback; setState(playback.snapshot());
        const off = subscribeCacheUser(() => { playback.dispose(); ref.current = null; setState(null); });
        return () => { off(); playback.dispose(); ref.current = null; };
    }, [api, playlist.id, membership]));
    useAnnouncement(state && state.index >= 0 ? t(`music.player.${state.player.state}`) : null, { everywhere: true });
    return <View style={s.player}>
        <Button label={t('musicPlaylists.playAll')} disabled={!playlist.songs.length} onPress={() => void ref.current?.start(0)} />
        {state && state.index >= 0 ? <>
            <Text accessibilityLiveRegion="polite">{t(`music.player.${state.player.state}`)}</Text>
            <Button variant="secondary" label={t(state.player.state === 'playing' ? 'music.pause' : 'music.play')}
                disabled={state.player.state === 'loading'}
                onPress={() => { if (state.player.state === 'playing') ref.current?.pause(); else void ref.current?.resume(); }} />
            <Button variant="secondary" label={t('musicPlaylists.previous')} onPress={() => void ref.current?.previous()} disabled={state.index <= 0} />
            <Button variant="secondary" label={t('musicPlaylists.next')} onPress={() => void ref.current?.next()} disabled={state.index >= playlist.songs.length - 1} />
        </> : null}
        {state?.refused ? <Text accessibilityRole="alert" accessibilityLiveRegion="polite">{t('musicPlaylists.startRefused')}</Text> : null}
        {state?.skipped.map(id => <Text key={id} accessibilityLiveRegion="polite">{t('musicPlaylists.skipped', { title: playlist.songs.find(s => s.id === id)?.title ?? '' })}</Text>)}
        <Text variant="footnote" tone="secondary">{t('music.foreground')}</Text>
    </View>;
}

const sheets = themedStyles(() => ({ player: { gap: ds.space.sm } }));
