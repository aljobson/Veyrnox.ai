import { View } from 'react-native';
import { Image } from 'expo-image';
import { Card, Text, themedStyles, useThemedStyles } from '../ui';
import { rawText } from '../../lib/i18n/translate';
import { t } from '../../lib/i18n';
import { themeTitle } from '../../lib/presets';
import type { ImageTemplate } from '../../lib/imageTemplates';

// An image template: its picture, name and category. Opening it starts Create on its model with its prompt.
interface ImageTemplateCardProps { readonly template: ImageTemplate; onOpen(): void }

export function ImageTemplateCard({ template, onOpen }: ImageTemplateCardProps) {
    const styles = useThemedStyles(sheets);
    return <Card onPress={onOpen} accessibilityRole="button" accessibilityLabel={`${t('templates.kind.image')}, ${rawText(template.name)}`} style={styles.card}>
        <View style={[styles.preview, { aspectRatio: template.previewAspect }]}>
            {template.previewUrl ? <Image source={{ uri: template.previewUrl }} contentFit="cover" cachePolicy="memory" style={styles.fill} accessibilityIgnoresInvertColors /> : null}
        </View>
        <Text variant="bodyStrong" numberOfLines={2}>{rawText(template.name)}</Text>
        <Text variant="caption" tone="secondary">{themeTitle(template.category)}</Text>
    </Card>;
}
const sheets = themedStyles(p => ({
    card: { flex: 1, margin: 4, padding: 8, gap: 4 },
    preview: { width: '100%', overflow: 'hidden', borderRadius: 8, backgroundColor: p.bgElevated2 },
    fill: { width: '100%', height: '100%' },
}));
