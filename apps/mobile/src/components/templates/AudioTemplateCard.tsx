import { View } from 'react-native';
import { Card, Text, themedStyles, useThemedStyles } from '../ui';
import { plural, t } from '../../lib/i18n';
import type { AudioTemplate } from '../../lib/audioTemplates';

// An audio template has no picture or clip, so the card is text: a badge that says it is a sound,
// its category, its name, the start of its prompt and, like video cards, its price. Video cards show a preview instead.
interface AudioTemplateCardProps { readonly template: AudioTemplate; readonly credits?: number; onOpen(): void }

export function AudioTemplateCard({ template, credits, onOpen }: AudioTemplateCardProps) {
    const styles = useThemedStyles(sheets);
    const price = typeof credits === 'number' && credits > 0 ? plural('library.cost', credits) : null;
    return <Card onPress={onOpen} accessibilityRole="button" accessibilityLabel={`${t('templates.kind.audio')}, ${template.name}${price ? `, ${price}` : ''}`} style={styles.card}>
        <View style={styles.meta}>
            <View style={styles.badge}><Text variant="caption">{t('templates.kind.audio')}</Text></View>
            <Text variant="caption" tone="secondary">{t(`audioTemplates.cat.${template.category}`)}</Text>
        </View>
        <Text variant="bodyStrong">{template.name}</Text>
        <Text variant="caption" tone="secondary" numberOfLines={3}>{template.prompt}</Text>
        {price ? <Text tone="warning">{price}</Text> : null}
    </Card>;
}
const sheets = themedStyles(p => ({
    card: { marginVertical: 4, padding: 12, gap: 6 },
    meta: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    badge: { backgroundColor: p.bgElevated2, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 2 },
}));
