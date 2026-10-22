import { Image } from 'expo-image';
import { StyleSheet, Text, View } from 'react-native';
import { t } from '../lib/i18n';
import type { TemplateInfo } from '../lib/templateHandoff';
import { colors } from '../theme';

// The top of Create when it was opened from a template: which one, its picture, and the shape the result will take, so
// the form reads as "your template" and not a blank model screen.
export function TemplateBanner({ template, aspect }: { template: TemplateInfo; aspect: string | null }) {
    return (
        <View style={styles.row} accessible accessibilityLabel={`${t('create.template.label')}: ${template.title}${aspect ? `. ${t('create.template.format', { aspect })}` : ''}`}>
            {template.poster ? <Image source={{ uri: template.poster }} style={styles.poster} contentFit="cover" accessibilityIgnoresInvertColors /> : null}
            <View style={styles.text}>
                <Text style={styles.label}>{t('create.template.label')}</Text>
                <Text style={styles.name} numberOfLines={2}>{template.title}</Text>
                {aspect ? <Text style={styles.format}>{t('create.template.format', { aspect })}</Text> : null}
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    row: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 14, padding: 10 },
    poster: { width: 56, height: 74, borderRadius: 10, backgroundColor: colors.border },
    text: { flex: 1, gap: 2 },
    label: { color: colors.accent, fontSize: 12, fontWeight: '700', textTransform: 'uppercase' },
    name: { color: colors.text, fontSize: 16, fontWeight: '700' },
    format: { color: colors.muted, fontSize: 13 },
});
