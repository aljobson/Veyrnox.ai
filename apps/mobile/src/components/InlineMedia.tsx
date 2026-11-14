import { rawText } from '../lib/i18n/translate';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Pressable, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { VideoView, useVideoPlayer, type VideoThumbnail } from 'expo-video';
import { Image } from 'expo-image';
import { Icon, themedStyles, useThemedStyles } from './ui';
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
    // A clip that fades in or out rests on a black frame before play and after the end, so a frame from
    // just inside it stands in at those two moments. Taken from this player: no second download.
    const [poster, setPoster] = useState<VideoThumbnail | null>(null);
    const [resting, setResting] = useState(true);
    useEffect(() => {
        if (audio) return;
        let live = true, asked = false;
        const take = () => {
            if (asked || player.status !== 'readyToPlay' || !(player.duration > 0)) return;
            asked = true;
            player.generateThumbnailsAsync([Math.min(POSTER_AT_S, player.duration / 2)], { maxWidth: 720, maxHeight: 720 })
                .then(frames => { if (live && frames[0]) setPoster(frames[0]); }).catch(() => undefined);
        };
        const status = player.addListener('statusChange', take);
        const ended = player.addListener('playToEnd', () => setResting(true));
        take();
        return () => { live = false; status.remove(); ended.remove(); };
    }, [player, audio]);
    useEffect(() => { if (playing) setResting(false); }, [playing]);
    useFocusEffect(useCallback(() => () => { player.pause(); }, [player]));
    const view = <VideoView player={player} nativeControls contentFit="contain" accessibilityLabel={rawText(label)} style={[styles.media, audio && styles.audio]} />;
    if (audio) return <View style={styles.deck}><CassetteReels playing={playing} />{view}</View>;
    return (
        <View>
            {view}
            {poster && resting && !playing ? (
                <Pressable testID="inline-media-poster" accessibilityRole="button" accessibilityLabel={rawText(label)} onPress={() => { if (player.currentTime >= player.duration - 0.05) player.currentTime = 0; player.play(); }} style={styles.poster}>
                    <Image source={poster} contentFit="contain" style={styles.fill} />
                    <View style={styles.play}><Icon name="play" /></View>
                </Pressable>
            ) : null}
        </View>
    );
}
const POSTER_AT_S = 0.5;
const sheets = themedStyles(p => ({
    poster: { position: 'absolute', top: 0, start: 0, end: 0, bottom: 0, borderRadius: ds.radius.md, overflow: 'hidden', backgroundColor: p.bgElevated1, alignItems: 'center', justifyContent: 'center' },
    fill: { position: 'absolute', top: 0, start: 0, end: 0, bottom: 0 },
    play: { width: 56, height: 56, borderRadius: 28, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center' },
    media: { width: '100%', height: 260, backgroundColor: p.bgElevated1, borderRadius: ds.radius.md },
    audio: { height: 96 },
    deck: { gap: ds.space.md },
}));
