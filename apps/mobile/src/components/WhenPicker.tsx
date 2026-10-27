import { Chip, Text, TextField } from './ui';
import { StyleSheet, View } from 'react-native';
import { parseWhen, quickTimes } from '../lib/publishCompose';
import { colors } from '../theme';

const pad = (n: number) => String(n).padStart(2, '0');
export const dateText = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const timeText = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

// A time choice without a native date picker: quick choices plus a typed date and time, in the phone's time zone.
export function whenFrom(date: string, time: string): Date | null {
    return parseWhen(date, time);
}

export function WhenPicker({ date, time, onChange }: { date: string; time: string; onChange: (date: string, time: string) => void }) {
    return (
        <View style={styles.box}>
            <View style={styles.chips}>
                {quickTimes(new Date()).map((q) => (
                    <Chip key={q.label} label={q.label} onPress={() => onChange(dateText(q.date), timeText(q.date))} />
                ))}
            </View>
            <View style={styles.row}>
                <TextField accessibilityLabel="Date, year-month-day" containerStyle={styles.date} value={date} onChangeText={(v) => onChange(v, time)} placeholder="YYYY-MM-DD" placeholderTextColor={colors.muted} autoCapitalize="none" keyboardType="numbers-and-punctuation" />
                <TextField accessibilityLabel="Time, hour:minute" containerStyle={styles.time} value={time} onChangeText={(v) => onChange(date, v)} placeholder="HH:MM" placeholderTextColor={colors.muted} autoCapitalize="none" keyboardType="numbers-and-punctuation" />
            </View>
            <Text style={styles.muted}>Times are in this phone's time zone.</Text>
        </View>
    );
}

const styles = StyleSheet.create({
    box: { gap: 8 },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    chip: { paddingVertical: 9, paddingHorizontal: 12, borderRadius: 10, backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1 },
    chipText: { color: colors.body },
    row: { flexDirection: 'row', gap: 8 },
    input: { backgroundColor: colors.surface, borderColor: colors.borderStrong, borderWidth: 1, borderRadius: 12, padding: 12, color: colors.text, fontSize: 16, minHeight: 48 },
    date: { flex: 2 },
    time: { flex: 1 },
    muted: { color: colors.muted, fontSize: 13 },
});
