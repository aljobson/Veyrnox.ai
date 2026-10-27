import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { colors } from '../../theme';

export function Field({ label, value, onChange, placeholder, multiline = false, maxLength = 2_000, hint, error }: { label: string; value: string; onChange: (value: string) => void; placeholder?: string; multiline?: boolean; maxLength?: number; hint?: string; error?: string }) {
    return <View style={styles.field}><Text style={styles.label}>{label}</Text><TextInput accessibilityLabel={label} style={[styles.input, multiline && styles.multiline]} value={value} onChangeText={onChange} placeholder={placeholder} placeholderTextColor={colors.muted} multiline={multiline} maxLength={maxLength} />{hint ? <Text style={styles.help}>{hint}</Text> : null}{error ? <Text accessibilityLiveRegion="polite" style={styles.error}>{error}</Text> : null}</View>;
}
export function Choices({ values, selected, onPick, suffix = '' }: { values: readonly string[]; selected: string; onPick: (value: string) => void; suffix?: string }) {
    return <View style={styles.choices}>{values.map((value) => <Pressable key={value} accessibilityRole="radio" accessibilityState={{ selected: value === selected }} style={[styles.choice, value === selected && styles.choiceOn]} onPress={() => onPick(value)}><Text style={[styles.choiceText, value === selected && styles.choiceTextOn]}>{value}{suffix}</Text></Pressable>)}</View>;
}

const styles = StyleSheet.create({
    field: { gap: 6 }, label: { color: colors.body, fontSize: 13, fontWeight: '700' }, input: { minHeight: 46, borderRadius: 12, borderWidth: 1, borderColor: colors.borderStrong, backgroundColor: colors.background, color: colors.text, paddingHorizontal: 12, paddingVertical: 10, fontSize: 16 }, multiline: { minHeight: 110, textAlignVertical: 'top' }, help: { color: colors.muted, fontSize: 13, lineHeight: 19 },
    choices: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, choice: { minHeight: 44, justifyContent: 'center', borderRadius: 12, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, paddingHorizontal: 14 }, choiceOn: { borderColor: colors.accent, backgroundColor: colors.accentSoft }, choiceText: { color: colors.body, fontWeight: '600' }, choiceTextOn: { color: colors.accent, fontWeight: '800' },
    error: { color: colors.danger },
});
