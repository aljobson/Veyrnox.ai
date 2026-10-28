import type { ElementRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { dayKey } from '../../lib/publishCalendar';
import { formatLocale } from '../../lib/i18n';
import { colors } from '../../theme';

export function CalendarWeekStrip({ start, dropKey, dropRef, onLayout }: { start: Date; dropKey: string | null; dropRef: (key: string, ref: ElementRef<typeof View> | null) => void; onLayout: () => void }) {
    return <View style={styles.strip} pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" onLayout={onLayout}>
        {Array.from({ length: 7 }, (_, i) => {
            const date = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i), key = dayKey(date);
            return <View key={key} ref={ref => dropRef(key, ref)} collapsable={false} style={[styles.cell, dropKey === key && styles.over]}>
                <Text style={styles.text}>{date.toLocaleDateString(formatLocale(undefined), { weekday: 'narrow', day: 'numeric' })}</Text>
            </View>;
        })}
    </View>;
}
const styles = StyleSheet.create({
    strip: { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 1, flexDirection: 'row', backgroundColor: colors.surface },
    cell: { flex: 1, minHeight: 48, margin: 1, justifyContent: 'center', alignItems: 'center', borderRadius: 10 },
    over: { borderWidth: 2, borderColor: colors.accent }, text: { color: colors.text },
});
