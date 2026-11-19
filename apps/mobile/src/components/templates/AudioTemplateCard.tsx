import { View } from 'react-native';
import { Image } from 'expo-image';
import { Card, Text, themedStyles, useThemedStyles } from '../ui';
import { plural, t } from '../../lib/i18n';
import type { AudioTemplate } from '../../lib/audioTemplates';
import { categoryLabel } from '../../lib/presetCategoryLabel';

// An audio template shows its licensed track's artwork (when the server sends one), then a badge that says it is a sound,
// its category, its name, the start of its prompt and, like video cards, its price.
interface AudioTemplateCardProps { readonly template: AudioTemplate; readonly credits?: number; onOpen(): void }

export function AudioTemplateCard({ template, credits, onOpen }: AudioTemplateCardProps) {
    const styles = useThemedStyles(sheets);
    const price = typeof credits === 'number' && credits > 0 ? plural('library.cost', credits) : null;
    return <Card onPress={onOpen} accessibilityRole="button" accessibilityLabel={`${t('templates.kind.audio')}, ${template.name}${price ? `, ${price}` : ''}`} style={styles.card}>
        {template.previewUrl ? <Image source={{ uri: template.previewUrl }} style={styles.art} contentFit="cover" accessible={false} accessibilityIgnoresInvertColors /> : null}
        <View style={styles.meta}>
            <View style={styles.badge}><Text variant="caption">{t('templates.kind.audio')}</Text></View>
            <Text variant="caption" tone="secondary">{categoryLabel(template.category)}</Text>
        </View>
        <Text variant="bodyStrong">{template.name}</Text>
        <Text variant="caption" tone="secondary" numberOfLines={3}>{template.prompt}</Text>
        {price ? <Text tone="warning">{price}</Text> : null}
    </Card>;
}
const sheets = themedStyles(p => ({
    card: { marginVertical: 4, padding: 12, gap: 6 },
    art: { width: '100%', aspectRatio: 4 / 3, borderRadius: 8, backgroundColor: p.bgElevated2 },
    meta: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    badge: { backgroundColor: p.bgElevated2, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 2 },
}));
