import { rawText } from '../../lib/i18n/translate';
import { controlKind } from '../../lib/oddlingsCatalog';
import { SwatchGroup, SliderGroup, TileGroup } from './CatalogControls';
import { displayLabel } from '../../lib/displayLabels';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { MIN_TARGET } from '../../lib/a11y';
import { plural } from '../../lib/i18n';
import { CATEGORIES, groupById, type Category, type Picks } from '../../lib/oddlingsBuilder';
import { colors } from '../../theme';

interface Props {
    categoryId: string;
    picks: Picks;
    onCategory: (id: string) => void;
    onPick: (groupId: string, value: string) => void;
}

export const pickedIn = (category: Category, picks: Picks): number => category.groupIds.filter((id) => picks[id]).length;

// The category rail and visual controls share the existing builder pick reducer.
export function OddlingCatalog({ categoryId, picks, onCategory, onPick }: Props) {
    const category = CATEGORIES.find((c) => c.id === categoryId) ?? CATEGORIES[0];
    return (
        <View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.rail}>
                {CATEGORIES.map((item) => {
                    const on = item.id === category.id;
                    const n = pickedIn(item, picks);
                    return (
                        <Pressable key={item.id} accessibilityRole="button" accessibilityState={{ selected: on }} accessibilityLabel={rawText(n ? `${displayLabel(item.label)}, ${plural('oddlings.build.chosen', n)}` : displayLabel(item.label))} style={[styles.chip, on && styles.chipOn]} onPress={() => onCategory(item.id)}>
                            <Text style={[styles.chipText, on && styles.chipTextOn]}>{displayLabel(item.label)}{n ? ` · ${n}` : ''}</Text>
                        </Pressable>
                    );
                })}
            </ScrollView>
            <Text style={styles.hint}>{displayLabel(category.hint)}</Text>
            {category.groupIds.map((id) => {
                const group = groupById(id);
                if (!group) return null;
                const Control = controlKind(id) === 'swatch' ? SwatchGroup : controlKind(id) === 'slider' ? SliderGroup : TileGroup;
                return <Control key={id} group={group} value={picks[id] || ''} onPick={onPick} />;
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
});
