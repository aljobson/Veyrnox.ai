import { View } from 'react-native';
import { Card, Text, themedStyles, useThemedStyles } from '../ui';
import { t } from '../../lib/i18n';
import type { AudioTemplate } from '../../lib/audioTemplates';

// An audio template has no picture or clip, so the card is text: a badge that says it is a sound,
// its category, its name and the start of its prompt. Video cards show a preview instead.
export function AudioTemplateCard({ template, onOpen }: { template: AudioTemplate; onOpen(): void }) {
    const styles = useThemedStyles(sheets);
    return <Card onPress={onOpen} accessibilityRole="button" accessibilityLabel={`${t('templates.kind.audio')}, ${template.name}`} style={styles.card}>
        <View style={styles.meta}>
            <View style={styles.badge}><Text variant="caption">{t('templates.kind.audio')}</Text></View>
            <Text variant="caption" tone="secondary">{t(`audioTemplates.cat.${template.category}`)}</Text>
        </View>
        <Text variant="bodyStrong">{template.name}</Text>
        <Text variant="caption" tone="secondary" numberOfLines={3}>{template.prompt}</Text>
    </Card>;
}
const sheets = themedStyles(p => ({
    card: { marginVertical: 4, padding: 12, gap: 6 },
    meta: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    badge: { backgroundColor: p.bgElevated2, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 2 },
}));
