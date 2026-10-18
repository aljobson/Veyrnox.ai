import { Stack } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useAuth } from '../../auth/AuthProvider';
import {
    MAX_STATEMENT,
    actionLabel,
    appealErrorMessage,
    canAppeal,
    fetchAppeals,
    statusLabel,
    submitAppeal,
    validateStatement,
    type AppealsState,
    type Sanction,
} from '../../lib/appeals';
import { entryDate } from '../../lib/creditHistory';
import { colors } from '../../theme';

export default function Appeals() {
    const { api } = useAuth();
    const [state, setState] = useState<AppealsState | null>(null);
    const [failed, setFailed] = useState(false);

    const load = useCallback(async () => {
        setFailed(false);
        try {
            setState(await fetchAppeals(api));
        } catch {
            setFailed(true);
        }
    }, [api]);

    useEffect(() => {
        void load();
    }, [load]);

    return (
        <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={90}>
            <Stack.Screen options={{ title: 'Content decisions' }} />
            <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
                <Text style={styles.body}>
                    Decisions we have made about content on your account under the Acceptable Use Policy. If you think one is wrong, appeal it. A person reviews every appeal and you will hear back by email. A removal that is reversed
                    stops counting against your account; deleted files cannot be restored.
                </Text>
                {failed ? (
                    <View style={styles.gap}>
                        <Text style={styles.error}>Your account record is unavailable right now.</Text>
                        <Pressable accessibilityRole="button" style={styles.secondary} onPress={() => void load()}>
                            <Text style={styles.secondaryText}>Try again</Text>
                        </Pressable>
                    </View>
                ) : state === null ? (
                    <ActivityIndicator color={colors.accent} />
                ) : (
                    <>
                        {state.holdUntil ? <Text style={styles.notice}>Generating is paused on your account until {entryDate(state.holdUntil)}. Your library, downloads and credits are unaffected.</Text> : null}
                        {state.sanctions.length === 0 ? <Text style={styles.muted}>Nothing has been recorded against your account.</Text> : null}
                        {state.sanctions.map((s) => (
                            <Decision key={s.actionId} sanction={s} onSent={load} />
                        ))}
                    </>
                )}
            </ScrollView>
        </KeyboardAvoidingView>
    );
}

function Decision({ sanction, onSent }: { sanction: Sanction; onSent: () => Promise<void> }) {
    const { api } = useAuth();
    const [open, setOpen] = useState(false);
    const [statement, setStatement] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const invalid = validateStatement(statement);

    async function send() {
        if (invalid || busy) return;
        setBusy(true);
        setError(null);
        try {
            await submitAppeal(api, sanction.actionId, statement);
            setOpen(false);
            await onSent();
        } catch (err) {
            setError(appealErrorMessage(err));
        } finally {
            setBusy(false);
        }
    }

    return (
        <View style={styles.card}>
            <Text style={styles.name}>{actionLabel(sanction.action)}</Text>
            <Text style={styles.muted}>{entryDate(sanction.createdAt)}</Text>
            {sanction.appealStatus ? <Text style={styles.status}>{statusLabel(sanction.appealStatus)}</Text> : null}
            {canAppeal(sanction) && !open ? (
                <Pressable accessibilityRole="button" style={styles.secondary} onPress={() => setOpen(true)}>
                    <Text style={styles.secondaryText}>Appeal this decision</Text>
                </Pressable>
            ) : null}
            {open ? (
                <View style={styles.gap}>
                    <TextInput
                        accessibilityLabel="Why do you think this decision was wrong"
                        multiline
                        maxLength={MAX_STATEMENT}
                        placeholder="Tell us why you think this decision was wrong"
                        placeholderTextColor={colors.muted}
                        style={styles.input}
                        value={statement}
                        onChangeText={setStatement}
                    />
                    <Text style={styles.muted}>You can appeal each decision once. Do not include other people&apos;s personal details.</Text>
                    {error ? <Text style={styles.error}>{error}</Text> : null}
                    <Pressable accessibilityRole="button" accessibilityState={{ disabled: Boolean(invalid) || busy }} disabled={Boolean(invalid) || busy} style={[styles.primary, (invalid || busy) && styles.off]} onPress={() => void send()}>
                        {busy ? <ActivityIndicator color={colors.accentInk} /> : <Text style={styles.primaryText}>Send appeal</Text>}
                    </Pressable>
                    <Pressable accessibilityRole="button" disabled={busy} style={styles.secondary} onPress={() => setOpen(false)}>
                        <Text style={styles.secondaryText}>Cancel</Text>
                    </Pressable>
                </View>
            ) : null}
        </View>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background },
    content: { padding: 16, gap: 14 },
    body: { color: colors.body, fontSize: 15, lineHeight: 22 },
    gap: { gap: 10 },
    notice: { color: colors.text, backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 12, padding: 14 },
    card: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 12, padding: 16, gap: 8 },
    name: { color: colors.text, fontSize: 17, fontWeight: '600' },
    muted: { color: colors.muted, fontSize: 13 },
    status: { color: colors.accent, fontWeight: '600' },
    input: { minHeight: 110, backgroundColor: colors.background, borderColor: colors.border, borderWidth: 1, borderRadius: 12, padding: 12, color: colors.text, fontSize: 16, textAlignVertical: 'top' },
    primary: { backgroundColor: colors.accent, borderRadius: 12, minHeight: 44, justifyContent: 'center', alignItems: 'center' },
    primaryText: { color: colors.accentInk, fontSize: 16, fontWeight: '700' },
    secondary: { borderColor: colors.border, borderWidth: 1, borderRadius: 12, minHeight: 44, justifyContent: 'center', alignItems: 'center' },
    secondaryText: { color: colors.text, fontWeight: '600' },
    off: { opacity: 0.5 },
    error: { color: colors.danger },
});
