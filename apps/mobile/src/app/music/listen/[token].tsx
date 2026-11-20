import { useCallback, useRef, useState } from 'react';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { AppState, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { createAudioPlayer, setAudioModeAsync } from 'expo-audio';
import { Button, Text, themedStyles, useThemedStyles } from '../../../components/ui';
import { getSharedSong } from '../../../lib/music/sharedListenClient';
import { createListenPlayback } from '../../../lib/music/listenPlayback';
import type { SharedSong } from '../../../lib/music/validateShared';
import type { PlayerState } from '../../../lib/music/player';
import { subscribeCacheUser } from '../../../lib/appCache';
import { ApiError } from '../../../lib/api';
import { config } from '../../../lib/config';
import { t } from '../../../lib/i18n';
import { ds } from '../../../theme';
// Outside (app): a bearer link needs no identity or sign-in, including on a fresh install.
export default function ListenScreen() {
    const params = useLocalSearchParams<{ token: string }>(), token = typeof params.token === 'string' ? params.token : '';
    const router = useRouter();
    const s = useThemedStyles(sheets), insets = useSafeAreaInsets();
    const [song, setSong] = useState<SharedSong | null>(null), [error, setError] = useState<'gone' | 'error' | null>(null);
    const [round, setRound] = useState(0), [state, setState] = useState<PlayerState>({ state: 'idle', position: 0, duration: 0 });
    const ref = useRef<ReturnType<typeof createListenPlayback> | null>(null);
    useFocusEffect(useCallback(() => {
        let live = true;
        const request = new AbortController(); setSong(null); setError(null);
        const player = createListenPlayback({ token, baseUrl: config.apiBase,
            getAppState: () => AppState.currentState,
            subscribeAppState: cb => { const sub = AppState.addEventListener('change', cb); return () => sub.remove(); },
            subscribeAccount: subscribeCacheUser,
            factory: url => createAudioPlayer({ uri: url }, { updateInterval: 100, downloadFirst: false }),
            setAudioMode: setAudioModeAsync, onState: value => { if (live) setState(value); },
        });
        ref.current = player; setState(player.snapshot());
        void getSharedSong(token, request.signal).then(value => { if (live) setSong(value); }, e => {
            if (live) setError(e instanceof ApiError && e.code === 'not_found' ? 'gone' : 'error');
        });
        const off = subscribeCacheUser(() => { live = false; request.abort(); player.dispose(); setSong(null); setRound(n => n + 1); });
        return () => { live = false; request.abort(); player.dispose(); off(); ref.current = null; };
    }, [token, round]));
    return <ScrollView style={s.screen} contentContainerStyle={[s.content, { paddingTop: insets.top + ds.space.lg, paddingBottom: insets.bottom + ds.space.lg }]}>
        <Button variant="tertiary" icon="close" label={t('common.close')} onPress={() => { ref.current?.pause(); router.replace('/'); }} />
        <Text variant="title1">{song?.title ?? t('musicPublication.listen')}</Text>
        {!song && !error ? <Text>{t('music.loading')}</Text> : null}
        {error ? <Text accessibilityRole="alert">{t(error === 'gone' ? 'musicPublication.linkGone' : 'music.loadError')}</Text> : null}
        {error === 'error' ? <Button label={t('music.retry')} onPress={() => setRound(n => n + 1)} /> : null}
        {song ? <>
            <Text>{t('music.version', { number: song.version_number })}</Text>
            <Button icon={state.state === 'playing' ? 'pauseCircle' : 'play'} label={t(state.state === 'playing' ? 'music.pause' : 'music.play')}
                disabled={state.state === 'loading'} onPress={() => { if (state.state === 'playing') ref.current?.pause(); else void ref.current?.start(); }} />
            <Text accessibilityLiveRegion="polite">{t(`music.player.${state.state}`)}</Text>
            <Text>{t('music.foreground')}</Text>
        </> : null}
    </ScrollView>;
}
const sheets = themedStyles(p => ({ screen: { flex: 1, backgroundColor: p.bg }, content: { padding: ds.space.lg, gap: ds.space.md } }));
