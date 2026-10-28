import { t } from '../../lib/i18n';
import { Link, useFocusEffect } from 'expo-router';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Pressable, StyleSheet, Text, View } from 'react-native';
import { useAuth } from '../../auth/AuthProvider';
import { BLOCK_COPY, createPlaybackSession, type BlockReason, type PlaybackSession, type SessionState } from '../../lib/cinemaPlayback';
import { getCinemaProgress } from '../../lib/cinemaProgress';

// Plays one title. It mints a token when it mounts (the viewer pressed Play), never before.
export function CinemaPlayer({ contentId, resumePosition = 0, onBlocked }: { readonly contentId: string; readonly resumePosition?: number; readonly onBlocked?: (reason: BlockReason) => void }) {
    const { api, getAccessToken } = useAuth();
    const [state, setState] = useState<SessionState>({ kind: 'loading' });
    const focused = useRef(true);
    const blockedCallback = useRef(onBlocked);
    blockedCallback.current = onBlocked;
    const playback = useRef<PlaybackSession | null>(null);
    const player = useVideoPlayer(null, (p) => {
        p.keepScreenOnWhilePlaying = true;
    });

    useEffect(() => {
        const progress = getCinemaProgress(api, getAccessToken);
        const saveProgress = progress.recorder(contentId);
        const session = createPlaybackSession({ api, player, onState: next => { setState(next); if (next.kind === 'blocked') blockedCallback.current?.(next.reason); }, saveProgress });
        playback.current = session;
        const subs = [
            player.addListener('statusChange', ({ status }) => {
                if (status === 'error') session.fail();
            }),
            player.addListener('playingChange', ({ isPlaying }) => session.setPlaying(isPlaying)),
            AppState.addEventListener('change', (next) => session.setVisible(next === 'active' && focused.current)),
        ];
        const timer = setInterval(() => session.tick(), 1000);
        session.start(contentId, resumePosition);
        session.setVisible(AppState.currentState === 'active' && focused.current);
        return () => {
            clearInterval(timer);
            subs.forEach((s) => s.remove());
            session.stop();
            playback.current = null;
            player.pause();
        };
    }, [api, getAccessToken, player, contentId, resumePosition]);

    // Comments can cover a mounted Watch: suspend metering and playback, keeping the grant.
    useFocusEffect(useCallback(() => {
        focused.current = true;
        playback.current?.setVisible(AppState.currentState === 'active');
        return () => {
            focused.current = false;
            playback.current?.saveFinalProgress();
            playback.current?.setVisible(false);
        };
    }, []));

    return (
        <View style={styles.box}>
            <VideoView player={player} style={StyleSheet.absoluteFill} contentFit="contain" nativeControls={false} />
            <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('cinema.pauseorresume')}
                style={StyleSheet.absoluteFill}
                onPress={() => (player.playing ? player.pause() : player.play())}
            />
            {state.kind === 'loading' ? (
                <View style={styles.overlay} pointerEvents="none">
                    <ActivityIndicator color={ON_VIDEO_ACCENT} />
                </View>
            ) : null}
            {state.kind === 'blocked' ? (
                <View style={styles.overlay}>
                    <Text style={styles.copy}>{BLOCK_COPY[state.reason]}</Text>
                    {state.reason === 'signin' ? (
                        <Link href="/sign-in" style={styles.link}>{t('cinema.signin')}</Link>
                    ) : null}
                </View>
            ) : null}
        </View>
    );
}

// The player is always black, so its text keeps the dark theme's colours in Light mode too.
const ON_VIDEO = '#f2f2f3';
const ON_VIDEO_ACCENT = '#3ee6c4';

const styles = StyleSheet.create({
    box: { flex: 1, backgroundColor: '#000' },
    overlay: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 12, backgroundColor: 'rgba(0,0,0,0.7)' },
    copy: { color: ON_VIDEO, fontSize: 16, textAlign: 'center' },
    link: { color: ON_VIDEO_ACCENT, fontSize: 16, fontWeight: '600' },
});
