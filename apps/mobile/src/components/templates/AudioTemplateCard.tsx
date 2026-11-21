import { Pressable, View, type StyleProp, type ViewStyle } from 'react-native';
import { Image } from 'expo-image';
import { Card, Icon, Text, themedStyles, useThemedStyles } from '../ui';
import { plural, t } from '../../lib/i18n';
import type { AudioTemplate } from '../../lib/audioTemplates';
import { categoryLabel } from '../../lib/presetCategoryLabel';
import { ds } from '../../theme';

// An audio template is a row: a small square of the licensed track's artwork with a play button over it, then a badge
// that says it is a sound, its category, name, the start of its prompt, price and the track's credit line. The artwork
// plays the sample in place; the rest of the row opens the template. The screen keeps one sample playing at a time.
interface AudioTemplateCardProps {
    readonly template: AudioTemplate;
    readonly credits?: number;
    readonly playing?: boolean;
    readonly style?: StyleProp<ViewStyle>;
    onPlay?(): void;
    onOpen(): void;
}

export function AudioTemplateCard({ template, credits, playing = false, style, onPlay, onOpen }: AudioTemplateCardProps) {
    const styles = useThemedStyles(sheets);
    const price = typeof credits === 'number' && credits > 0 ? plural('library.cost', credits) : null;
    const sample = template.previewAudioUrl;
    const art = template.previewUrl
        ? <Image source={{ uri: template.previewUrl }} style={styles.art} contentFit="cover" accessible={false} accessibilityIgnoresInvertColors />
        : <View style={[styles.art, styles.artEmpty]}><Icon name="audio" size={24} /></View>;
    return <Card style={[styles.card, style]}>
        {sample && onPlay ? <Pressable onPress={onPlay} accessibilityRole="button" accessibilityLabel={`${t(playing ? 'music.pause' : 'music.play')}, ${template.name}`} accessibilityState={{ selected: playing }} style={styles.thumb}>
            {art}
            <View style={styles.playLayer}><View style={styles.playBadge}><Icon name={playing ? 'pauseCircle' : 'play'} size={16} /></View></View>
            {playing ? <SamplePlayer url={sample} onEnd={onPlay} /> : null}
        </Pressable> : <View style={styles.thumb}>{art}</View>}
        <Pressable onPress={onOpen} accessibilityRole="button" accessibilityLabel={`${t('templates.kind.audio')}, ${template.name}${price ? `, ${price}` : ''}`} style={styles.body}>
            <View style={styles.meta}>
                <View style={styles.badge}><Text variant="caption">{t('templates.kind.audio')}</Text></View>
                <Text variant="caption" tone="secondary" numberOfLines={1} style={styles.category}>{categoryLabel(template.category)}</Text>
            </View>
            <Text variant="bodyStrong" numberOfLines={1}>{template.name}</Text>
            <Text variant="caption" tone="secondary" numberOfLines={2}>{template.prompt}</Text>
            {price ? <Text variant="caption" tone="warning">{price}</Text> : null}
            {template.attribution ? <Text variant="caption" tone="tertiary" numberOfLines={3}>{template.attribution}</Text> : null}
        </Pressable>
    </Card>;
}

// Loaded on first play so a screen that only lists templates never loads expo-audio (see AudioSamplePlayer).
function SamplePlayer(props: { readonly url: string; onEnd(): void }) {
    const { SamplePlayer: Player } = require('./AudioSamplePlayer') as typeof import('./AudioSamplePlayer');
    return <Player {...props} />;
}

const THUMB = 72;
const sheets = themedStyles(p => ({
    card: { padding: ds.space.md, flexDirection: 'row', alignItems: 'center', gap: ds.space.md },
    thumb: { width: THUMB, height: THUMB, borderRadius: ds.radius.sm, overflow: 'hidden' },
    art: { width: THUMB, height: THUMB, backgroundColor: p.bgElevated2 },
    artEmpty: { alignItems: 'center', justifyContent: 'center' },
    playLayer: { position: 'absolute', top: 0, end: 0, bottom: 0, start: 0, alignItems: 'center', justifyContent: 'center' },
    playBadge: { width: 32, height: 32, borderRadius: ds.radius.pill, alignItems: 'center', justifyContent: 'center', backgroundColor: p.bgElevated1 },
    body: { flex: 1, gap: ds.space.xs },
    meta: { flexDirection: 'row', alignItems: 'center', gap: ds.space.sm },
    badge: { backgroundColor: p.bgElevated2, borderRadius: ds.radius.sm, paddingHorizontal: ds.space.sm, paddingVertical: ds.space.xxs },
    category: { flexShrink: 1 },
}));
