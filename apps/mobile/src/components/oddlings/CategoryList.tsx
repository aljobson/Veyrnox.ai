import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { MIN_TARGET } from '../../lib/a11y';
import { plural, t } from '../../lib/i18n';
import { CATEGORIES, groupById, optionLabel, type Category, type Picks } from '../../lib/oddlingsBuilder';
import { colors } from '../../theme';

interface Props {
    categoryId: string;
    picks: Picks;
    onCategory: (id: string) => void;
    onOpen: (groupId: string) => void;
}

export const pickedIn = (category: Category, picks: Picks): number => category.groupIds.filter((id) => picks[id]).length;

// Categories along the top (the web's rail), and under them one row per group showing the current pick.
export function CategoryList({ categoryId, picks, onCategory, onOpen }: Props) {
    const category = CATEGORIES.find((c) => c.id === categoryId) ?? CATEGORIES[0];
    return (
        <View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.rail}>
                {CATEGORIES.map((item) => {
                    const on = item.id === category.id;
                    const n = pickedIn(item, picks);
                    return (
                        <Pressable key={item.id} accessibilityRole="button" accessibilityState={{ selected: on }} accessibilityLabel={n ? `${item.label}, ${plural('oddlings.build.chosen', n)}` : item.label} style={[styles.chip, on && styles.chipOn]} onPress={() => onCategory(item.id)}>
                            <Text style={[styles.chipText, on && styles.chipTextOn]}>{item.label}{n ? ` · ${n}` : ''}</Text>
                        </Pressable>
                    );
                })}
            </ScrollView>
            <Text style={styles.hint}>{category.hint}</Text>
            {category.groupIds.map((id) => {
                const group = groupById(id);
                if (!group) return null;
                const value = picks[id];
                const shown = value ? optionLabel(id, value) : t('oddlings.build.notSet');
                return (
                    <Pressable key={id} accessibilityRole="button" accessibilityLabel={`${group.label}: ${shown}`} style={styles.row} onPress={() => onOpen(id)}>
                        <Text style={styles.rowLabel}>{group.label}</Text>
                        <Text style={[styles.rowValue, !value && styles.rowEmpty]} numberOfLines={1}>{shown}</Text>
                        <Text style={styles.chev} accessible={false}>›</Text>
                    </Pressable>
                );
            })}
        </View>
    );
}

const styles = StyleSheet.create({
    rail: { gap: 8 },
    chip: { minHeight: MIN_TARGET, justifyContent: 'center', paddingHorizontal: 14, borderRadius: 22, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
    chipOn: { backgroundColor: colors.accent, borderColor: colors.accent },
    chipText: { color: colors.body, fontSize: 14 },
    chipTextOn: { color: colors.accentInk, fontWeight: '700' },
    hint: { color: colors.muted, fontSize: 13, marginVertical: 10 },
    row: { minHeight: MIN_TARGET, flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
    rowLabel: { color: colors.text, fontSize: 16, flex: 1 },
    rowValue: { color: colors.accent, fontSize: 15, maxWidth: '50%' },
    rowEmpty: { color: colors.muted },
    chev: { color: colors.muted, fontSize: 22 },
});
