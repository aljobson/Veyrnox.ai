import * as Crypto from 'expo-crypto';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useAuth } from '../../../auth/AuthProvider';
import { touchTarget } from '../../../lib/a11y';
import { DETAILS_MAX, DETAILS_MIN, REPORT_CATEGORIES, commentsErrorKey, detailsOk, reportComment, type ReportCategory } from '../../../lib/cinemaComments';
import { t } from '../../../lib/i18n';
import { colors } from '../../../theme';

// Reports one Cinema comment to the operator, who acts for everyone. Blocking is separate and only hides it from you.
export default function ReportComment() {
    const { commentId } = useLocalSearchParams<{ commentId: string }>();
    const { api } = useAuth();
    const router = useRouter();
    const [category, setCategory] = useState<ReportCategory | null>(null);
    const [details, setDetails] = useState('');
    const [busy, setBusy] = useState(false);
    const [done, setDone] = useState(false);
    const [error, setError] = useState<string | null>(null);
    // One key for this report, so a retry after a network error is one report.
    const key = useRef(Crypto.randomUUID());

    const ready = !!category && detailsOk(details) && !!commentId;

    async function send() {
        if (!ready || busy || !category || !commentId) return;
        setBusy(true);
        setError(null);
        try {
            await reportComment(api, commentId, category, details, key.current);
            setDone(true);
        } catch (err) {
            setError(t(commentsErrorKey(err)));
        } finally {
            setBusy(false);
        }
    }

    return (
        <ScrollView style={styles.screen} contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
            <Stack.Screen options={{ title: t('comments.reportTitle') }} />
            {done ? (
                <>
                    <Text style={styles.ok} accessibilityRole="alert">{t('comments.reported')}</Text>
                    <Pressable accessibilityRole="button" style={[styles.button, touchTarget]} onPress={() => router.back()}>
                        <Text style={styles.buttonText}>{t('comments.done')}</Text>
                    </Pressable>
                </>
            ) : (
                <>
                    <Text style={styles.intro}>{t('comments.reportIntro')}</Text>
                    <View style={styles.chips}>
                        {REPORT_CATEGORIES.map((c) => (
                            <Pressable key={c.key} accessibilityRole="button" accessibilityState={{ selected: category === c.key }} style={[styles.chip, touchTarget, category === c.key && styles.chipOn]} onPress={() => setCategory(c.key)}>
                                <Text style={[styles.chipText, category === c.key && styles.chipTextOn]}>{t(`comments.cat.${c.key}`)}</Text>
                            </Pressable>
                        ))}
                    </View>
                    <TextInput
                        accessibilityLabel={t('comments.reportDetails')}
                        placeholder={t('comments.reportDetails')}
                        placeholderTextColor={colors.muted}
                        style={styles.input}
                        multiline
                        maxLength={DETAILS_MAX}
                        value={details}
                        onChangeText={setDetails}
                    />
                    <Text style={styles.muted}>{t('comments.reportCount', { min: DETAILS_MIN, left: DETAILS_MAX - [...details].length })}</Text>
                    {error ? <Text style={styles.error} accessibilityRole="alert">{error}</Text> : null}
                    <Pressable accessibilityRole="button" accessibilityState={{ busy, disabled: !ready || busy }} disabled={!ready || busy} style={[styles.button, touchTarget, (!ready || busy) && styles.off]} onPress={send}>
                        {busy ? <ActivityIndicator color={colors.accentInk} /> : <Text style={styles.buttonText}>{t('comments.send')}</Text>}
                    </Pressable>
                </>
            )}
        </ScrollView>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background },
    body: { padding: 16, gap: 12 },
    intro: { color: colors.body },
    chips: { gap: 8 },
    chip: { paddingHorizontal: 14, borderRadius: 10, backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, justifyContent: 'center' },
    chipOn: { backgroundColor: colors.accent, borderColor: colors.accent },
    chipText: { color: colors.body, fontSize: 16 },
    chipTextOn: { color: colors.accentInk, fontWeight: '600' },
    input: { minHeight: 110, color: colors.text, backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 12, padding: 12, textAlignVertical: 'top', fontSize: 16 },
    muted: { color: colors.muted, fontSize: 13 },
    button: { backgroundColor: colors.accent, borderRadius: 12, alignItems: 'center', justifyContent: 'center', paddingVertical: 14 },
    off: { opacity: 0.4 },
    buttonText: { color: colors.accentInk, fontWeight: '700', fontSize: 16 },
    ok: { color: colors.accent, fontSize: 16 },
    error: { color: colors.danger },
});
