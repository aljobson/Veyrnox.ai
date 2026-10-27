import { useCallback, useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { VideoView, useVideoPlayer } from 'expo-video';
import { themedStyles, useThemedStyles } from './ui';
import { ds } from '../theme';

export function InlineMedia({ url, label, audio = false }: { url: string; label: string; audio?: boolean }) {
    const styles = useThemedStyles(sheets);
    const started = useRef(false);
    const player = useVideoPlayer(url, instance => { instance.muted = true; instance.loop = false; });
    useEffect(() => {
        // No autoplay or decorative motion, including when Reduce Motion is enabled.
        const playing = player.addListener('playingChange', ({ isPlaying }) => {
            if (isPlaying && !started.current) { started.current = true; player.muted = false; }
        });
        const state = AppState.addEventListener('change', value => { if (value !== 'active') player.pause(); });
        return () => { playing.remove(); state.remove(); };
    }, [player]);
    useFocusEffect(useCallback(() => () => { player.pause(); }, [player]));
    return <VideoView player={player} nativeControls contentFit="contain" accessibilityLabel={label} style={[styles.media, audio && styles.audio]} />;
}
const sheets = themedStyles(p => ({
    media: { width: '100%', height: 260, backgroundColor: p.bgElevated1, borderRadius: ds.radius.md },
    audio: { height: 96 },
}));
