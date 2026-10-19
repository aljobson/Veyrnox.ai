import { Pressable, StyleSheet, Text, View } from 'react-native';
import { t } from '../lib/i18n';
import { dayKey, monthGrid } from '../lib/publishCalendar';
import { colors } from '../theme';

const WEEKDAYS = [1, 2, 3, 4, 5, 6, 0]; // Monday first, as getDay numbers

// ADR-0162: a month grid. Each day shows how many posts fall on it; tapping a day selects it. Day cells are 44 pt tall.
export function CalendarMonth({ monthStart, counts, selected, onSelect }: { monthStart: Date; counts: Map<string, number>; selected: string | null; onSelect: (key: string) => void }) {
    const weeks = monthGrid(monthStart);
    const today = dayKey(new Date());
    const refMonday = new Date(2024, 0, 1); // a Monday, only used to name the weekdays
    return (
        <View accessibilityRole="grid">
            <View style={styles.row}>
                {WEEKDAYS.map((_, i) => (
                    <Text key={i} style={styles.head} accessible={false}>{new Date(refMonday.getFullYear(), 0, 1 + i).toLocaleDateString(undefined, { weekday: 'narrow' })}</Text>
                ))}
            </View>
            {weeks.map((row, wi) => (
                <View key={wi} style={styles.row}>
                    {row.map((c) => {
                        const n = counts.get(c.key) ?? 0;
                        const on = selected === c.key;
                        return (
                            <Pressable
                                key={c.key}
                                accessibilityRole="button"
                                accessibilityState={{ selected: on }}
                                accessibilityLabel={`${c.date.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}, ${t(n === 1 ? 'calendar.postsOne' : 'calendar.postsMany', { count: n })}`}
                                style={[styles.cell, on && styles.cellOn, !c.inMonth && styles.dim]}
                                onPress={() => onSelect(c.key)}
                            >
                                <Text style={[styles.num, c.key === today && styles.today, on && styles.numOn]}>{c.date.getDate()}</Text>
                                {n > 0 ? <Text style={[styles.count, on && styles.numOn]}>{n}</Text> : null}
                            </Pressable>
                        );
                    })}
                </View>
            ))}
        </View>
    );
}

const styles = StyleSheet.create({
    row: { flexDirection: 'row' },
    head: { flex: 1, textAlign: 'center', color: colors.muted, fontSize: 12, paddingVertical: 6 },
    cell: { flex: 1, minHeight: 48, alignItems: 'center', justifyContent: 'center', borderRadius: 10, margin: 1 },
    cellOn: { backgroundColor: colors.accent },
    dim: { opacity: 0.4 },
    num: { color: colors.text, fontSize: 15 },
    today: { fontWeight: '800', color: colors.accent },
    numOn: { color: colors.accentInk },
    count: { color: colors.accent, fontSize: 11, fontWeight: '700' },
});
