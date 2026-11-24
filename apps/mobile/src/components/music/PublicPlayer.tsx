import { useCallback, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { AppState, View } from 'react-native';
import { createAudioPlayer, setAudioModeAsync } from 'expo-audio';
import { useAuth } from '../../auth/AuthProvider';
import { config } from '../../lib/config';
import type { PublicSession } from '../../lib/music/publicSession';
import { createPublicPlayback } from '../../lib/music/publicPlayback';
import type { PlayerState } from '../../lib/music/player';
import { Button, Text, useThemedStyles } from '../ui';
import { plural, t } from '../../lib/i18n';
import { publicSheets } from './PublicShell';
import { claimAudioFocus, releaseAudioFocus } from '../../lib/audioFocus';
export function PublicPlayer({ slug, creatorId, session, onPosition }: { slug: string; creatorId: string; session: PublicSession; onPosition(position: number): void }) {
    const { api } = useAuth(), s = useThemedStyles(publicSheets), ref = useRef<ReturnType<typeof createPublicPlayback> | null>(null);
    const plays = useRef({ off: false });
    const focusId = useRef(Symbol('public-music-player')).current;
    const [state, setState] = useState<PlayerState>({ state: 'idle', position: 0, duration: 0 });
    useFocusEffect(useCallback(() => {
        const controller = createPublicPlayback({ api, session, slug, creatorId, baseUrl: config.apiBase, plays: plays.current,
            getAppState: () => AppState.currentState,
            subscribeAppState: cb => { const sub = AppState.addEventListener('change', cb); return () => sub.remove(); },
            factory: url => createAudioPlayer({ uri: url }, { updateInterval: 100, downloadFirst: false }),
            setAudioMode: setAudioModeAsync, onState: value => { setState(value); onPosition(value.position); },
        });
        ref.current = controller; setState(controller.snapshot());
        return () => { releaseAudioFocus(focusId); controller.dispose(); ref.current = null; };
    }, [api, session, slug, creatorId, onPosition, focusId]));
    return <View style={s.group}>
        <Button label={t(state.state === 'playing' ? 'music.pause' : 'music.play')} disabled={state.state === 'loading'}
            onPress={() => { if (state.state === 'playing') { releaseAudioFocus(focusId); ref.current?.pause(); }
                else { claimAudioFocus(focusId, () => ref.current?.pause()); void ref.current?.start(); } }} />
        <Text accessibilityLiveRegion="polite">{t(`music.player.${state.state}`)}</Text>
        <Text>{plural('musicPublic.position', Math.floor(state.position))}</Text>
        <Text variant="footnote" tone="secondary">{t('music.foreground')}</Text>
    </View>;
}
