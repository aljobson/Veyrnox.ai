import { t } from '../../lib/i18n';
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
            <Stack.Screen options={{ title: t('appeals.contentdecisions') }} />
            <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
                <Text style={styles.body}>{t('appeals.decisionswehavemadeaboutcontenton')}</Text>
                {failed ? (
                    <View style={styles.gap}>
                        <Text style={styles.error}>{t('appeals.youraccountrecordisunavailablerightnow')}</Text>
                        <Pressable accessibilityRole="button" style={styles.secondary} onPress={() => void load()}>
                            <Text style={styles.secondaryText}>{t('appeals.tryagain')}</Text>
                        </Pressable>
                    </View>
                ) : state === null ? (
                    <ActivityIndicator color={colors.accent} />
                ) : (
                    <>
                        {state.holdUntil ? <Text style={styles.notice}>{t('appeals.generatingispausedonyouraccountuntil', { value1: entryDate(state.holdUntil) })}</Text> : null}
                        {state.sanctions.length === 0 ? <Text style={styles.muted}>{t('appeals.nothinghasbeenrecordedagainstyouraccount')}</Text> : null}
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
                    <Text style={styles.secondaryText}>{t('appeals.appealthisdecision')}</Text>
                </Pressable>
            ) : null}
            {open ? (
                <View style={styles.gap}>
                    <TextInput
                        accessibilityLabel={t('appeals.whydoyouthinkthisdecisionwas')}
                        multiline
                        maxLength={MAX_STATEMENT}
                        placeholder={t('appeals.telluswhyyouthinkthisdecision')}
                        placeholderTextColor={colors.muted}
                        style={styles.input}
                        value={statement}
                        onChangeText={setStatement}
                    />
                    <Text style={styles.muted}>{t('appeals.youcanappealeachdecisiononceDo')}</Text>
                    {error ? <Text style={styles.error}>{error}</Text> : null}
                    <Pressable accessibilityRole="button" accessibilityState={{ disabled: Boolean(invalid) || busy }} disabled={Boolean(invalid) || busy} style={[styles.primary, (invalid || busy) && styles.off]} onPress={() => void send()}>
                        {busy ? <ActivityIndicator color={colors.accentInk} /> : <Text style={styles.primaryText}>{t('appeals.sendappeal')}</Text>}
                    </Pressable>
                    <Pressable accessibilityRole="button" disabled={busy} style={styles.secondary} onPress={() => setOpen(false)}>
                        <Text style={styles.secondaryText}>{t('appeals.cancel')}</Text>
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
    input: { minHeight: 110, backgroundColor: colors.background, borderColor: colors.borderStrong, borderWidth: 1, borderRadius: 12, padding: 12, color: colors.text, fontSize: 16, textAlignVertical: 'top' },
    primary: { backgroundColor: colors.accent, borderRadius: 12, minHeight: 44, justifyContent: 'center', alignItems: 'center' },
    primaryText: { color: colors.accentInk, fontSize: 16, fontWeight: '700' },
    secondary: { borderColor: colors.border, borderWidth: 1, borderRadius: 12, minHeight: 44, justifyContent: 'center', alignItems: 'center' },
    secondaryText: { color: colors.text, fontWeight: '600' },
    off: { opacity: 0.5 },
    error: { color: colors.danger },
});
