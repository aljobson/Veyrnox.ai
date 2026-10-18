import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useAuth } from '../../auth/AuthProvider';
import {
    REPORT_CATEGORIES,
    reportErrorMessage,
    submitReport,
    validateReport,
    type ReportCategory,
    type ReportSubject,
} from '../../lib/account';
import { colors } from '../../theme';

// Opened from a creation (kind=job&id=...) or from Account (no params: a general report).
export default function ReportScreen() {
    const params = useLocalSearchParams<{ kind?: string; id?: string }>();
    const { api } = useAuth();
    const router = useRouter();
    const kind: ReportSubject =
        params.id && (params.kind === 'job' || params.kind === 'cinema_title') ? params.kind : 'other';
    const subjectId = kind === 'other' ? null : (params.id ?? null);
    const [category, setCategory] = useState<ReportCategory | null>(null);
    const [details, setDetails] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [sent, setSent] = useState(false);

    async function send() {
        if (!category) return setError('Choose what is wrong.');
        const input = { kind, subjectId, category, details };
        const invalid = validateReport(input);
        if (invalid) return setError(invalid);
        setBusy(true);
        setError(null);
        try {
            await submitReport(api, input);
            setSent(true);
        } catch (err) {
            setError(reportErrorMessage(err));
        } finally {
            setBusy(false);
        }
    }

    if (sent) {
        return (
            <View style={styles.done}>
                <Stack.Screen options={{ title: 'Report' }} />
                <Text style={styles.doneTitle}>Thanks, we have it.</Text>
                <Text style={styles.body}>A person reads every report. We may remove content or close an account, and we do not tell you the outcome.</Text>
                <Pressable accessibilityRole="button" style={styles.primary} onPress={() => router.back()}>
                    <Text style={styles.primaryText}>Done</Text>
                </Pressable>
            </View>
        );
    }

    return (
        <ScrollView style={styles.screen} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
            <Stack.Screen options={{ title: kind === 'job' ? 'Report this creation' : kind === 'cinema_title' ? 'Report this title' : 'Report a problem' }} />
            <Text style={styles.body}>
                {kind === 'job' ? 'What is wrong with this creation?' : kind === 'cinema_title' ? 'What is wrong with this title?' : 'What would you like to report?'}
            </Text>
            {REPORT_CATEGORIES.map((c) => (
                <Pressable
                    key={c.id}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: category === c.id }}
                    style={[styles.option, category === c.id && styles.optionOn]}
                    onPress={() => setCategory(c.id)}
                >
                    <Text style={styles.optionText}>{c.label}</Text>
                </Pressable>
            ))}
            <TextInput
                accessibilityLabel="Details"
                multiline
                maxLength={2000}
                placeholder={kind === 'other' ? 'Tell us what happened (required)' : 'Anything else we should know (optional)'}
                placeholderTextColor={colors.muted}
                style={styles.input}
                value={details}
                onChangeText={setDetails}
            />
            {error ? <Text style={styles.error}>{error}</Text> : null}
            <Pressable accessibilityRole="button" disabled={busy} style={[styles.primary, busy && styles.off]} onPress={send}>
                {busy ? <ActivityIndicator color={colors.accentInk} /> : <Text style={styles.primaryText}>Send report</Text>}
            </Pressable>
            <Text style={styles.small}>Do not send illegal images in a report. Describe them instead.</Text>
        </ScrollView>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background },
    content: { padding: 16, gap: 8 },
    done: { flex: 1, backgroundColor: colors.background, padding: 24, justifyContent: 'center', gap: 12 },
    doneTitle: { color: colors.text, fontSize: 24, fontWeight: '700' },
    body: { color: colors.body, fontSize: 16, marginBottom: 4 },
    option: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 12, padding: 14 },
    optionOn: { borderColor: colors.accent },
    optionText: { color: colors.text, fontSize: 16 },
    input: {
        minHeight: 96,
        backgroundColor: colors.surface,
        borderColor: colors.border,
        borderWidth: 1,
        borderRadius: 12,
        padding: 12,
        color: colors.text,
        fontSize: 16,
        textAlignVertical: 'top',
        marginTop: 8,
    },
    error: { color: colors.danger },
    primary: { marginTop: 8, backgroundColor: colors.accent, borderRadius: 12, paddingVertical: 16, alignItems: 'center' },
    primaryText: { color: colors.accentInk, fontSize: 16, fontWeight: '700' },
    off: { opacity: 0.6 },
    small: { color: colors.muted, fontSize: 13, textAlign: 'center' },
});
