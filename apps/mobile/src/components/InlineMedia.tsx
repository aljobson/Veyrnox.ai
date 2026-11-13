import { rawText } from '../lib/i18n/translate';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { VideoView, useVideoPlayer } from 'expo-video';
import { themedStyles, useThemedStyles } from './ui';
import { ds } from '../theme';
import { CassetteReels } from './CassetteReels';

export function InlineMedia({ url, label, audio = false, onReady }: { url: string; label: string; audio?: boolean; onReady?: () => void }) {
    const styles = useThemedStyles(sheets);
    const started = useRef(false);
    const [playing, setPlaying] = useState(false);
    const player = useVideoPlayer(url, instance => { instance.muted = true; instance.loop = false; });
    useEffect(() => {
        if (player.status === 'readyToPlay') onReady?.();
        const ready = player.addListener('statusChange', ({ status }) => { if (status === 'readyToPlay') onReady?.(); });
        return () => ready.remove();
    }, [player, onReady]);
    useEffect(() => {
        // No autoplay or decorative motion, including when Reduce Motion is enabled.
        const playingListener = player.addListener('playingChange', ({ isPlaying }) => {
            setPlaying(isPlaying);
            if (isPlaying && !started.current) { started.current = true; player.muted = false; }
        });
        const state = AppState.addEventListener('change', value => { if (value !== 'active') player.pause(); });
        return () => { playingListener.remove(); state.remove(); };
    }, [player]);
    useFocusEffect(useCallback(() => () => { player.pause(); }, [player]));
    const view = <VideoView player={player} nativeControls contentFit="contain" accessibilityLabel={rawText(label)} style={[styles.media, audio && styles.audio]} />;
    return audio ? <View style={styles.deck}><CassetteReels playing={playing} />{view}</View> : view;
}
const sheets = themedStyles(p => ({
    media: { width: '100%', height: 260, backgroundColor: p.bgElevated1, borderRadius: ds.radius.md },
    audio: { height: 96 },
    deck: { gap: ds.space.md },
}));
