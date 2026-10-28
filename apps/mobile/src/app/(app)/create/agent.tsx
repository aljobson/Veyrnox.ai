import { rawText } from '../../../lib/i18n/translate';
import { getCacheUser } from '../../../lib/appCache';
import { publishBalance } from '../../../lib/balanceEvents';
import { observe } from '../../../lib/network';
import { KeyboardFormScrollView } from '../../../components/KeyboardFormScrollView';
import { KeyboardScreen } from '../../../components/KeyboardScreen';
import { Link, Stack, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Platform, ScrollView, View } from 'react-native';
import { useAuth } from '../../../auth/AuthProvider';
import { ApiError } from '../../../lib/api';
import { MIN_TARGET } from '../../../lib/a11y';
import { splitSlots, t } from '../../../lib/i18n';
import { ASPECTS, videoAgentBalanceState, approvePlan, briefProblem, MAX_NARRATION_LENGTH, minutesLeft, normaliseNarration, planMessage, requestPlan, type Aspect, type Plan } from '../../../lib/montage';
import { useBalance } from '../../../lib/useBalance';
import { useAgentResume } from '../../../lib/useAgentResume';
import { useAnnouncement } from '../../../lib/useAnnouncement';
import { Text, TextField, Button, Card, Chip, themedStyles, useThemedStyles } from '../../../components/ui';
import { radius } from '../../../theme';

const MAX_BRIEF = 500;
const REPLAN = new Set(['plan_expired', 'plan_price_changed', 'plan_invalid', 'plan_mismatch', 'plan_key_mismatch']);
const STEPS = [1, 2, 3] as const;
const TIPS = [1, 2, 3, 4] as const;

export default function Agent() {
    const styles = useThemedStyles(sheets);
    const { api } = useAuth();
    const router = useRouter();
    const balance = useBalance();
    const resume = useAgentResume(api);
    const [brief, setBrief] = useState('');
    const [narration, setNarration] = useState('');
    const [aspect, setAspect] = useState<Aspect>('9:16');
    const [plan, setPlan] = useState<Plan | null>(null);
    const [busy, setBusy] = useState<'planning' | 'approving' | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [now, setNow] = useState(Date.now());
    const [showLibrary, setShowLibrary] = useState(false);
    const [retrying, setRetrying] = useState(false);
    useAnnouncement(resume.job && busy !== 'approving' ? t('agentResume.title') : null);

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
    const balanceState = videoAgentBalanceState(balance, plan?.credits ?? NaN);
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

    async function retryBalance() {
        if (retrying || busy) return;
        const owner = getCacheUser();
        setRetrying(true);
        try {
            const value = await observe(api.getBalance());
            if (owner && getCacheUser() === owner) publishBalance(owner, value.balance);
        } catch {
            // The unavailable state remains until a successful current-owner read.
        } finally { setRetrying(false); }
    }

    async function approve() {
        if (!plan || busy || expired || balanceState !== 'ready') return;
        setBusy('approving');
        setError(null);
        try {
            const jobId = await approvePlan(api, plan, brief);
            router.replace({ pathname: '/job/[id]', params: { id: jobId } });
        } catch (err) {
            setError(planMessage(err));
            if (err instanceof ApiError && REPLAN.has(err.code)) setPlan(null);
            if (err instanceof ApiError && err.code === 'video_agent_in_progress') { setShowLibrary(true); resume.check(); }
        } finally {
            setBusy(null);
        }
    }

    return (
        <KeyboardScreen style={styles.screen}>
            <Stack.Screen options={{ title: t('agent.videoAgent') }} />
            <KeyboardFormScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
                <View style={styles.hero}>
                    <Text variant="caption" style={styles.eyebrow}>{t('videoAgent.eyebrow')}</Text>
                    <Text variant="display" style={styles.title} accessibilityRole="header">{t('videoAgent.title')}</Text>
                    <Text variant="callout" style={styles.lead}>{t('videoAgent.intro')}</Text>
                </View>

                <View accessibilityLabel={t('videoAgent.how')} style={styles.steps}>
                    {STEPS.map((number) => (
                        <Card key={number} style={styles.step}>
                            <Text variant="caption" style={styles.stepNumber}>{t('videoAgent.step', { number: String(number) })}</Text>
                            <Text variant="callout" style={styles.stepTitle}>{t(`videoAgent.step${number}.title`)}</Text>
                            <Text variant="footnote" style={styles.stepBody}>{t(`videoAgent.step${number}.body`)}</Text>
                        </Card>
                    ))}
                </View>

                {resume.job && busy !== 'approving' ? (
                    <Card style={styles.card} accessibilityLiveRegion="polite">
                        <Text variant="title2" accessibilityRole="header">{t('agentResume.title')}</Text>
                        <Text>{t('agentResume.body')}</Text>
                        <Button label={t('agentResume.open')} onPress={() => router.push({ pathname: '/job/[id]', params: { id: resume.job!.jobId } })} />
                    </Card>
                ) : null}
                <Card style={styles.card}>
                    <View style={styles.labelRow}>
                        <Text variant="caption" style={styles.label}>{t('videoAgent.brief')}</Text>
                        <Text variant="caption" style={styles.count}>{brief.length}/{MAX_BRIEF}</Text>
                    </View>
                    <TextField
                        containerStyle={styles.inputGap}
                        style={[styles.input, styles.brief]}
                        value={brief}
                        onChangeText={changeBrief}
                        placeholder={t('videoAgent.briefPlaceholder')}

                        multiline
                        maxLength={MAX_BRIEF}
                        editable={!formDisabled}
                        accessibilityLabel={t('videoAgent.briefLabel')}
                    />

                    <View style={[styles.labelRow, styles.fieldGap]}>
                        <Text variant="callout" style={styles.fieldLabel}>{t('videoAgent.narration')}</Text>
                        <Text variant="caption" style={styles.count}>{narration.length}/{MAX_NARRATION_LENGTH}</Text>
                    </View>
                    <TextField
                        containerStyle={styles.inputGap}
                        style={[styles.input, styles.narration]}
                        value={narration}
                        onChangeText={changeNarration}
                        placeholder={t('videoAgent.narrationPlaceholder')}

                        multiline
                        maxLength={MAX_NARRATION_LENGTH}
                        editable={!formDisabled}
                        accessibilityLabel={t('videoAgent.narration')}
                    />
                    <Text variant="caption" style={styles.help}>{t('videoAgent.narrationHelp')}</Text>
                    {!narrationResult.ok ? <Text variant="caption" style={styles.inlineError} accessibilityRole="alert">{t('videoAgent.narrationLimit')}</Text> : null}

                    <Text variant="callout" style={[styles.fieldLabel, styles.fieldGap]}>{t('videoAgent.aspect')}</Text>
                    <View style={styles.actionRow} accessibilityRole="radiogroup" accessibilityLabel={t('videoAgent.aspect')}>
                        <View style={styles.chips}>
                            {ASPECTS.map((value) => (
                                <Chip key={value} accessibilityRole="radio" accessibilityState={{ selected: aspect === value }} disabled={formDisabled} onPress={() => changeAspect(value)} label={(value)} selected={aspect === value} />
                            ))}
                        </View>
                        <Button accessibilityRole="button" accessibilityLabel={rawText(t('agent.free', { value1: t('videoAgent.plan') }))} accessibilityState={{ busy: busy === 'planning' }}
                            disabled={!!problem || !narrationResult.ok || !!busy} onPress={() => void makePlan()}
                            variant={plan ? 'secondary' : 'primary'} loading={busy === 'planning'} label={plan ? t('videoAgent.replan') : t('videoAgent.plan')} />
                    </View>
                    <Text variant="caption" style={styles.help}>{t('videoAgent.free')}</Text>
                </Card>

                {error ? <Text variant="callout" style={styles.error} accessibilityRole="alert">{error}</Text> : null}

                {plan ? (
                    <Card style={styles.card}>
                        <Text variant="caption" style={styles.label}>{t('videoAgent.planEyebrow')}</Text>
                        <Text variant="callout" style={styles.summary}>{plan.summary}</Text>
                        <Text variant="caption" style={styles.meta}>{plan.seconds ? t('videoAgent.duration', { seconds: String(plan.seconds), aspect: plan.aspect }) : t('videoAgent.format', { aspect: plan.aspect })}</Text>
                        {plan.narrationText ? (
                            <View style={styles.narrationPreview} accessibilityLabel={t('videoAgent.narrationPreview')}>
                                <Text variant="callout" style={styles.stepTitle}>{t('videoAgent.narrationPreview')}</Text>
                                <Text variant="callout" style={styles.narrationWords}>{plan.narrationText}</Text>
                                <Text variant="caption" style={styles.help}>{t('videoAgent.narrationReview')}</Text>
                            </View>
                        ) : null}
                        <View style={styles.priceRow}>
                            <View style={styles.priceCopy}>
                                <Text variant="callout" style={styles.price}>
                                    {splitSlots(t('videoAgent.price'), ['credits', 'balance']).map((piece, index) => typeof piece === 'string' ? piece : (
                                        <Text key={index} variant="callout" tone={piece.slot === 'credits' ? 'warning' : 'secondary'}>
                                            {piece.slot === 'credits' ? String(plan.credits) : balance === null ? '—' : String(balance)}
                                        </Text>
                                    ))}
                                </Text>
                                <Text variant="caption" style={expired ? styles.inlineError : styles.expiry}>{expired ? t('videoAgent.expired') : t('videoAgent.expires', { minutes: String(left) })}</Text>
                            </View>
                            <Button accessibilityRole="button" accessibilityLabel={rawText(t('videoAgent.approve', { credits: String(plan.credits) }))} accessibilityState={{ busy: busy === 'approving' }}
                                disabled={!!busy || expired || balanceState !== 'ready'} onPress={() => void approve()} variant="primary"
                                loading={busy === 'approving'} textStyle={styles.approveText} label={t('videoAgent.approve', { credits: String(plan.credits) })} />
                        </View>
                        {balanceState === 'unavailable' ? (
                            <View>
                                <Text accessibilityLiveRegion="polite" variant="footnote">{t(retrying ? 'videoAgentBalance.checking' : 'videoAgentBalance.unavailable')}</Text>
                                <Button label={t('videoAgentBalance.retry')} disabled={retrying || !!busy} onPress={() => void retryBalance()} />
                            </View>
                        ) : null}
                        {balanceState === 'insufficient' ? (
                            <View style={styles.shortfall}>
                                <Text variant="footnote" style={styles.shortfallText}>{t('videoAgent.shortfall', { count: String(shortfall) })}</Text>
                                <Link href="/credits" asChild><Button accessibilityRole="link" containerStyle={styles.inlineLink} variant="tertiary" size="md" label={(t('videoAgent.buy'))}><Text variant="footnote" style={styles.inlineLinkText}>{t('videoAgent.buy')}</Text></Button></Link>
                            </View>
                        ) : null}
                        <Text variant="caption" style={styles.help}>{t('videoAgent.refund')}</Text>
                        <Button accessibilityRole="button" disabled={!!busy} containerStyle={styles.secondary} onPress={() => { setPlan(null); setError(null); }} variant="secondary" size="md" label={(t('videoAgent.change'))}>
                            <Text variant="callout" style={styles.secondaryText}>{t('videoAgent.change')}</Text>
                        </Button>
                    </Card>
                ) : null}

                {showLibrary ? (
                    <Link href="/library" asChild>
                        <Button accessibilityRole="button" containerStyle={styles.secondary} variant="secondary" size="md" label={(t('videoAgent.library'))}><Text variant="callout" style={styles.secondaryText}>{t('videoAgent.library')}</Text></Button>
                    </Link>
                ) : null}

                <Card style={[styles.card, styles.before]}>
                    <Text variant="title2" style={styles.beforeTitle}>{t('videoAgent.before')}</Text>
                    <Text variant="callout" style={styles.stepTitle}>{t('videoAgent.writing')}</Text>
                    <View style={styles.tips}>
                        {TIPS.map((number) => <Text variant="footnote" key={number} style={styles.tip}>• {t(`videoAgent.tip${number}`)}</Text>)}
                    </View>
                    <Text variant="callout" style={[styles.stepTitle, styles.helpHeading]}>{t('videoAgent.after')}</Text>
                    <Text variant="footnote" style={styles.stepBody}>{t('videoAgent.afterHelp')}</Text>
                    <Text variant="callout" style={[styles.stepTitle, styles.helpHeading]}>{t('videoAgent.money')}</Text>
                    <Text variant="footnote" style={styles.stepBody}>{t('videoAgent.moneyHelp')}</Text>
                </Card>
            </KeyboardFormScrollView>
        </KeyboardScreen>
    );
}

const sheets = themedStyles((p) => ({
    screen: { flex: 1, backgroundColor: p.bg },
    body: { paddingHorizontal: 16, paddingTop: 20, paddingBottom: 48, gap: 14 },
    hero: { gap: 7, marginBottom: 2 },
    eyebrow: { color: p.textTertiary },
    title: { color: p.textPrimary },
    lead: { color: p.textSecondary },
    steps: { gap: 8 },
    step: { borderRadius: 16, borderWidth: 1, borderColor: p.borderSubtle, backgroundColor: p.bgElevated1, padding: 14 },
    stepNumber: { color: p.accent },
    stepTitle: { color: p.textPrimary, marginTop: 4 },
    stepBody: { color: p.textTertiary, marginTop: 3 },
    card: { borderRadius: 20, borderWidth: 1, borderColor: p.borderSubtle, backgroundColor: p.bgElevated1, padding: 16 },
    labelRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
    label: { color: p.textTertiary },
    count: { color: p.textTertiary },
    input: { textAlignVertical: 'top' },
    inputGap: { marginTop: 8 },
    brief: { minHeight: 126 },
    narration: { minHeight: 92 },
    fieldGap: { marginTop: 16 },
    fieldLabel: { color: p.textPrimary },
    help: { color: p.textTertiary, marginTop: 8 },
    inlineError: { color: p.danger, marginTop: 8 },
    actionRow: { gap: 10, marginTop: 8 },
    chips: { flexDirection: 'row', gap: 7 },
    error: { color: p.danger, borderRadius: radius.md, borderWidth: 1, borderColor: p.danger, backgroundColor: p.bgElevated1, padding: 13 },
    summary: { color: p.textSecondary, marginTop: 9 },
    meta: { color: p.textTertiary, marginTop: 5 },
    narrationPreview: { borderRadius: radius.md, borderWidth: 1, borderColor: p.borderSubtle, backgroundColor: p.bg, padding: 12, marginTop: 13 },
    narrationWords: { color: p.textPrimary, marginTop: 7 },
    priceRow: { gap: 12, marginTop: 15 },
    priceCopy: { gap: 3 },
    approveText: { fontVariant: ['tabular-nums'] },
    price: { color: p.textSecondary, fontVariant: ['tabular-nums'] },
    expiry: { color: p.textTertiary },
    shortfall: { borderRadius: radius.md, borderWidth: 1, borderColor: p.borderSubtle, padding: 12, marginTop: 12 },
    shortfallText: { color: p.textPrimary },
    inlineLink: { minHeight: MIN_TARGET, alignSelf: 'flex-start', justifyContent: 'center' },
    inlineLinkText: { color: p.accent, textDecorationLine: 'underline' },
    secondary: { minHeight: MIN_TARGET, alignItems: 'center', justifyContent: 'center', marginTop: 12 },
    secondaryText: { color: p.textPrimary },
    before: { marginTop: 12 },
    beforeTitle: { color: p.textPrimary, marginBottom: 8 },
    tips: { gap: 5, marginTop: 7 },
    tip: { color: p.textSecondary },
    helpHeading: { marginTop: 16 },
}));
