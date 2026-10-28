import { rawText } from '../lib/i18n/translate';
import { Text, Card, themedStyles, useThemedStyles } from './ui';
import { Image } from 'expo-image';
import { View } from 'react-native';
import { t } from '../lib/i18n';
import type { TemplateInfo } from '../lib/templateHandoff';
import { ds } from '../theme';

// The top of Create when it was opened from a template: which one, its picture, and the shape the result will take, so
// the form reads as "your template" and not a blank model screen.
export function TemplateBanner({ template, aspect }: { template: TemplateInfo; aspect: string | null }) {
    const styles = useThemedStyles(sheets);
    return (
        <Card style={styles.row} accessible accessibilityLabel={rawText(`${t('create.template.label')}: ${template.title}${aspect ? `. ${t('create.template.format', { aspect })}` : ''}`)}>
            {template.poster ? <Image source={{ uri: template.poster }} style={styles.poster} contentFit="cover" accessibilityIgnoresInvertColors /> : null}
            <View style={styles.text}>
                <Text variant="bodyStrong" tone="secondary">{t('create.template.label')}</Text>
                <Text variant="bodyStrong" tone="primary" style={styles.name} numberOfLines={2}>{template.title}</Text>
                {aspect ? <Text variant="footnote" tone="tertiary" style={styles.format}>{t('create.template.format', { aspect })}</Text> : null}
            </View>
        </Card>
    );
}

const sheets = themedStyles((p) => ({

    row: { flexDirection: 'row', alignItems: 'center', gap: ds.space.md, backgroundColor: p.bgElevated1, borderColor: p.borderSubtle, borderWidth: 1, borderRadius: ds.radius.md, padding: ds.space.sm },
    poster: { width: 56, height: 74, borderRadius: ds.radius.sm, backgroundColor: p.borderSubtle },
    text: { flex: 1, gap: ds.space.xxs },
    name: { color: p.textPrimary, },
    format: { color: p.textTertiary, },
}));
