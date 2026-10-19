import { Pressable, StyleSheet, Text, View } from 'react-native';
import { touchTarget } from '../../lib/a11y';
import { colors } from '../../theme';

export function Card({ title, help, children }: { title: string; help?: string; children: React.ReactNode }) {
    return (
        <View style={styles.card}>
            <Text style={styles.title} accessibilityRole="header">{title}</Text>
            {help ? <Text style={styles.help}>{help}</Text> : null}
            {children}
        </View>
    );
}

export function Action({ label, onPress, disabled, danger }: { label: string; onPress: () => void; disabled?: boolean; danger?: boolean }) {
    return (
        <Pressable
            accessibilityRole="button"
            accessibilityLabel={label}
            accessibilityState={{ disabled: Boolean(disabled) }}
            disabled={disabled}
            onPress={onPress}
            style={[styles.action, disabled && styles.off]}
        >
            <Text style={[styles.actionText, danger && styles.danger]}>{label}</Text>
        </Pressable>
    );
}

export function Status({ text, error }: { text: string | null; error?: boolean }) {
    if (!text) return null;
    return <Text accessibilityRole={error ? 'alert' : undefined} accessibilityLiveRegion="polite" style={[styles.status, error && styles.danger]}>{text}</Text>;
}

export const styles = StyleSheet.create({
    card: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 12, padding: 16, gap: 12 },
    title: { color: colors.text, fontSize: 17, fontWeight: '700' },
    help: { color: colors.muted, fontSize: 14 },
    name: { color: colors.text, fontSize: 16, fontWeight: '600' },
    action: { ...touchTarget, borderColor: colors.border, borderWidth: 1, borderRadius: 999, paddingHorizontal: 16, alignItems: 'center', alignSelf: 'flex-start' },
    actionText: { color: colors.text, fontSize: 15, fontWeight: '600' },
    danger: { color: colors.danger },
    off: { opacity: 0.5 },
    status: { color: colors.accent, fontSize: 14 },
    input: { ...touchTarget, color: colors.text, backgroundColor: colors.background, borderColor: colors.border, borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, fontSize: 16 },
    label: { color: colors.muted, fontSize: 13 },
});
