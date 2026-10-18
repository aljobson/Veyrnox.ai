import { Link } from 'expo-router';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useEffect, useState } from 'react';
import { ActivityIndicator, AppState, Pressable, StyleSheet, Text, View } from 'react-native';
import { useAuth } from '../../auth/AuthProvider';
import { BLOCK_COPY, createPlaybackSession, type SessionState } from '../../lib/cinemaPlayback';
import { colors } from '../../theme';

// Plays one title. It mints a token when it mounts (the viewer pressed Play), never before.
export function CinemaPlayer({ contentId }: { readonly contentId: string }) {
    const { api } = useAuth();
    const [state, setState] = useState<SessionState>({ kind: 'loading' });
    const player = useVideoPlayer(null, (p) => {
        p.keepScreenOnWhilePlaying = true;
    });

    useEffect(() => {
        const session = createPlaybackSession({ api, player, onState: setState });
        const subs = [
            player.addListener('statusChange', ({ status }) => {
                if (status === 'error') session.fail();
            }),
            player.addListener('playingChange', ({ isPlaying }) => session.setPlaying(isPlaying)),
            AppState.addEventListener('change', (next) => session.setVisible(next === 'active')),
        ];
        const timer = setInterval(() => session.tick(), 1000);
        session.start(contentId);
        return () => {
            clearInterval(timer);
            subs.forEach((s) => s.remove());
            session.stop();
            player.pause();
        };
    }, [api, player, contentId]);

    return (
        <View style={styles.box}>
            <VideoView player={player} style={StyleSheet.absoluteFill} contentFit="contain" nativeControls={false} />
            <Pressable
                accessibilityLabel="Pause or resume"
                style={StyleSheet.absoluteFill}
                onPress={() => (player.playing ? player.pause() : player.play())}
            />
            {state.kind === 'loading' ? (
                <View style={styles.overlay} pointerEvents="none">
                    <ActivityIndicator color={colors.accent} />
                </View>
            ) : null}
            {state.kind === 'blocked' ? (
                <View style={styles.overlay}>
                    <Text style={styles.copy}>{BLOCK_COPY[state.reason]}</Text>
                    {state.reason === 'signin' ? (
                        <Link href="/sign-in" style={styles.link}>Sign in</Link>
                    ) : null}
                </View>
            ) : null}
        </View>
    );
}

const styles = StyleSheet.create({
    box: { flex: 1, backgroundColor: '#000' },
    overlay: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 12, backgroundColor: 'rgba(0,0,0,0.7)' },
    copy: { color: colors.text, fontSize: 16, textAlign: 'center' },
    link: { color: colors.accent, fontSize: 16, fontWeight: '600' },
});
