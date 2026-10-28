import { router } from 'expo-router';
import { Text, Button, themedStyles, useThemedStyles } from '../../components/ui';
import * as WebBrowser from 'expo-web-browser';
import { Link, Stack, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Platform, ScrollView, View } from 'react-native';
import { useAuth } from '../../auth/AuthProvider';
import { useBilling } from '../../billing/BillingProvider';
import { LEGAL_LINKS } from '../../lib/account';
import {
    isWebParityPack,
    parseGenerationCatalog,
    renewalTerms,
    toDisplayPackages,
    waitForBalanceChange,
    type GenerationCatalogPlan,
} from '../../lib/billing';
import { t } from '../../lib/i18n';
import { ds } from '../../theme';
import { VeyCardPeek } from '../../components/VeyCardPeek';
import { BalanceCard } from '../../components/credits/BalanceCard';
import { CheckInEntry } from '../../components/credits/CheckInEntry';
import { PackCard, PackTaxNote } from '../../components/credits/PackCard';
import { PlanCards, initialCadence, type Cadence } from '../../components/credits/PlanCards';
import { CurrentPlanCard } from '../../components/credits/CurrentPlanCard';
import { useBalanceDetails } from '../../lib/useBalance';
import { getCacheUser, subscribeCacheUser } from '../../lib/appCache';
import { publishBalance } from '../../lib/balanceEvents';
import { bestPackId, packSavingPercent, typicalCosts } from '../../lib/creditOffers';
import { fetchCatalog } from '../../lib/media';
import { ApiError } from '../../lib/api';
import { cancelSubscription, creditsRemoved, readSubscription, subscriptionErrorKey, visibleSubscription, type CancelMode, type CreditSubscription } from '../../lib/creditSubscription';

type Outcome =
    | { kind: 'credited'; balance: number }
    | { kind: 'subscribed' }
    | { kind: 'restored' }
    | { kind: 'nothingToRestore' }
    | { kind: 'cancelled' }
    | { kind: 'pending' }
    | { kind: 'error' }
    | null;

const store = Platform.OS === 'ios' ? 'ios' : 'android';

export default function Credits() {
    const styles = useThemedStyles(sheets);
    const { api } = useAuth();
    const billing = useBilling();
    const [catalog, setCatalog] = useState<GenerationCatalogPlan[]>([]);
    const [busyId, setBusyId] = useState<string | null>(null);
    const [outcome, setOutcome] = useState<Outcome>(null);
    const [chosenId, setChosenId] = useState<string | null>(null);
    const [chosenPlanId, setChosenPlanId] = useState<string | null>(null);
    const [cadenceChoice, setCadence] = useState<Cadence | null>(null);
    const balance = useBalanceDetails();
    const [owner, setOwner] = useState(getCacheUser());
    const [subscription, setSubscription] = useState<CreditSubscription | null>(null);
    const [subscriptionFailed, setSubscriptionFailed] = useState(false);
    const [storeIds, setStoreIds] = useState<string[]>([]);
    const [missingIds, setMissingIds] = useState<string[]>([]);
    const [cancelMessage, setCancelMessage] = useState<string | null>(null);
    const [retryCancellation, setRetryCancellation] = useState(false);
    const [costs, setCosts] = useState<ReturnType<typeof typicalCosts> | null>(null);
    const subscriptionRevision = useRef(0);
    useEffect(() => subscribeCacheUser(() => {
        subscriptionRevision.current++; setOwner(getCacheUser()); setSubscription(null); setSubscriptionFailed(false);
        setStoreIds([]); setMissingIds([]); setCancelMessage(null); setRetryCancellation(false);
    }), []);
    const refreshSubscription = useCallback(async () => {
        const user = getCacheUser(), version = ++subscriptionRevision.current;
        try {
            const row = await readSubscription(api);
            if (user === getCacheUser() && version === subscriptionRevision.current) { setSubscription(row); setSubscriptionFailed(false); }
        } catch (error) {
            if (user === getCacheUser() && version === subscriptionRevision.current) setSubscriptionFailed(true);
            throw error;
        }
    }, [api]);
    useFocusEffect(useCallback(() => { void refreshSubscription().catch(() => {}); }, [refreshSubscription, owner]));
    useEffect(() => { let live = true; void fetchCatalog().then(models => { if (live) setCosts(typicalCosts(models)); }).catch(() => {}); return () => { live = false; }; }, []);
    async function refreshBalance(user: string | undefined) {
        const next = await api.getBalance();
        if (user && user === getCacheUser()) { publishBalance(user, next.balance); await balance.refresh(); }
    }
    async function cancel(mode: CancelMode) {
        if (!subscription || busyId) return;
        const user = getCacheUser(), id = subscription.id;
        setBusyId('cancel-subscription'); setCancelMessage(null); setRetryCancellation(false);
        try {
            const result = await cancelSubscription(api, id, mode);
            if (user !== getCacheUser()) return;
            setCancelMessage(mode === 'period_end' ? 'creditsPage.stopSuccess' : result.pending ? 'creditsPage.refundPending' : result.refunded ? 'creditsPage.refundConfirmed' : 'creditsPage.refundUnknown');
        } catch (error) {
            if (user !== getCacheUser()) return;
            if (error instanceof ApiError && error.status === 404 && error.code === 'no_live_subscription') setStoreIds(ids => [...ids, id]);
            else {
                if (error instanceof ApiError && error.code === 'subscription_not_found') setMissingIds(ids => [...ids, id]);
                setCancelMessage(subscriptionErrorKey(error)); setRetryCancellation(creditsRemoved(error));
            }
        } finally {
            if (user === getCacheUser()) await Promise.allSettled([
                refreshSubscription(), billing.refreshGenerationAccess(), refreshBalance(user),
            ]);
            setBusyId(null);
        }
    }

    const packPackages = useMemo(() => billing.offerings?.all.credits?.availablePackages ?? [], [billing.offerings]);
    const planPackages = useMemo(() => billing.offerings?.all.generation?.availablePackages ?? [], [billing.offerings]);
    const packs = useMemo(() => toDisplayPackages(packPackages).filter(isWebParityPack), [packPackages]);
    const plans = useMemo(
        () => toDisplayPackages(planPackages).filter((plan) => plan.generationPlan !== null && plan.interval !== null),
        [planPackages],
    );
    const cadence = cadenceChoice ?? initialCadence(plans);
    const chosenPlan = plans.find(plan => plan.id === chosenPlanId && plan.interval === cadence)
        ?? (cadenceChoice === null ? plans.find(plan => plan.generationPlan === 'starter' && plan.interval === cadence) ?? plans.find(plan => plan.interval === cadence) : null)
        ?? null;
    const catalogCredits = new Map(catalog.map((plan) => [plan.id, plan.credits]));

    useEffect(() => {
        let live = true;
        void api.request<unknown>('/api/credit-subscription-plans')
            .then((value) => { if (live) setCatalog(parseGenerationCatalog(value)); })
            .catch(() => {});
        return () => { live = false; };
    }, [api]);

    async function buyPack(id: string) {
        const pkg = packPackages.find((item) => item.identifier === id);
        const expectedCredits = packs.find((item) => item.id === id)?.credits;
        if (!pkg || !expectedCredits || busyId) return;
        const user = getCacheUser();
        setBusyId(id);
        setOutcome(null);
        setChosenId(id);
        let purchased = false;
        try {
            const before = (await api.getBalance()).balance;
            const purchase = await billing.purchase(pkg);
            if (purchase === 'cancelled') {
                setOutcome({ kind: 'cancelled' });
                return;
            }
            purchased = true;
            if (purchase === 'pending') { setOutcome({ kind: 'pending' }); return; }
            const result = await waitForBalanceChange(async () => (await api.getBalance()).balance, before, { minimumIncrease: expectedCredits });
            setOutcome(result.changed ? { kind: 'credited', balance: result.balance } : { kind: 'pending' });
            if (result.changed && user && user === getCacheUser()) { publishBalance(user, result.balance); await balance.refresh().catch(() => {}); }
        } catch {
            setOutcome({ kind: purchased ? 'pending' : 'error' });
        } finally {
            void refreshSubscription().catch(() => {});
            setBusyId(null);
        }
    }

    async function buyPlan() {
        const pkg = planPackages.find((item) => item.identifier === chosenPlan?.id);
        if (!pkg || busyId) return;
        setBusyId(pkg.identifier);
        setOutcome(null);
        try {
            const purchase = await billing.purchase(pkg);
            setOutcome({ kind: purchase === 'cancelled' ? 'cancelled' : purchase === 'pending' ? 'pending' : 'subscribed' });
        } catch {
            setOutcome({ kind: 'error' });
        } finally {
            void refreshSubscription().catch(() => {});
            setBusyId(null);
        }
    }

    async function restore() {
        if (busyId || !billing.canPurchase) return;
        const user = getCacheUser();
        setBusyId('restore');
        setOutcome(null);
        try {
            const restored = await billing.restore();
            setOutcome({ kind: restored ? 'restored' : 'nothingToRestore' });
            await refreshBalance(user).catch(() => {});
        } catch {
            setOutcome({ kind: 'error' });
        } finally {
            void refreshSubscription().catch(() => {});
            setBusyId(null);
        }
    }

    async function retryGenerationAccess() {
        if (busyId) return;
        setBusyId('generation-access');
        setOutcome(null);
        try {
            await billing.refreshGenerationAccess();
        } catch {
            setOutcome({ kind: 'error' });
        } finally {
            void refreshSubscription().catch(() => {});
            setBusyId(null);
        }
    }

    return (
        <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
            <Stack.Screen options={{ title: t('pricing.packs.buy') }} />
            <Text variant="title1" tone="primary" style={styles.title} accessibilityRole="header">{t('credits.title')}</Text>
            <Text variant="callout" tone="secondary" style={styles.lead}>{t('credits.lead')}</Text>

            <BalanceCard details={balance.details} failed={balance.failed}>
                <CheckInEntry />
                <Link href="/history" asChild><Button variant="tertiary" label={t('credits.history')} /></Link>
            </BalanceCard>
            {!billing.canPurchase && billing.status !== 'loading' ? <Text variant="body" tone="secondary" style={styles.notice}>{t('credits.notOpen')}</Text> : null}

            <View style={styles.section}>
                <Text variant="title2" tone="primary" accessibilityRole="header" style={styles.sectionTitle}>{t('credits.subscriptions.title')}</Text>
                <Text variant="body" tone="tertiary" style={styles.sectionBody}>{t('credits.subscriptions.body')}</Text>
                {visibleSubscription(subscription) && subscription ? <CurrentPlanCard key={`${owner}:${subscription.id}`} subscription={subscription} storeBilled={storeIds.includes(subscription.id)} missing={missingIds.includes(subscription.id)} retry={retryCancellation} message={cancelMessage} busy={busyId !== null} onCancel={cancel} /> : null}
                {!visibleSubscription(subscription) && cancelMessage ? <Text variant="footnote" tone="secondary" accessibilityLiveRegion="polite">{t(cancelMessage)}</Text> : null}
                {subscriptionFailed && !subscription && billing.generationActive ? <Text variant="body" tone="accent" style={styles.ok}>{t('credits.subscriptions.active')}</Text> : null}
                {!billing.generationActive && !billing.generationAccessResolved && billing.status !== 'loading' ? (
                    <View style={styles.accessCheck}>
                        <Text variant="body" tone="tertiary" style={styles.muted}>{t('credits.subscriptions.accessUnavailable')}</Text>
                        <Button variant="secondary" accessibilityRole="button" disabled={busyId !== null} onPress={() => void retryGenerationAccess()} label={t('credits.subscriptions.retryAccess')} />
                    </View>
                ) : null}
                {billing.generationActive ? null : billing.status === 'loading' ? <ActivityIndicator color={styles.accentInk.color} /> : plans.length === 0 ? (
                    <Text variant="body" tone="tertiary" style={styles.muted}>{t('credits.subscriptions.unavailable')}</Text>
                ) : (
                    <View style={styles.list}>
                        <PlanCards plans={plans} packs={packs} credits={catalogCredits} cadence={cadence} chosenId={chosenPlan?.id}
                            onCadence={next => { setCadence(next); setChosenPlanId(null); setOutcome(null); }}
                            onChoose={id => { setChosenPlanId(id); setOutcome(null); }} />
                    </View>
                )}
                {!billing.generationActive && chosenPlan?.interval ? <Text accessibilityLanguage="en" variant="caption" tone="tertiary" style={styles.terms}>{renewalTerms(chosenPlan.interval, chosenPlan.priceString, store)}</Text> : null}
                {!billing.generationActive ? <Button variant="primary" accessibilityRole="button" disabled={!billing.generationPurchaseReady || !chosenPlan || busyId !== null} onPress={() => void buyPlan()} label={t('credits.subscriptions.continue')} loading={busyId === chosenPlan?.id} /> : null}
            </View>

            <View style={styles.section}>
                <Text variant="title2" tone="primary" accessibilityRole="header" style={styles.sectionTitle}>{t('credits.packs.title')}</Text>
                <Text variant="body" tone="tertiary" style={styles.sectionBody}>{t('credits.packs.body')}</Text>
                {billing.status === 'loading' ? <ActivityIndicator color={styles.accentInk.color} /> : packs.length === 0 ? (
                    <Text variant="body" tone="tertiary" style={styles.muted}>{t('credits.unavailable')}</Text>
                ) : <View style={styles.packList}>{packs.map(item => (
                    <PackCard key={item.id} pack={item} best={bestPackId(packs) === item.id} saving={packSavingPercent(item, packs)} costs={costs}
                        busy={busyId === item.id} chosen={chosenId === item.id} disabled={!billing.canPurchase || busyId !== null} onPress={() => void buyPack(item.id)}>
                        {chosenId === item.id ? <VeyCardPeek /> : null}
                    </PackCard>
                ))}</View>}
                <PackTaxNote />
            </View>

            {outcome?.kind === 'credited' ? <Text variant="body" tone="secondary" style={styles.balance} accessibilityLiveRegion="polite">{t('credits.added', { balance: outcome.balance })}</Text> : null}
            {outcome?.kind === 'subscribed' ? <Text variant="body" tone="accent" accessibilityLiveRegion="polite" style={styles.ok}>{t('credits.subscriptions.started')}</Text> : null}
            {outcome?.kind === 'restored' ? <Text variant="body" tone="accent" accessibilityLiveRegion="polite" style={styles.ok}>{t('credits.restored')}</Text> : null}
            {outcome?.kind === 'nothingToRestore' ? <Text variant="body" tone="secondary" accessibilityLiveRegion="polite">{t('credits.nothingToRestore')}</Text> : null}
            {outcome?.kind === 'cancelled' ? <Text variant="body" tone="tertiary" accessibilityLiveRegion="polite" style={styles.muted}>{t('credits.cancelled')}</Text> : null}
            {outcome?.kind === 'pending' ? <Text variant="body" tone="tertiary" accessibilityLiveRegion="polite" style={styles.muted}>{t('credits.pending')}</Text> : null}
            {outcome?.kind === 'error' ? <Text variant="body" tone="danger" accessibilityLiveRegion="polite" style={styles.error}>{t('credits.error')}</Text> : null}

            <Button variant="tertiary" accessibilityRole="button" disabled={busyId !== null || !billing.canPurchase} onPress={() => void restore()} textStyle={styles.accentInk} label={t('credits.restore')} loading={busyId === 'restore'} />
            {billing.managementURL ? (
                <Button variant="tertiary" accessibilityRole="link" onPress={() => void WebBrowser.openBrowserAsync(billing.managementURL as string)} textStyle={styles.accentInk} label={t('credits.manage')} />
            ) : null}
            <View style={styles.legal}>
                {LEGAL_LINKS.slice(0, 2).map((item) => (
                    <Button variant="tertiary" key={item.route} accessibilityRole="link" onPress={() => void router.push(item.route)} label={t(item.labelKey)} size="sm" hitSlop={6}>
                        <Text variant="footnote" tone="secondary" style={styles.legalText}>{t(item.labelKey)}</Text>
                    </Button>
                ))}
            </View>
        </ScrollView>
    );
}

const sheets = themedStyles((p) => ({
    accentInk: { color: p.accent },

    screen: { flex: 1, backgroundColor: p.bg },
    content: { padding: ds.space.lg, paddingBottom: ds.space.huge, gap: ds.space.lg },
    title: { color: p.textPrimary, },
    lead: { color: p.textSecondary, },
    notice: { color: p.textSecondary, backgroundColor: p.bgElevated1, borderColor: p.borderSubtle, borderWidth: 1, borderRadius: ds.radius.md, padding: ds.space.md },
    section: { gap: ds.space.sm, borderTopColor: p.borderSubtle, borderTopWidth: 1, paddingTop: ds.space.lg },
    sectionTitle: { color: p.textPrimary, },
    sectionBody: { color: p.textTertiary, },
    accessCheck: { gap: ds.space.sm },
    list: { gap: ds.space.sm },
    packList: { gap: ds.space.md },
    terms: { color: p.textTertiary, },
    balance: { fontVariant: ['tabular-nums'] },
    legalText: { textDecorationLine: 'underline' },
    legal: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: ds.space.xl, marginTop: ds.space.xs },
    muted: { color: p.textTertiary },
    ok: { color: p.accent },
    error: { color: p.danger },
}));
