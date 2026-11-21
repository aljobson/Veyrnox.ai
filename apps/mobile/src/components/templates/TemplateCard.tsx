import { rawText } from '../../lib/i18n/translate';
import { View } from 'react-native';
import { Image } from 'expo-image';
import { Card, Text, themedStyles, useThemedStyles } from '../ui';
import { TemplatePlayButton, TemplateVideoLayer } from './TemplatePreviewControls';
import type { Preset } from '../../lib/presets';
import { previewRatio, templatePrice } from '../../lib/templateFilters';
import { t } from '../../lib/i18n';
export function TemplateCard({ preset, playing, onPlay, onOpen }: { preset: Preset; playing: boolean; onPlay(): void; onOpen(): void }) {
    const styles = useThemedStyles(sheets);
    return <Card style={styles.card}>
        <Card onPress={onOpen} accessibilityRole="button" accessibilityLabel={rawText(preset.title)} style={styles.open}>
            <View style={[styles.preview, { aspectRatio: previewRatio(preset) }]}>
                {preset.posterUrl ? <Image source={{ uri: preset.posterUrl }} contentFit="cover" cachePolicy="memory" style={styles.fill} /> : null}
                {playing && preset.previewUrl ? <TemplateVideoLayer url={preset.previewUrl} onFail={onPlay} /> : null}
                {preset.isNew ? <View style={styles.badge}><Text variant="caption">{t('explore.new')}</Text></View> : null}
            </View>
            <Text variant="bodyStrong">{preset.title}</Text><Text variant="caption" tone="secondary">{preset.modelName}</Text><Text tone="warning">{templatePrice(preset)}</Text>
            {!preset.available ? <Text tone="secondary">{t('presets.notavailablerightnow')}</Text> : null}
        </Card>
        {preset.previewUrl ? <TemplatePlayButton title={preset.title} playing={playing} style={styles.play} onPress={onPlay} /> : null}
    </Card>;
}
const sheets = themedStyles(p => ({
    card: { flex: 1, margin: 4, padding: 8, gap: 8 }, open: { borderWidth: 0, padding: 0, gap: 4 },
    preview: { width: '100%', overflow: 'hidden', borderRadius: 8, backgroundColor: p.bgElevated2 }, fill: { width: '100%', height: '100%' },
    badge: { position: 'absolute', top: 8, start: 8, backgroundColor: p.bgElevated1, borderRadius: 8, padding: 4 },
    // Inset from the preview's corner, which sits inside the card's 8pt padding.
    play: { top: 16, end: 16 },
}));
