import { useEffect, useMemo, useRef, useState } from 'react';
import { Modal, Platform, ScrollView, View, useWindowDimensions } from 'react-native';
import { useAuth } from '../../auth/AuthProvider';
import { useBilling } from '../../billing/BillingProvider';
import { useStorePurchase } from '../../billing/useStorePurchase';
import { getPurchaseSnapshot, type PurchaseRequest } from '../../billing/storePurchaseStore';
import { LEGAL_LINKS } from '../../lib/account';
import { isWebParityPack, parseGenerationCatalog, renewalTerms, toDisplayPackages, type GenerationCatalogPlan } from '../../lib/billing';
import { bestPackId, packSavingPercent, planName, typicalCosts } from '../../lib/creditOffers';
import { fetchCatalog } from '../../lib/media';
import { t } from '../../lib/i18n';
import type { PaywallReason } from '../../lib/paywallPrompt';
import { Button, Text, themedStyles, useThemedStyles } from '../ui';
import { VeyCharacter } from '../VeyCharacter';
import { VeyCardPeek } from '../VeyCardPeek';
import { PackCard, PackTaxNote } from '../credits/PackCard';
import { PlanCards, initialCadence, type Cadence } from '../credits/PlanCards';
import { usePaywallFeedback } from './PaywallFeedback';

export function PaywallSheet({ reason, onClose, onOptions, onLegal }: {
    reason: PaywallReason; onClose: () => void; onOptions: () => void; onLegal: (index: number) => void;
}) {
    const s = useThemedStyles(sheets);
    const { height } = useWindowDimensions();
    const { api } = useAuth();
    const billing = useBilling();
    const purchase = useStorePurchase();
    const [observedOpId, setObservedOpId] = useState<number | null>(null);
    const observed = useRef<number | null>(null);
    const outcome = purchase.operation.opId === observedOpId ? purchase.operation.outcome : null;
    const feedback = usePaywallFeedback(reason, outcome, purchase.busy, onClose);
    const [mode, setMode] = useState<'packs' | 'plans'>('packs');
    const [chosenId, setChosenId] = useState<string | null>(null);
    const [chosenPlanId, setChosenPlanId] = useState<string | null>(null);
    const [cadenceChoice, setCadence] = useState<Cadence | null>(null);
    const [catalog, setCatalog] = useState<GenerationCatalogPlan[]>([]);
    const [costs, setCosts] = useState<ReturnType<typeof typicalCosts> | null>(null);
    useEffect(() => { void billing.refreshSales(); }, [billing.refreshSales]);
    useEffect(() => {
        let live = true;
        void api.request<unknown>('/api/credit-subscription-plans').then(value => { if (live) setCatalog(parseGenerationCatalog(value)); }).catch(() => {});
        void fetchCatalog().then(models => { if (live) setCosts(typicalCosts(models)); }).catch(() => {});
        return () => { live = false; if (observed.current !== null) purchase.abortPreparing(observed.current); };
    }, [api, purchase.abortPreparing]);
    const packPackages = useMemo(() => (billing.offerings?.all.credits?.availablePackages ?? []).filter(pkg => pkg?.product), [billing.offerings]);
    const planPackages = useMemo(() => (billing.offerings?.all.generation?.availablePackages ?? []).filter(pkg => pkg?.product), [billing.offerings]);
    const packs = useMemo(() => toDisplayPackages(packPackages).filter(isWebParityPack), [packPackages]);
    const plans = useMemo(() => toDisplayPackages(planPackages).filter(plan => plan.generationPlan !== null && plan.interval !== null), [planPackages]);
    const subscriptionsOpen = billing.status === 'ready' && plans.length > 0;
    const showToggle = subscriptionsOpen && !billing.paidAccess;
    const showingPlans = showToggle && (mode === 'plans' || packs.length === 0);
    const hasProducts = billing.status === 'ready' && (packs.length > 0 || showToggle);
    const cadence = cadenceChoice ?? initialCadence(plans);
    const chosenPack = packs.find(pack => pack.id === chosenId) ?? packs.find(pack => pack.id === bestPackId(packs)) ?? packs[0];
    const chosenPlan = plans.find(plan => plan.id === chosenPlanId && plan.interval === cadence)
        ?? (cadenceChoice === null ? plans.find(plan => plan.generationPlan === 'starter' && plan.interval === cadence) ?? plans.find(plan => plan.interval === cadence) : null);
    const nativeBusy = purchase.operation.phase === 'store';
    const selected = showingPlans ? chosenPlan : chosenPack;
    const canBuy = billing.canPurchase && (!showingPlans || billing.generationPurchaseReady) && !!selected && !purchase.busy;
    const copy = {
        first: { title: t('credits.paywall.firstTitle'), body: t('credits.paywall.firstBody') },
        low: { title: t('credits.paywall.lowTitle'), body: t('credits.paywall.lowBody') },
        depleted: { title: t('credits.paywall.emptyTitle'), body: t('credits.paywall.emptyBody') },
    }[reason];
    const primaryLabel = showingPlans ? t('credits.paywall.buyPlan', { plan: planName(chosenPlan?.generationPlan ?? ''),
        price: chosenPlan?.priceString ?? '', period: t(chosenPlan?.interval === 'year' ? 'credits.paywall.year' : 'credits.paywall.month') })
        : t('credits.paywall.buyPack', { credits: chosenPack?.credits ?? 0, price: chosenPack?.priceString ?? '' });
    function start(request: PurchaseRequest) {
        const started = purchase.start(request);
        if (typeof started === 'string') return;
        observed.current = started.opId; setObservedOpId(started.opId);
    }
    function buy() {
        if (!canBuy) return;
        if (showingPlans) {
            const pkg = planPackages.find(item => item.identifier === chosenPlan?.id);
            if (pkg) start({ kind: 'plan', pkg });
        } else {
            const pkg = packPackages.find(item => item.identifier === chosenPack?.id);
            if (pkg && chosenPack?.credits) start({ kind: 'pack', pkg, expectedCredits: chosenPack.credits });
        }
    }
    function choose(action: () => void) {
        const phase = getPurchaseSnapshot().phase;
        if (phase !== 'idle' && phase !== 'done') return;
        action(); feedback.choose();
    }
    return <Modal transparent visible animationType={feedback.still ? 'none' : 'fade'} onRequestClose={onClose}>
        <View style={s.backdrop} onAccessibilityEscape={onClose}>
            <View style={s.card} accessibilityViewIsModal>
                <ScrollView style={s.scroll} contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
                    <View style={s.vey} pointerEvents={nativeBusy ? 'none' : 'auto'} accessibilityElementsHidden={nativeBusy} importantForAccessibility={nativeBusy ? 'no-hide-descendants' : 'auto'}>
                        <VeyCharacter width={120} interactive={!nativeBusy} mood={feedback.mood} />
                    </View>
                    <Text variant="title1" accessibilityRole="header">{copy.title}</Text>
                    {!(showingPlans && reason === 'depleted') ? <Text tone="secondary">{copy.body}</Text> : null}
                    {hasProducts ? <>
                        {showToggle ? <View style={s.toggle} accessibilityRole="tablist">
                            {(['packs', 'plans'] as const).map(value => <Button key={value} variant={showingPlans === (value === 'plans') ? 'primary' : 'secondary'}
                                accessibilityRole="tab" accessibilityState={{ selected: showingPlans === (value === 'plans'), disabled: purchase.busy }}
                                disabled={purchase.busy} containerStyle={s.tab} label={t(value === 'packs' ? 'credits.paywall.packTab' : 'credits.paywall.planTab')}
                                onPress={() => choose(() => setMode(value))} />)}
                        </View> : null}
                        {showingPlans ? <>
                            <PlanCards plans={plans} packs={packs} credits={new Map(catalog.map(plan => [plan.id, plan.credits]))}
                                cadence={cadence} chosenId={chosenPlan?.id} disabled={purchase.busy}
                                onCadence={next => choose(() => { setCadence(next); setChosenPlanId(null); })}
                                onChoose={id => choose(() => setChosenPlanId(id))} />
                            {chosenPlan?.interval ? <Text variant="caption" tone="tertiary" accessibilityLanguage="en">{renewalTerms(chosenPlan.interval, chosenPlan.priceString, Platform.OS === 'ios' ? 'ios' : 'android')}</Text> : null}
                        </> : <>
                            {packs.map(pack => <PackCard key={pack.id} compact selectionMode="radio" selected={pack.id === chosenPack?.id}
                                pack={pack} best={pack.id === bestPackId(packs)} saving={packSavingPercent(pack, packs)} costs={costs}
                                disabled={purchase.busy} onPress={() => choose(() => setChosenId(pack.id))}>
                                {pack.id === chosenPack?.id ? <VeyCardPeek /> : null}
                            </PackCard>)}
                            <Text variant="caption" tone="tertiary">{t('credits.paywall.packsNeverExpire')}</Text>
                        </>}
                    </> : null}
                    {feedback.message ? <Text tone={outcome?.kind === 'error' ? 'danger' : 'secondary'}>{feedback.message}</Text> : null}
                </ScrollView>
                <View style={s.footer}>
                    {hasProducts ? <>
                        {!billing.canPurchase ? <Text variant="footnote" tone="secondary">{t('credits.notOpen')}</Text> : null}
                        <Button label={primaryLabel} disabled={!canBuy} onPress={buy} />
                    </> : null}
                    <ScrollView style={{ maxHeight: height * 0.3 }} contentContainerStyle={s.actions}>
                        <Button variant="secondary" label={t('credits.paywall.allOptions')} disabled={nativeBusy} onPress={onOptions} />
                        <Button variant="tertiary" label={t('credits.paywall.later')} accessibilityState={{ busy: nativeBusy }} disabled={nativeBusy} onPress={onClose} />
                        {hasProducts ? <>
                            <View style={s.legal}>
                                {LEGAL_LINKS.slice(0, 2).map((item, index) => <Button key={item.route} variant="tertiary" accessibilityRole="link"
                                    label={t(item.labelKey)} disabled={nativeBusy} onPress={() => onLegal(index)} />)}
                                <Button variant="tertiary" label={t('credits.restore')} disabled={purchase.busy || !billing.canRestore} onPress={() => start({ kind: 'restore' })} />
                            </View>
                            <PackTaxNote />
                        </> : null}
                    </ScrollView>
                </View>
            </View>
        </View>
    </Modal>;
}
const sheets = themedStyles(p => ({
    backdrop: { flex: 1, justifyContent: 'center', padding: 16, backgroundColor: p.scrim },
    card: { maxHeight: '95%', flexShrink: 1, borderRadius: 20, borderWidth: 1, borderColor: p.borderSubtle, backgroundColor: p.bgElevated1, overflow: 'hidden' },
    scroll: { flexShrink: 1 }, content: { padding: 16, gap: 12 }, vey: { alignItems: 'center' },
    footer: { padding: 12, gap: 4, borderTopWidth: 1, borderColor: p.borderSubtle },
    toggle: { flexDirection: 'row', gap: 8 }, tab: { flex: 1 },
    actions: { gap: 4 },
    legal: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center' },
}));
