import { Link, Stack, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useAuth } from '../../../auth/AuthProvider';
import { ApiError } from '../../../lib/api';
import { MIN_TARGET } from '../../../lib/a11y';
import { t } from '../../../lib/i18n';
import { ASPECTS, approvePlan, briefProblem, MAX_NARRATION_LENGTH, minutesLeft, normaliseNarration, planMessage, requestPlan, type Aspect, type Plan } from '../../../lib/montage';
import { useBalance } from '../../../lib/useBalance';
import { colors, fonts, radius } from '../../../theme';

const MAX_BRIEF = 500;
const REPLAN = new Set(['plan_expired', 'plan_price_changed', 'plan_invalid', 'plan_mismatch', 'plan_key_mismatch']);
const STEPS = [1, 2, 3] as const;
const TIPS = [1, 2, 3, 4] as const;

export default function Agent() {
    const { api } = useAuth();
    const router = useRouter();
    const balance = useBalance();
    const [brief, setBrief] = useState('');
    const [narration, setNarration] = useState('');
    const [aspect, setAspect] = useState<Aspect>('9:16');
    const [plan, setPlan] = useState<Plan | null>(null);
    const [busy, setBusy] = useState<'planning' | 'approving' | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [now, setNow] = useState(Date.now());
    const [showLibrary, setShowLibrary] = useState(false);

    useEffect(() => {
        if (!plan) return;
        const timer = setInterval(() => setNow(Date.now()), 15000);
        return () => clearInterval(timer);
    }, [plan]);

    const left = plan ? minutesLeft(plan.expiresAt, now) : 0;
    const expired = !!plan && left === 0;
    const narrationResult = normaliseNarration(narration);
    const problem = briefProblem(brief);
    const shortfall = plan && balance !== null ? Math.max(0, plan.credits - balance) : 0;
    const formDisabled = busy === 'approving';

    function changeBrief(value: string) {
        setBrief(value);
        setPlan(null);
        setError(null);
    }

    function changeNarration(value: string) {
        setNarration(value);
        setPlan(null);
        setError(null);
    }

    function changeAspect(value: Aspect) {
        setAspect(value);
        setPlan(null);
        setError(null);
    }

    async function makePlan() {
        if (problem || !narrationResult.ok || busy) return;
        setBusy('planning');
        setError(null);
        setShowLibrary(false);
        try {
            setPlan(await requestPlan(api, brief, aspect, narration));
            setNow(Date.now());
        } catch (err) {
            setError(planMessage(err));
        } finally {
            setBusy(null);
        }
    }

    async function approve() {
        if (!plan || busy || expired || shortfall > 0) return;
        setBusy('approving');
        setError(null);
        try {
            const jobId = await approvePlan(api, plan, brief);
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
        <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={88}>
            <Stack.Screen options={{ title: 'Video Agent' }} />
            <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
                <View style={styles.hero}>
                    <Text style={styles.eyebrow}>{t('videoAgent.eyebrow')}</Text>
                    <Text style={styles.title} accessibilityRole="header">{t('videoAgent.title')}</Text>
                    <Text style={styles.lead}>{t('videoAgent.intro')}</Text>
                </View>

                <View accessibilityLabel={t('videoAgent.how')} style={styles.steps}>
                    {STEPS.map((number) => (
                        <View key={number} style={styles.step}>
                            <Text style={styles.stepNumber}>{t('videoAgent.step', { number: String(number) })}</Text>
                            <Text style={styles.stepTitle}>{t(`videoAgent.step${number}.title`)}</Text>
                            <Text style={styles.stepBody}>{t(`videoAgent.step${number}.body`)}</Text>
                        </View>
                    ))}
                </View>

                <View style={styles.card}>
                    <View style={styles.labelRow}>
                        <Text style={styles.label}>{t('videoAgent.brief')}</Text>
                        <Text style={styles.count}>{brief.length}/{MAX_BRIEF}</Text>
                    </View>
                    <TextInput
                        style={[styles.input, styles.brief]}
                        value={brief}
                        onChangeText={changeBrief}
                        placeholder={t('videoAgent.briefPlaceholder')}
                        placeholderTextColor={colors.muted}
                        multiline
                        maxLength={MAX_BRIEF}
                        editable={!formDisabled}
                        accessibilityLabel={t('videoAgent.briefLabel')}
                    />

                    <View style={[styles.labelRow, styles.fieldGap]}>
                        <Text style={styles.fieldLabel}>{t('videoAgent.narration')}</Text>
                        <Text style={styles.count}>{narration.length}/{MAX_NARRATION_LENGTH}</Text>
                    </View>
                    <TextInput
                        style={[styles.input, styles.narration]}
                        value={narration}
                        onChangeText={changeNarration}
                        placeholder={t('videoAgent.narrationPlaceholder')}
                        placeholderTextColor={colors.muted}
                        multiline
                        maxLength={MAX_NARRATION_LENGTH}
                        editable={!formDisabled}
                        accessibilityLabel={t('videoAgent.narration')}
                    />
                    <Text style={styles.help}>{t('videoAgent.narrationHelp')}</Text>
                    {!narrationResult.ok ? <Text style={styles.inlineError} accessibilityRole="alert">{t('videoAgent.narrationLimit')}</Text> : null}

                    <Text style={[styles.fieldLabel, styles.fieldGap]}>{t('videoAgent.aspect')}</Text>
                    <View style={styles.actionRow} accessibilityRole="radiogroup" accessibilityLabel={t('videoAgent.aspect')}>
                        <View style={styles.chips}>
                            {ASPECTS.map((value) => (
                                <Pressable key={value} accessibilityRole="radio" accessibilityState={{ selected: aspect === value }} disabled={formDisabled} style={[styles.chip, aspect === value && styles.chipOn]} onPress={() => changeAspect(value)}>
                                    <Text style={[styles.chipText, aspect === value && styles.chipTextOn]}>{value}</Text>
                                </Pressable>
                            ))}
                        </View>
                        <Pressable accessibilityRole="button" accessibilityLabel={`${t('videoAgent.plan')}, free`} accessibilityState={{ busy: busy === 'planning' }} disabled={!!problem || !narrationResult.ok || !!busy} style={[styles.planButton, (!!problem || !narrationResult.ok || !!busy) && styles.off]} onPress={() => void makePlan()}>
                            {busy === 'planning' ? <ActivityIndicator color={colors.accentInk} /> : <Text style={styles.planButtonText}>{plan ? t('videoAgent.replan') : t('videoAgent.plan')}</Text>}
                        </Pressable>
                    </View>
                    <Text style={styles.help}>{t('videoAgent.free')}</Text>
                </View>

                {error ? <Text style={styles.error} accessibilityRole="alert">{error}</Text> : null}

                {plan ? (
                    <View style={styles.card}>
                        <Text style={styles.label}>{t('videoAgent.planEyebrow')}</Text>
                        <Text style={styles.summary}>{plan.summary}</Text>
                        <Text style={styles.meta}>{plan.seconds ? t('videoAgent.duration', { seconds: String(plan.seconds), aspect: plan.aspect }) : t('videoAgent.format', { aspect: plan.aspect })}</Text>
                        {plan.narrationText ? (
                            <View style={styles.narrationPreview} accessibilityLabel={t('videoAgent.narrationPreview')}>
                                <Text style={styles.stepTitle}>{t('videoAgent.narrationPreview')}</Text>
                                <Text style={styles.narrationWords}>{plan.narrationText}</Text>
                                <Text style={styles.help}>{t('videoAgent.narrationReview')}</Text>
                            </View>
                        ) : null}
                        <View style={styles.priceRow}>
                            <View style={styles.priceCopy}>
                                <Text style={styles.price}>{t('videoAgent.price', { credits: String(plan.credits), balance: balance === null ? '—' : String(balance) })}</Text>
                                <Text style={expired ? styles.inlineError : styles.expiry}>{expired ? t('videoAgent.expired') : t('videoAgent.expires', { minutes: String(left) })}</Text>
                            </View>
                            <Pressable accessibilityRole="button" accessibilityLabel={t('videoAgent.approve', { credits: String(plan.credits) })} accessibilityState={{ busy: busy === 'approving' }} disabled={!!busy || expired || shortfall > 0} style={[styles.approveButton, (!!busy || expired || shortfall > 0) && styles.off]} onPress={() => void approve()}>
                                {busy === 'approving' ? <ActivityIndicator color={colors.accentInk} /> : <Text style={styles.planButtonText}>{t('videoAgent.approve', { credits: String(plan.credits) })}</Text>}
                            </Pressable>
                        </View>
                        {shortfall > 0 ? (
                            <View style={styles.shortfall}>
                                <Text style={styles.shortfallText}>{t('videoAgent.shortfall', { count: String(shortfall) })}</Text>
                                <Link href="/credits" asChild><Pressable accessibilityRole="link" style={styles.inlineLink}><Text style={styles.inlineLinkText}>{t('videoAgent.buy')}</Text></Pressable></Link>
                            </View>
                        ) : null}
                        <Text style={styles.help}>{t('videoAgent.refund')}</Text>
                        <Pressable accessibilityRole="button" disabled={!!busy} style={styles.secondary} onPress={() => { setPlan(null); setError(null); }}>
                            <Text style={styles.secondaryText}>{t('videoAgent.change')}</Text>
                        </Pressable>
                    </View>
                ) : null}

                {showLibrary ? (
                    <Link href="/library" asChild>
                        <Pressable accessibilityRole="button" style={styles.secondary}><Text style={styles.secondaryText}>{t('videoAgent.library')}</Text></Pressable>
                    </Link>
                ) : null}

                <View style={[styles.card, styles.before]}>
                    <Text style={styles.beforeTitle}>{t('videoAgent.before')}</Text>
                    <Text style={styles.stepTitle}>{t('videoAgent.writing')}</Text>
                    <View style={styles.tips}>
                        {TIPS.map((number) => <Text key={number} style={styles.tip}>• {t(`videoAgent.tip${number}`)}</Text>)}
                    </View>
                    <Text style={[styles.stepTitle, styles.helpHeading]}>{t('videoAgent.after')}</Text>
                    <Text style={styles.stepBody}>{t('videoAgent.afterHelp')}</Text>
                    <Text style={[styles.stepTitle, styles.helpHeading]}>{t('videoAgent.money')}</Text>
                    <Text style={styles.stepBody}>{t('videoAgent.moneyHelp')}</Text>
                </View>
            </ScrollView>
        </KeyboardAvoidingView>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background },
    body: { paddingHorizontal: 16, paddingTop: 20, paddingBottom: 48, gap: 14 },
    hero: { gap: 7, marginBottom: 2 },
    eyebrow: { color: colors.muted, fontSize: 11, lineHeight: 16, fontWeight: '800', letterSpacing: 1.4 },
    title: { color: colors.text, fontFamily: fonts.displayHeavy, fontSize: 32, lineHeight: 35, letterSpacing: -1 },
    lead: { color: colors.body, fontSize: 15, lineHeight: 22 },
    steps: { gap: 8 },
    step: { borderRadius: 16, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, padding: 14 },
    stepNumber: { color: colors.accent, fontSize: 11, lineHeight: 15, fontWeight: '800', letterSpacing: 1.2 },
    stepTitle: { color: colors.text, fontSize: 15, lineHeight: 20, fontWeight: '700', marginTop: 4 },
    stepBody: { color: colors.muted, fontSize: 13, lineHeight: 19, marginTop: 3 },
    card: { borderRadius: 20, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, padding: 16 },
    labelRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
    label: { color: colors.muted, fontSize: 11, lineHeight: 16, fontWeight: '800', letterSpacing: 1.35 },
    count: { color: colors.muted, fontSize: 11, lineHeight: 16 },
    input: { color: colors.text, backgroundColor: colors.background, borderColor: colors.border, borderWidth: 1, borderRadius: radius.lg, padding: 13, fontSize: 16, lineHeight: 22, textAlignVertical: 'top' },
    brief: { minHeight: 126, marginTop: 8 },
    narration: { minHeight: 92, marginTop: 8 },
    fieldGap: { marginTop: 16 },
    fieldLabel: { color: colors.text, fontSize: 14, lineHeight: 19, fontWeight: '700' },
    help: { color: colors.muted, fontSize: 12, lineHeight: 17, marginTop: 8 },
    inlineError: { color: colors.danger, fontSize: 12, lineHeight: 17, marginTop: 8 },
    actionRow: { gap: 10, marginTop: 8 },
    chips: { flexDirection: 'row', gap: 7 },
    chip: { minHeight: MIN_TARGET, justifyContent: 'center', paddingHorizontal: 14, borderRadius: radius.md, backgroundColor: colors.background, borderColor: colors.border, borderWidth: 1 },
    chipOn: { backgroundColor: colors.accentSoft, borderColor: colors.accent },
    chipText: { color: colors.muted, fontSize: 13, fontWeight: '700' },
    chipTextOn: { color: colors.accent },
    planButton: { minHeight: MIN_TARGET, alignItems: 'center', justifyContent: 'center', borderRadius: radius.md, backgroundColor: colors.accent, paddingHorizontal: 16 },
    planButtonText: { color: colors.accentInk, fontSize: 14, fontWeight: '800', textAlign: 'center' },
    off: { opacity: 0.42 },
    error: { color: colors.danger, borderRadius: radius.md, borderWidth: 1, borderColor: colors.danger, backgroundColor: colors.surface, padding: 13, fontSize: 14, lineHeight: 20 },
    summary: { color: colors.body, fontSize: 15, lineHeight: 22, marginTop: 9 },
    meta: { color: colors.muted, fontSize: 12, lineHeight: 17, marginTop: 5 },
    narrationPreview: { borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.background, padding: 12, marginTop: 13 },
    narrationWords: { color: colors.text, fontSize: 15, lineHeight: 22, marginTop: 7 },
    priceRow: { gap: 12, marginTop: 15 },
    priceCopy: { gap: 3 },
    price: { color: colors.money, fontSize: 14, lineHeight: 20, fontWeight: '800' },
    expiry: { color: colors.muted, fontSize: 12, lineHeight: 17 },
    approveButton: { minHeight: MIN_TARGET, alignItems: 'center', justifyContent: 'center', borderRadius: radius.md, backgroundColor: colors.accent, paddingHorizontal: 16 },
    shortfall: { borderRadius: radius.md, borderWidth: 1, borderColor: colors.money, padding: 12, marginTop: 12 },
    shortfallText: { color: colors.text, fontSize: 13, lineHeight: 19 },
    inlineLink: { minHeight: MIN_TARGET, alignSelf: 'flex-start', justifyContent: 'center' },
    inlineLinkText: { color: colors.accent, fontSize: 13, fontWeight: '700', textDecorationLine: 'underline' },
    secondary: { minHeight: MIN_TARGET, borderColor: colors.borderStrong, borderWidth: 1, borderRadius: radius.md, paddingHorizontal: 14, alignItems: 'center', justifyContent: 'center', marginTop: 12 },
    secondaryText: { color: colors.text, fontSize: 14, fontWeight: '700' },
    before: { marginTop: 12 },
    beforeTitle: { color: colors.text, fontFamily: fonts.display, fontSize: 22, lineHeight: 27, marginBottom: 8 },
    tips: { gap: 5, marginTop: 7 },
    tip: { color: colors.body, fontSize: 13, lineHeight: 19 },
    helpHeading: { marginTop: 16 },
});
