import { View } from 'react-native';
import { Image } from 'expo-image';
import { Card, Text, themedStyles, useThemedStyles } from '../ui';
import { rawText } from '../../lib/i18n/translate';
import { plural, t } from '../../lib/i18n';
import { themeTitle } from '../../lib/presets';
import type { ImageTemplate } from '../../lib/imageTemplates';

// An image template: its picture, name and category. Opening it starts Create on its model with its prompt.
interface ImageTemplateCardProps { readonly template: ImageTemplate; readonly credits?: number; onOpen(): void }

export function ImageTemplateCard({ template, credits, onOpen }: ImageTemplateCardProps) {
    const styles = useThemedStyles(sheets);
    const price = typeof credits === 'number' && credits > 0 ? plural('library.cost', credits) : null;
    return <Card onPress={onOpen} disabled={!price} accessibilityRole="button" accessibilityState={{ disabled: !price }} accessibilityLabel={`${t('templates.kind.image')}, ${rawText(template.name)}${price ? `, ${price}` : `, ${t('crunTemplates.priceUnavailable')}`}`} style={styles.card}>
        <View style={[styles.preview, { aspectRatio: template.previewAspect }]}>
            {template.previewUrl ? <Image source={{ uri: template.previewUrl }} contentFit="cover" cachePolicy="memory" style={styles.fill} accessibilityIgnoresInvertColors /> : null}
        </View>
        <Text variant="bodyStrong" numberOfLines={2}>{rawText(template.name)}</Text>
        <Text variant="caption" tone="secondary">{themeTitle(template.category)}</Text>
        <Text variant="caption" tone={price ? 'warning' : 'secondary'}>{price || t('crunTemplates.priceUnavailable')}</Text>
    </Card>;
}
const sheets = themedStyles(p => ({
    card: { flex: 1, margin: 4, padding: 8, gap: 4 },
    preview: { width: '100%', overflow: 'hidden', borderRadius: 8, backgroundColor: p.bgElevated2 },
    fill: { width: '100%', height: '100%' },
}));
