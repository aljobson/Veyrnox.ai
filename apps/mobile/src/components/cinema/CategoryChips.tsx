import { Pressable, ScrollView, StyleSheet, Text } from 'react-native';
import { categoryKey, CATEGORIES } from '../../lib/cinemaBrowse';
import { t } from '../../lib/i18n';
import { MIN_TARGET } from '../../lib/a11y';
import { colors } from '../../theme';

interface Props {
    readonly value: string | null;
    readonly onChange: (slug: string | null) => void;
}

// "All" plus the 12 categories. One is chosen at a time; choosing it again clears it.
export function CategoryChips({ value, onChange }: Props) {
    const items: { slug: string | null; label: string }[] = [{ slug: null, label: t('cinemaBrowse.all') }, ...CATEGORIES.map((c) => ({ slug: c.slug as string | null, label: t(categoryKey(c.slug)) }))];
    return (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.strip} contentContainerStyle={styles.row} accessibilityLabel={t('cinemaBrowse.categories')}>
            {items.map((i) => {
                const on = value === i.slug;
                return (
                    <Pressable key={i.slug ?? 'all'} accessibilityRole="button" accessibilityState={{ selected: on }} style={[styles.chip, on && styles.chipOn]} onPress={() => onChange(on && i.slug ? null : i.slug)}>
                        <Text style={[styles.text, on && styles.textOn]}>{i.label}</Text>
                    </Pressable>
                );
            })}
        </ScrollView>
    );
}

const styles = StyleSheet.create({
    strip: { flexGrow: 0 },
    row: { paddingHorizontal: 12, gap: 8, alignItems: 'center' },
    chip: { minHeight: MIN_TARGET, justifyContent: 'center', paddingHorizontal: 16, borderRadius: 22, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
    chipOn: { backgroundColor: colors.accent, borderColor: colors.accent },
    text: { color: colors.body, fontWeight: '600' },
    textOn: { color: colors.accentInk },
});
