import { useEffect } from 'react';
import { Pressable, View } from 'react-native';
import { Image } from 'expo-image';
import { setAudioModeAsync, useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { Card, Icon, Text, themedStyles, useThemedStyles } from '../ui';
import { plural, t } from '../../lib/i18n';
import type { AudioTemplate } from '../../lib/audioTemplates';
import { categoryLabel } from '../../lib/presetCategoryLabel';

// An audio template is a row: a small square of the licensed track's artwork with a play button over it, then a badge
// that says it is a sound, its category, its name, the start of its prompt and its price. The play button plays the
// track's sample in place; the rest of the row opens the template. The screen keeps one sample playing at a time.
interface AudioTemplateCardProps {
    readonly template: AudioTemplate;
    readonly credits?: number;
    readonly playing?: boolean;
    onPlay?(): void;
    onOpen(): void;
}

export function AudioTemplateCard({ template, credits, playing = false, onPlay, onOpen }: AudioTemplateCardProps) {
    const styles = useThemedStyles(sheets);
    const price = typeof credits === 'number' && credits > 0 ? plural('library.cost', credits) : null;
    const sample = template.previewAudioUrl;
    const art = template.previewUrl ? <Image source={{ uri: template.previewUrl }} style={styles.art} contentFit="cover" accessible={false} accessibilityIgnoresInvertColors /> : <View style={styles.art} />;
    return <Card style={styles.card}>
        {sample && onPlay ? <Pressable onPress={onPlay} accessibilityRole="button" accessibilityLabel={`${t(playing ? 'music.pause' : 'music.play')}, ${template.name}`} accessibilityState={{ selected: playing }} hitSlop={4} style={styles.thumb}>
            {art}
            <View style={styles.playBadge}><Icon name={playing ? 'pauseCircle' : 'play'} size={28} tint="#FFFFFF" /></View>
            {playing ? <SamplePlayer url={sample} onEnd={onPlay} /> : null}
        </Pressable> : <View style={styles.thumb}>{art}</View>}
        <Pressable onPress={onOpen} accessibilityRole="button" accessibilityLabel={`${t('templates.kind.audio')}, ${template.name}${price ? `, ${price}` : ''}`} style={styles.body}>
            <View style={styles.meta}>
                <View style={styles.badge}><Text variant="caption">{t('templates.kind.audio')}</Text></View>
                <Text variant="caption" tone="secondary">{categoryLabel(template.category)}</Text>
            </View>
            <Text variant="bodyStrong" numberOfLines={1}>{template.name}</Text>
            <Text variant="caption" tone="secondary" numberOfLines={2}>{template.prompt}</Text>
            {price ? <Text tone="warning">{price}</Text> : null}
        </Pressable>
    </Card>;
}

// Mounted only while its card is playing, so leaving the screen or choosing another sample releases the player.
function SamplePlayer({ url, onEnd }: { readonly url: string; onEnd(): void }) {
    const player = useAudioPlayer({ uri: url });
    const status = useAudioPlayerStatus(player);
    useEffect(() => {
        setAudioModeAsync({ playsInSilentMode: true }).catch(() => { /* Playback still works with the default mode. */ });
        player.play();
    }, [player]);
    useEffect(() => { if (status.didJustFinish) onEnd(); }, [status.didJustFinish, onEnd]);
    return null;
}

const THUMB = 72;
const sheets = themedStyles(p => ({
    card: { marginVertical: 4, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 12 },
    thumb: { width: THUMB, height: THUMB, borderRadius: 8, overflow: 'hidden' },
    art: { width: THUMB, height: THUMB, backgroundColor: p.bgElevated2 },
    playBadge: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.28)' },
    body: { flex: 1, gap: 4 },
    meta: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    badge: { backgroundColor: p.bgElevated2, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 2 },
}));
