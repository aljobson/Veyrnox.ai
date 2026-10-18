import { Link, Stack, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useAuth } from '../../../auth/AuthProvider';
import { ApiError } from '../../../lib/api';
import { ASPECTS, approvePlan, briefProblem, minutesLeft, planMessage, requestPlan, type Aspect, type Plan } from '../../../lib/montage';
import { colors } from '../../../theme';

const MAX_BRIEF = 500;
// Errors after which the plan is spent or stale: the person goes back to the brief and plans again.
const REPLAN = new Set(['plan_expired', 'plan_price_changed', 'plan_invalid', 'plan_mismatch', 'plan_key_mismatch']);

export default function Agent() {
    const { api } = useAuth();
    const router = useRouter();
    const [brief, setBrief] = useState('');
    const [aspect, setAspect] = useState<Aspect>('9:16');
    const [plan, setPlan] = useState<Plan | null>(null);
    const [busy, setBusy] = useState<'planning' | 'approving' | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [now, setNow] = useState(Date.now());
    const [showLibrary, setShowLibrary] = useState(false);

    // Keeps "plan runs out in N minutes" current while the review is open.
    useEffect(() => {
        if (!plan) return;
        const timer = setInterval(() => setNow(Date.now()), 15000);
        return () => clearInterval(timer);
    }, [plan]);

    const left = plan ? minutesLeft(plan.expiresAt, now) : 0;
    const expired = !!plan && left === 0;
    const problem = briefProblem(brief);

    async function makePlan() {
        if (problem || busy) return;
        setBusy('planning');
        setError(null);
        setShowLibrary(false);
        try {
            setPlan(await requestPlan(api, brief, aspect));
            setNow(Date.now());
        } catch (err) {
            // No retry here: planning can cost the server a model call.
            setError(planMessage(err));
        } finally {
            setBusy(null);
        }
    }

    async function approve() {
        if (!plan || busy || expired) return;
        setBusy('approving');
        setError(null);
        try {
            const jobId = await approvePlan(api, plan, brief);
            // The job screen keeps watching even if the person leaves; the Library has it when it is done.
            router.replace({ pathname: '/job/[id]', params: { id: jobId } });
        } catch (err) {
            setError(planMessage(err));
            if (err instanceof ApiError && REPLAN.has(err.code)) setPlan(null);
            if (err instanceof ApiError && err.code === 'video_agent_in_progress') setShowLibrary(true);
        } finally {
            setBusy(null);
        }
    }

    return (
        <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={90}>
            <Stack.Screen options={{ title: 'Video from a brief' }} />
            <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
                {!plan ? (
                    <>
                        <Text style={styles.lead}>Describe the video you want. You will see a plan and the price first, and you are only charged when you approve it.</Text>
                        <TextInput
                            style={styles.brief}
                            value={brief}
                            onChangeText={setBrief}
                            placeholder="For example: a 30 second explainer about how bees make honey"
                            placeholderTextColor={colors.muted}
                            multiline
                            maxLength={MAX_BRIEF}
                            accessibilityLabel="Describe the video"
                        />
                        <View style={styles.chips}>
                            {ASPECTS.map((a) => (
                                <Pressable key={a} accessibilityRole="button" accessibilityState={{ selected: aspect === a }} style={[styles.chip, aspect === a && styles.chipOn]} onPress={() => setAspect(a)}>
                                    <Text style={[styles.chipText, aspect === a && styles.chipTextOn]}>{a}</Text>
                                </Pressable>
                            ))}
                        </View>
                        <Pressable accessibilityRole="button" disabled={!!problem || !!busy} style={[styles.button, (!!problem || !!busy) && styles.off]} onPress={makePlan}>
                            {busy === 'planning' ? <ActivityIndicator color={colors.accentInk} /> : <Text style={styles.buttonText}>Make a plan (free)</Text>}
                        </Pressable>
                    </>
                ) : (
                    <>
                        <Text style={styles.label}>Plan</Text>
                        <Text style={styles.summary}>{plan.summary}</Text>
                        <Text style={styles.meta}>
                            {plan.seconds ? `About ${plan.seconds} seconds. ` : ''}Format {plan.aspect}.
                        </Text>
                        <Text style={styles.price}>
                            Costs {plan.credits} {plan.credits === 1 ? 'credit' : 'credits'}. Refunded if it fails.
                        </Text>
                        <Text style={expired ? styles.error : styles.meta}>
                            {expired ? 'This plan ran out. Plan again; you were not charged.' : `This plan runs out in ${left} ${left === 1 ? 'minute' : 'minutes'}.`}
                        </Text>
                        <Pressable accessibilityRole="button" disabled={!!busy || expired} style={[styles.button, (!!busy || expired) && styles.off]} onPress={approve}>
                            {busy === 'approving' ? <ActivityIndicator color={colors.accentInk} /> : <Text style={styles.buttonText}>Approve and make it</Text>}
                        </Pressable>
                        <Pressable accessibilityRole="button" disabled={!!busy} style={styles.secondary} onPress={() => { setPlan(null); setError(null); }}>
                            <Text style={styles.secondaryText}>Change the brief</Text>
                        </Pressable>
                    </>
                )}
                {error ? <Text style={styles.error}>{error}</Text> : null}
                {showLibrary ? (
                    <Link href="/library" asChild>
                        <Pressable accessibilityRole="button" style={styles.secondary}>
                            <Text style={styles.secondaryText}>Open Library</Text>
                        </Pressable>
                    </Link>
                ) : null}
            </ScrollView>
        </KeyboardAvoidingView>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background },
    body: { padding: 16, gap: 14 },
    lead: { color: colors.body, fontSize: 15, lineHeight: 22 },
    brief: { color: colors.text, backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 12, padding: 14, fontSize: 16, minHeight: 140, textAlignVertical: 'top' },
    chips: { flexDirection: 'row', gap: 8 },
    chip: { paddingVertical: 8, paddingHorizontal: 16, borderRadius: 10, backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1 },
    chipOn: { backgroundColor: colors.accent, borderColor: colors.accent },
    chipText: { color: colors.body, fontWeight: '600' },
    chipTextOn: { color: colors.accentInk },
    label: { color: colors.muted, fontSize: 13, textTransform: 'uppercase' },
    summary: { color: colors.text, fontSize: 17, lineHeight: 24 },
    meta: { color: colors.muted },
    price: { color: colors.money, fontSize: 16 },
    button: { backgroundColor: colors.accent, borderRadius: 12, paddingVertical: 16, alignItems: 'center' },
    buttonText: { color: colors.accentInk, fontWeight: '700', fontSize: 16 },
    secondary: { borderColor: colors.border, borderWidth: 1, borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
    secondaryText: { color: colors.text, fontWeight: '600' },
    off: { opacity: 0.4 },
    error: { color: colors.danger },
});
