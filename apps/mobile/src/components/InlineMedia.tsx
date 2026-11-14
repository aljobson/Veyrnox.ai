import { rawText } from '../lib/i18n/translate';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Pressable, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { VideoView, useVideoPlayer, type VideoPlayer, type VideoThumbnail } from 'expo-video';
import { Image } from 'expo-image';
import { Icon, Text, themedStyles, useThemedStyles } from './ui';
import { ds } from '../theme';
import { t, tAccessibility } from '../lib/i18n';
import { MIN_TARGET } from '../lib/a11y';
import { CassetteReels } from './CassetteReels';

export function InlineMedia({ url, label, audio = false, onReady }: { url: string; label: string; audio?: boolean; onReady?: () => void }) {
    const styles = useThemedStyles(sheets);
    const started = useRef(false);
    const [playing, setPlaying] = useState(false);
    const player = useVideoPlayer(url, instance => { instance.muted = true; instance.loop = false; if (audio) instance.timeUpdateEventInterval = 0.5; });
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
    // iOS 26 draws nothing for native controls on an audio-only item, so audio gets its own controls
    // on the same player. The view stays mounted (out of sight) so playback is unchanged.
    if (audio) return (
        <View style={styles.deck}>
            <CassetteReels playing={playing} />
            <VideoView player={player} nativeControls={false} style={styles.hidden} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" pointerEvents="none" />
            <AudioControls player={player} playing={playing} label={label} />
        </View>
    );
    const view = <VideoView player={player} nativeControls contentFit="contain" accessibilityLabel={rawText(label)} style={styles.media} />;
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
const SKIP_S = 10;
const clock = (seconds: number) => {
    const whole = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
    return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
};
function AudioControls({ player, playing, label }: { player: VideoPlayer; playing: boolean; label: string }) {
    const styles = useThemedStyles(sheets);
    const [position, setPosition] = useState(0);
    const [duration, setDuration] = useState(0);
    const [width, setWidth] = useState(0);
    useEffect(() => {
        const time = player.addListener('timeUpdate', ({ currentTime }) => { setPosition(currentTime); setDuration(player.duration); });
        const loaded = player.addListener('sourceLoad', ({ duration: length }) => setDuration(length));
        const ended = player.addListener('playToEnd', () => setPosition(player.duration));
        return () => { time.remove(); loaded.remove(); ended.remove(); };
    }, [player]);
    const seek = (to: number) => {
        const next = Math.min(Math.max(0, to), duration > 0 ? duration : 0);
        player.currentTime = next;
        setPosition(next);
    };
    const toggle = () => {
        if (playing) { player.pause(); return; }
        if (duration > 0 && player.currentTime >= duration - 0.05) seek(0);
        player.play();
    };
    const share = duration > 0 ? Math.min(1, position / duration) : 0;
    const where = tAccessibility('cinema.position', { position: clock(position), duration: clock(duration) });
    return (
        <View style={styles.controls}>
            <Pressable testID="inline-audio-toggle" accessibilityRole="button" accessibilityLabel={t(playing ? 'editor.pause' : 'editor.play')} accessibilityHint={rawText(label)}
                accessibilityState={{ selected: playing }} onPress={toggle} style={styles.toggle}>
                {playing ? <View style={styles.pauseGlyph}><View style={styles.pauseBar} /><View style={styles.pauseBar} /></View> : <Icon name="play" />}
            </Pressable>
            <View style={styles.timeline}>
                <Pressable testID="inline-audio-position" accessibilityRole="adjustable" accessibilityLabel={rawText(label)} accessibilityValue={{ text: where }}
                    accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
                    onAccessibilityAction={({ nativeEvent }) => seek(position + (nativeEvent.actionName === 'increment' ? SKIP_S : -SKIP_S))}
                    onLayout={({ nativeEvent }) => setWidth(nativeEvent.layout.width)}
                    onPress={({ nativeEvent }) => { if (width > 0 && duration > 0) seek((nativeEvent.locationX / width) * duration); }}
                    style={styles.track}>
                    <View style={styles.rail}><View style={[styles.fillBar, { width: `${share * 100}%` }]} /></View>
                </Pressable>
                <Text variant="caption" tone="secondary" accessibilityElementsHidden importantForAccessibility="no">{clock(position)} / {clock(duration)}</Text>
            </View>
        </View>
    );
}
const sheets = themedStyles(p => ({
    poster: { position: 'absolute', top: 0, start: 0, end: 0, bottom: 0, borderRadius: ds.radius.md, overflow: 'hidden', backgroundColor: p.bgElevated1, alignItems: 'center', justifyContent: 'center' },
    fill: { position: 'absolute', top: 0, start: 0, end: 0, bottom: 0 },
    play: { width: 56, height: 56, borderRadius: 28, backgroundColor: p.bgElevated1, alignItems: 'center', justifyContent: 'center' },
    media: { width: '100%', height: 260, backgroundColor: p.bgElevated1, borderRadius: ds.radius.md },
    hidden: { position: 'absolute', width: 1, height: 1, opacity: 0 },
    controls: { flexDirection: 'row', alignItems: 'center', gap: ds.space.md, padding: ds.space.md, borderRadius: ds.radius.md, backgroundColor: p.bgElevated1 },
    toggle: { width: 56, height: 56, borderRadius: ds.radius.pill, alignItems: 'center', justifyContent: 'center', backgroundColor: p.bgElevated2, borderWidth: 1, borderColor: p.borderStrong },
    pauseGlyph: { flexDirection: 'row', gap: ds.space.xs },
    pauseBar: { width: 4, height: 16, borderRadius: ds.radius.pill, backgroundColor: p.textSecondary },
    timeline: { flex: 1, gap: ds.space.xs },
    track: { minHeight: MIN_TARGET, justifyContent: 'center' },
    rail: { height: 4, borderRadius: ds.radius.pill, backgroundColor: p.borderSubtle, overflow: 'hidden' },
    fillBar: { height: 4, backgroundColor: p.accent },
    deck: { gap: ds.space.md },
}));
