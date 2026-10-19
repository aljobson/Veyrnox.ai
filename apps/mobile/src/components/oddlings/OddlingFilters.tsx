import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { MIN_TARGET } from '../../lib/a11y';
import { t } from '../../lib/i18n';
import { KIND_FILTERS, ODDLING_TABS, kindCount, type OddlingKind } from '../../lib/oddlings';
import { colors } from '../../theme';

interface Props {
    tab: string;
    kind: OddlingKind | null;
    onTab: (id: string) => void;
    onKind: (id: OddlingKind) => void;
}

// The themed collections are tabs; Human and Other beings narrow whichever one is open.
export function OddlingFilters({ tab, kind, onTab, onKind }: Props) {
    return (
        <View>
            <Text style={styles.label} accessibilityRole="header">{t('oddlings.collections')}</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
                {ODDLING_TABS.map((item) => (
                    <Pressable key={item.id} accessibilityRole="button" accessibilityState={{ selected: tab === item.id }} style={[styles.chip, tab === item.id && styles.chipOn]} onPress={() => onTab(item.id)}>
                        <Text style={[styles.chipText, tab === item.id && styles.chipTextOn]}>{item.label}</Text>
                    </Pressable>
                ))}
            </ScrollView>
            <Text style={styles.label}>{t('oddlings.show')}</Text>
            <View style={styles.row}>
                {KIND_FILTERS.map((item) => {
                    const count = kindCount(tab, item.id);
                    const on = kind === item.id;
                    return (
                        <Pressable key={item.id} accessibilityRole="button" accessibilityState={{ selected: on, disabled: count === 0 }} disabled={count === 0} style={[styles.chip, on && styles.chipOn, count === 0 && styles.chipOff]} onPress={() => onKind(item.id)}>
                            <Text style={[styles.chipText, on && styles.chipTextOn]}>{t(item.labelKey)} · {count}</Text>
                        </Pressable>
                    );
                })}
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    label: { color: colors.muted, fontSize: 12, fontWeight: '700', marginTop: 12, marginBottom: 6, paddingHorizontal: 16 },
    row: { flexDirection: 'row', gap: 8, paddingHorizontal: 16 },
    chip: { minHeight: MIN_TARGET, justifyContent: 'center', paddingHorizontal: 14, borderRadius: 22, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
    chipOn: { backgroundColor: colors.accent, borderColor: colors.accent },
    chipOff: { opacity: 0.4 },
    chipText: { color: colors.body, fontSize: 14 },
    chipTextOn: { color: colors.accentInk, fontWeight: '700' },
});
