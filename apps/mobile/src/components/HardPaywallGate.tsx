import { usePathname, useRouter } from 'expo-router';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import Purchases from 'react-native-purchases';
import { ActivityIndicator, Modal, Platform, ScrollView, View } from 'react-native';
import { useAuth } from '../auth/AuthProvider';
import { useBilling } from '../billing/BillingProvider';
import { useStorePurchase } from '../billing/useStorePurchase';
import { LEGAL_LINKS } from '../lib/account';
import { confirmSignOut } from '../lib/confirmSignOut';
import { gateTrialByEligibility, parseGenerationCatalog, renewalTerms, toDisplayPackages, type GenerationCatalogPlan } from '../lib/billing';
import { HARD_PAYWALL_STARTER_CREDITS, HARD_PAYWALL_STEP_COUNT, hardPaywallEnabled, hardPaywallState, hasIntroSteps, introTrialDays, isHardPaywallExempt, onLockedAttempt, setHardPaywallLocked } from '../lib/hardPaywall';
import { t } from '../lib/i18n';
import { Button, Text, themedStyles, useThemedStyles } from './ui';
import { PlanCards, initialCadence, type Cadence } from './credits/PlanCards';
import { VeyCharacter } from './VeyCharacter';

const ENABLED = hardPaywallEnabled();
// RevenueCat INTRO_ELIGIBILITY_STATUS_ELIGIBLE; the enum is not imported so a mocked SDK cannot break the screen.
const INTRO_ELIGIBLE = 2;

// ADR-0108 amendment 2: with the flag on, a signed-in person with no paid plan lands in the app and is shown this paywall,
// which they can close. Nothing that costs credits runs until they subscribe (guardPaidAction in the API client); trying
// one brings the paywall back.
export function HardPaywallGate({ children }: { children: ReactNode }) {
    const billing = useBilling();
    const pathname = usePathname();
    const [dismissed, setDismissed] = useState(false);
    const state = hardPaywallState({ enabled: ENABLED, paidAccess: billing.paidAccess, accessResolved: billing.accessResolved, billingStatus: billing.status });
    useEffect(() => { setHardPaywallLocked(state !== 'open'); return () => setHardPaywallLocked(false); }, [state]);
    useEffect(() => onLockedAttempt(() => setDismissed(false)), []);
    const show = state === 'locked' && !dismissed && !isHardPaywallExempt(pathname);
    return <>
        {children}
        {show ? <Modal animationType="slide" onRequestClose={() => setDismissed(true)}><LockedScreen checking={false} onClose={() => setDismissed(true)} /></Modal> : null}
    </>;
}

function LockedScreen({ checking, onClose }: { checking: boolean; onClose: () => void }) {
    const s = useThemedStyles(styles);
    const { api, signOut } = useAuth();
    const router = useRouter();
    const billing = useBilling();
    const purchase = useStorePurchase();
    const [cadenceChoice, setCadence] = useState<Cadence | null>(null);
    const [chosenId, setChosenId] = useState<string | null>(null);
    const [catalog, setCatalog] = useState<GenerationCatalogPlan[]>([]);
    const [step, setStep] = useState(1);
    useEffect(() => { void billing.refreshSales(); }, [billing.refreshSales]);
    useEffect(() => {
        let live = true;
        void api.request<unknown>('/api/credit-subscription-plans').then(v => { if (live) setCatalog(parseGenerationCatalog(v)); }).catch(() => {});
        return () => { live = false; };
    }, [api]);
    const packages = useMemo(() => (billing.offerings?.all.generation?.availablePackages ?? []).filter(pkg => pkg?.product), [billing.offerings]);
    const rawPlans = useMemo(() => toDisplayPackages(packages).filter(plan => plan.generationPlan !== null && plan.interval !== null), [packages]);
    const store = Platform.OS === 'ios' ? 'ios' : 'android';
    // iOS: the store says per Apple ID whether the introductory offer can still be used; until it says eligible, no trial is shown.
    const [eligible, setEligible] = useState<ReadonlySet<string> | null>(null);
    useEffect(() => {
        const ids = rawPlans.filter(plan => (plan.trialDays ?? 0) > 0).map(plan => plan.productId);
        if (store !== 'ios' || ids.length === 0 || typeof Purchases?.checkTrialOrIntroductoryPriceEligibility !== 'function') return;
        let live = true;
        Purchases.checkTrialOrIntroductoryPriceEligibility(ids).then(result => {
            if (live) setEligible(new Set(ids.filter(id => result[id]?.status === INTRO_ELIGIBLE)));
        }).catch(() => { if (live) setEligible(new Set()); });
        return () => { live = false; };
    }, [rawPlans, store]);
    const plans = useMemo(() => gateTrialByEligibility(rawPlans, store, eligible), [rawPlans, store, eligible]);
    const cadence = cadenceChoice ?? initialCadence(plans);
    const chosen = plans.find(plan => plan.id === chosenId && plan.interval === cadence)
        ?? plans.find(plan => plan.generationPlan === 'starter' && plan.interval === cadence)
        ?? plans.find(plan => plan.interval === cadence) ?? null;
    const noPlans = !checking && plans.length === 0;
    const trialDays = introTrialDays(plans, chosen);
    const intro = hasIntroSteps(trialDays, step);
    const stepValues = { days: trialDays, count: HARD_PAYWALL_STARTER_CREDITS, store: store === 'ios' ? 'App Store' : 'Google Play' };
    const canBuy = billing.canPurchase && billing.generationPurchaseReady && !!chosen && !purchase.busy;
    const message = purchase.operation.outcome?.kind === 'error' ? t('credits.error')
        : purchase.operation.outcome?.kind === 'cancelled' ? t('credits.cancelled')
        : purchase.operation.outcome?.kind === 'pending' ? t('credits.pending') : null;
    function buy() {
        const pkg = packages.find(item => item.identifier === chosen?.id);
        if (canBuy && pkg) purchase.start({ kind: 'plan', pkg });
    }
    const inTrial = trialDays > 0;
    return <ScrollView style={s.screen} contentContainerStyle={s.content} testID="hard-paywall">
        <Button variant="tertiary" label={t('credits.paywall.later')} onPress={onClose} />
        <View style={s.vey}><VeyCharacter width={120} interactive mood="wave" /></View>
        {inTrial ? <>
            <Text variant="footnote" tone="secondary" accessibilityLiveRegion="polite">{t('credits.hardPaywall.step', { current: step, total: HARD_PAYWALL_STEP_COUNT })}</Text>
            <Text variant="title1" accessibilityRole="header">{step === 1 ? t('credits.hardPaywall.step1.title', stepValues) : step === 2 ? t('credits.hardPaywall.step2.title', stepValues) : t('credits.hardPaywall.step3.title', stepValues)}</Text>
            <Text tone="secondary">{step === 1 ? t('credits.hardPaywall.step1.body', stepValues) : step === 2 ? t('credits.hardPaywall.step2.body', stepValues) : t('credits.hardPaywall.step3.body', stepValues)}</Text>
            {step === 1 ? <>
                <Text>{'✓  '}{t('credits.hardPaywall.step1.p1', stepValues)}</Text>
                <Text>{'✓  '}{t('credits.hardPaywall.step1.p2', stepValues)}</Text>
                <Text>{'✓  '}{t('credits.hardPaywall.step1.p3', stepValues)}</Text>
            </> : null}
            {step === 2 ? <>
                <Text>{'✓  '}{t('credits.hardPaywall.step2.p1', stepValues)}</Text>
                <Text>{'✓  '}{t('credits.hardPaywall.step2.p2', stepValues)}</Text>
            </> : null}
            {intro ? <>
                <Button label={t('credits.hardPaywall.continue')} onPress={() => setStep(n => n + 1)} />
                {step > 1 ? <Button variant="tertiary" label={t('credits.hardPaywall.back')} onPress={() => setStep(n => n - 1)} /> : null}
            </> : <Button variant="tertiary" label={t('credits.hardPaywall.back')} onPress={() => setStep(n => n - 1)} />}
        </> : <>
            <Text variant="title1" accessibilityRole="header">{t('credits.hardPaywall.title')}</Text>
            <Text tone="secondary">{t('credits.hardPaywall.bodyFree', { count: HARD_PAYWALL_STARTER_CREDITS })}</Text>
        </>}
        {checking ? <View style={s.row}><ActivityIndicator /><Text tone="secondary">{t('credits.hardPaywall.checking')}</Text></View> : null}
        {noPlans ? <>
            <Text tone="secondary">{t('credits.hardPaywall.unavailable')}</Text>
            <Button variant="secondary" label={t('credits.hardPaywall.retry')} onPress={() => { void billing.refreshSales(); void billing.refreshGenerationAccess(); }} />
        </> : null}
        {plans.length > 0 && !intro ? <>
            <PlanCards plans={plans} packs={[]} credits={new Map(catalog.map(plan => [plan.id, plan.credits]))}
                cadence={cadence} chosenId={chosen?.id} disabled={purchase.busy}
                onCadence={next => { setCadence(next); setChosenId(null); }} onChoose={setChosenId} />
            {chosen?.interval && (chosen.trialDays ?? 0) > 0 ? <Text variant="footnote">{t('credits.hardPaywall.trialTerms', { days: chosen.trialDays ?? 0, price: chosen.priceString, interval: t(chosen.interval === 'year' ? 'credits.paywall.year' : 'credits.paywall.month') })}</Text> : null}
            {chosen?.interval ? <Text variant="caption" tone="tertiary" accessibilityLanguage="en">{renewalTerms(chosen.interval, chosen.priceString, Platform.OS === 'ios' ? 'ios' : 'android')}</Text> : null}
            {!billing.canPurchase ? <Text variant="footnote" tone="secondary">{t('credits.notOpen')}</Text> : null}
            <Button label={chosen ? ((chosen.trialDays ?? 0) > 0 ? t('credits.hardPaywall.buyTrial', { days: chosen.trialDays ?? 0 }) : t('credits.paywall.buyPlan', { plan: chosen.generationPlan ?? '', price: chosen.priceString, period: t(chosen.interval === 'year' ? 'credits.paywall.year' : 'credits.paywall.month') })) : ''}
                disabled={!canBuy} onPress={buy} />
        </> : null}
        {message ? <Text tone="secondary">{message}</Text> : null}
        <View style={s.links}>
            {LEGAL_LINKS.slice(0, 2).map(item => <Button key={item.route} variant="tertiary" accessibilityRole="link" label={t(item.labelKey)} onPress={() => router.push(item.route)} />)}
            <Button variant="tertiary" label={t('credits.restore')} disabled={purchase.busy || !billing.canRestore} onPress={() => purchase.start({ kind: 'restore' })} />
        </View>
        <Button variant="tertiary" label={t('public.account.signOut')} onPress={() => confirmSignOut(signOut)} />
        <Button variant="tertiary" label={t('credits.hardPaywall.deleteAccount')} onPress={() => router.push('/delete-account')} />
    </ScrollView>;
}
const styles = themedStyles(p => ({
    screen: { flex: 1, backgroundColor: p.bg },
    content: { padding: 24, paddingTop: 64, gap: 12 },
    vey: { alignItems: 'center' }, row: { flexDirection: 'row', gap: 8, alignItems: 'center' },
    links: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center' },
}));
