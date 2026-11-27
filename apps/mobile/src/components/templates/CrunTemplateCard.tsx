import { Image } from 'expo-image';
import { View } from 'react-native';
import { t } from '../../lib/i18n';
import type { CrunTemplatePreview } from '../../lib/crunTemplateSummary';
import { Button, Card, Text, themedStyles, useThemedStyles } from '../ui';
import { TemplatePlayButton, TemplateVideoLayer } from './TemplatePreviewControls';

export function CrunTemplateCard({ template, playing, onPlay, onUse }: {
    readonly template: CrunTemplatePreview;
    readonly playing: boolean;
    onPlay(): void;
    onUse(): void;
}) {
    const styles = useThemedStyles(sheets);
    const still = template.coverUrl ?? (template.previewKind === 'image' ? template.previewUrl : null);
    const video = template.previewKind === 'video' ? template.previewUrl : null;
    const inputs = template.maxInputCount === 0 ? t('crunTemplates.inputNone')
        : template.minInputCount !== template.maxInputCount ? t('crunTemplates.inputRange', { min: template.minInputCount, max: template.maxInputCount })
            : t('crunTemplates.inputCount', { count: template.maxInputCount });
    return <Card style={styles.card}>
        <View style={styles.preview} accessibilityLabel={t('crunTemplates.previewLabel', { name: template.name })}>
            {still ? <Image source={{ uri: still }} contentFit="cover" cachePolicy="memory" style={styles.fill} /> : <View style={styles.empty}><Text variant="caption" tone="secondary">{t('crunTemplates.previewUnavailable')}</Text></View>}
            {playing && video ? <TemplateVideoLayer url={video} onFail={onPlay} /> : null}
            {template.tag ? <View style={styles.badge}><Text variant="caption">{template.tag}</Text></View> : null}
        </View>
        <Text variant="bodyStrong">{template.name}</Text>
        {template.category ? <Text variant="caption" tone="secondary">{template.category}</Text> : null}
        <Text variant="caption" tone="secondary">{inputs}</Text>
        {template.prices.length ? <Text variant="caption" tone="accent">{template.prices.map(price => `${price.resolution} · ${price.credits}`).join(' / ')} {t('crunTemplates.credits')}</Text>
            : template.credits !== null ? <Text variant="caption" tone="accent">{t('crunTemplates.price', { credits: template.credits })}</Text> : null}
        {video ? <TemplatePlayButton title={template.name} playing={playing} style={styles.play} onPress={onPlay} /> : null}
        <Button label={t('crunTemplates.use')} size="md" onPress={onUse} />
    </Card>;
}

const sheets = themedStyles(p => ({
    card: { flex: 1, margin: 4, padding: 8, gap: 6 },
    preview: { width: '100%', aspectRatio: 3 / 4, overflow: 'hidden', borderRadius: 8, backgroundColor: p.bgElevated2 },
    fill: { width: '100%', height: '100%' },
    empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 12 },
    badge: { position: 'absolute', top: 8, start: 8, backgroundColor: p.bgElevated1, borderRadius: 8, padding: 4 },
    play: { top: 16, end: 16 },
}));
