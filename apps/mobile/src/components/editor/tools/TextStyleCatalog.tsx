import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { TITLE_STYLES } from '../../../../../../app/veyrnox/_lib/editorPresets.mjs';
import { t, rawText } from '../../../lib/i18n';
import { touchTarget } from '../../../lib/a11y';
import { editorTextPreviewStyle } from '../../../lib/editorTextPreview';
import { colors, ds, type } from '../../../theme';
import { styles } from '../fullEditorStyles';
export function TextStyleCatalog({ onInsert }: { onInsert(name: string): void }) {
    const labels: Record<string, string> = {
        "Clean title": t('editorText.preset0'),
        "Lower third": t('editorText.preset1'),
        "Editorial": t('editorText.preset2'),
        "Caption highlight": t('editorText.preset3'),
        "Serif quote": t('editorText.preset4'),
        "Neon heading": t('editorText.preset5'),
        "Typewriter": t('editorText.preset6'),
        "Warm label": t('editorText.preset7'),
        "Bold impact": t('editorText.preset8'),
        "Minimal subtitle": t('editorText.preset9'),
        "Retro pop": t('editorText.preset10'),
        "Documentary": t('editorText.preset11'),
        "Kinetic block": t('editorText.preset12'),
        "Luxury serif": t('editorText.preset13'),
        "Breaking headline": t('editorText.preset14'),
        "Outlined": t('editorText.preset15'),
    };
    return <>
        <Text accessibilityRole="header" style={styles.sectionTitle}>{t('editorText.catalog')}</Text>
        <View style={local.grid}>{TITLE_STYLES.map(preset => <Pressable key={preset.name} accessibilityRole="button"
            accessibilityLabel={rawText(labels[preset.name])} onPress={() => onInsert(preset.name)} style={[touchTarget, local.tile]}>
            <View style={[local.sample, { backgroundColor: styles.previewFrame.backgroundColor }]}>
                <Text style={editorTextPreviewStyle(preset.style, preset.size, Platform.OS)}>{rawText('Aa')}</Text>
            </View>
            <Text style={local.label}>{labels[preset.name]}</Text>
        </Pressable>)}</View>
    </>;
}
const local = StyleSheet.create({
    grid: { flexDirection: 'row', flexWrap: 'wrap', gap: ds.space.sm },
    tile: { flexBasis: '45%', flexGrow: 1, padding: ds.space.sm, gap: ds.space.sm, borderRadius: ds.space.xs,
        borderWidth: 1, borderColor: colors.border },
    sample: { padding: ds.space.sm, alignItems: 'center', justifyContent: 'center', borderRadius: ds.space.xs },
    label: { ...type.label, color: colors.text },
});
