import { Pressable, View, type StyleProp, type ViewStyle } from 'react-native';
import { Image } from 'expo-image';
import { Button, Card, Icon, Text, themedStyles, useThemedStyles } from '../ui';
import { plural, t } from '../../lib/i18n';
import type { AudioTemplate } from '../../lib/audioTemplates';
import { categoryLabel } from '../../lib/presetCategoryLabel';
import { ds } from '../../theme';

// An audio template drawn the way the web's Explore > Audio draws it: the licensed track's artwork, its name and
// category, a play control for the sample, the price, the track's credit line and Use template. The artwork, name and
// Use template open the template; the play control plays the sample in place. The screen keeps one sample playing.
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
    return <Card style={[styles.card, style]}>
        <Pressable onPress={onOpen} accessibilityRole="button" accessibilityLabel={`${t('templates.kind.audio')}, ${template.name}${price ? `, ${price}` : ''}`} style={styles.open}>
            <View style={styles.art}>
                {template.previewUrl
                    ? <Image source={{ uri: template.previewUrl }} style={styles.fill} contentFit="cover" accessible={false} accessibilityIgnoresInvertColors />
                    : <Icon name="audio" size={24} />}
            </View>
            <Text variant="bodyStrong" numberOfLines={2}>{template.name}</Text>
            <Text variant="caption" tone="secondary">{categoryLabel(template.category)}</Text>
        </Pressable>
        {sample && onPlay ? <Pressable onPress={onPlay} accessibilityRole="button" accessibilityLabel={`${t(playing ? 'music.pause' : 'music.play')}, ${template.name}`} accessibilityState={{ selected: playing }} style={({ pressed }) => [styles.play, pressed && styles.playPressed]}>
            <Icon name={playing ? 'pauseCircle' : 'play'} size={16} />
            <Text variant="caption">{t(playing ? 'music.pause' : 'music.play')}</Text>
            {playing ? <SamplePlayer url={sample} onEnd={onPlay} /> : null}
        </Pressable> : null}
        {price ? <Text variant="caption" tone="warning">{price}</Text> : null}
        {template.attribution ? <Text variant="caption" tone="tertiary" numberOfLines={3}>{template.attribution}</Text> : null}
        <Button variant="primary" size="sm" label={t('libraryCreate.useTemplate')} accessibilityLabel={`${t('libraryCreate.useTemplate')}, ${template.name}`} onPress={onOpen} />
    </Card>;
}

// Loaded on first play so a screen that only lists templates never loads expo-audio (see AudioSamplePlayer).
function SamplePlayer(props: { readonly url: string; onEnd(): void }) {
    const { SamplePlayer: Player } = require('./AudioSamplePlayer') as typeof import('./AudioSamplePlayer');
    return <Player {...props} />;
}

const sheets = themedStyles(p => ({
    card: { padding: ds.space.sm, gap: ds.space.xs, overflow: 'hidden' },
    open: { gap: ds.space.xs },
    // 4:3, as on the web, so the artwork reads as a cover rather than a poster-sized tile.
    art: { width: '100%', aspectRatio: 4 / 3, borderRadius: ds.radius.sm, overflow: 'hidden', backgroundColor: p.bgElevated2, alignItems: 'center', justifyContent: 'center', marginBottom: ds.space.xxs },
    fill: { width: '100%', height: '100%' },
    play: { flexDirection: 'row', alignItems: 'center', gap: ds.space.xs, minHeight: 44, paddingHorizontal: ds.space.sm, borderRadius: ds.radius.pill, backgroundColor: p.bgElevated2 },
    playPressed: { backgroundColor: p.surfacePressed },
}));
