import { usePathname, useRouter } from 'expo-router';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { ActivityIndicator, Platform, ScrollView, View } from 'react-native';
import { useAuth } from '../auth/AuthProvider';
import { useBilling } from '../billing/BillingProvider';
import { useStorePurchase } from '../billing/useStorePurchase';
import { LEGAL_LINKS } from '../lib/account';
import { confirmSignOut } from '../lib/confirmSignOut';
import { parseGenerationCatalog, renewalTerms, toDisplayPackages, type GenerationCatalogPlan } from '../lib/billing';
import { HARD_PAYWALL_STARTER_CREDITS, hardPaywallEnabled, hardPaywallState, isHardPaywallExempt } from '../lib/hardPaywall';
import { t } from '../lib/i18n';
import { Button, Text, themedStyles, useThemedStyles } from './ui';
import { PlanCards, initialCadence, type Cadence } from './credits/PlanCards';
import { VeyCharacter } from './VeyCharacter';

const ENABLED = hardPaywallEnabled();

// ADR-0108 amendment 2: with the flag on, a signed-in person with no paid plan sees this and nothing else.
export function HardPaywallGate({ children }: { children: ReactNode }) {
    const billing = useBilling();
    const pathname = usePathname();
    const state = hardPaywallState({ enabled: ENABLED, paidAccess: billing.paidAccess, accessResolved: billing.accessResolved, billingStatus: billing.status });
    if (state === 'open' || isHardPaywallExempt(pathname)) return <>{children}</>;
    return <LockedScreen checking={state === 'checking'} />;
}

function LockedScreen({ checking }: { checking: boolean }) {
    const s = useThemedStyles(styles);
    const { api, signOut } = useAuth();
    const router = useRouter();
    const billing = useBilling();
    const purchase = useStorePurchase();
    const [cadenceChoice, setCadence] = useState<Cadence | null>(null);
    const [chosenId, setChosenId] = useState<string | null>(null);
    const [catalog, setCatalog] = useState<GenerationCatalogPlan[]>([]);
    useEffect(() => { void billing.refreshSales(); }, [billing.refreshSales]);
    useEffect(() => {
        let live = true;
        void api.request<unknown>('/api/credit-subscription-plans').then(v => { if (live) setCatalog(parseGenerationCatalog(v)); }).catch(() => {});
        return () => { live = false; };
    }, [api]);
    const packages = useMemo(() => (billing.offerings?.all.generation?.availablePackages ?? []).filter(pkg => pkg?.product), [billing.offerings]);
    const plans = useMemo(() => toDisplayPackages(packages).filter(plan => plan.generationPlan !== null && plan.interval !== null), [packages]);
    const cadence = cadenceChoice ?? initialCadence(plans);
    const chosen = plans.find(plan => plan.id === chosenId && plan.interval === cadence)
        ?? plans.find(plan => plan.generationPlan === 'starter' && plan.interval === cadence)
        ?? plans.find(plan => plan.interval === cadence) ?? null;
    const noPlans = !checking && plans.length === 0;
    const canBuy = billing.canPurchase && billing.generationPurchaseReady && !!chosen && !purchase.busy;
    const message = purchase.operation.outcome?.kind === 'error' ? t('credits.error')
        : purchase.operation.outcome?.kind === 'cancelled' ? t('credits.cancelled')
        : purchase.operation.outcome?.kind === 'pending' ? t('credits.pending') : null;
    function buy() {
        const pkg = packages.find(item => item.identifier === chosen?.id);
        if (canBuy && pkg) purchase.start({ kind: 'plan', pkg });
    }
    return <ScrollView style={s.screen} contentContainerStyle={s.content} testID="hard-paywall">
        <View style={s.vey}><VeyCharacter width={120} interactive mood="wave" /></View>
        <Text variant="title1" accessibilityRole="header">{t('credits.hardPaywall.title')}</Text>
        <Text tone="secondary">{t('credits.hardPaywall.bodyFree', { count: HARD_PAYWALL_STARTER_CREDITS })}</Text>
        {checking ? <View style={s.row}><ActivityIndicator /><Text tone="secondary">{t('credits.hardPaywall.checking')}</Text></View> : null}
        {noPlans ? <>
            <Text tone="secondary">{t('credits.hardPaywall.unavailable')}</Text>
            <Button variant="secondary" label={t('credits.hardPaywall.retry')} onPress={() => { void billing.refreshSales(); void billing.refreshGenerationAccess(); }} />
        </> : null}
        {plans.length > 0 ? <>
            <PlanCards plans={plans} packs={[]} credits={new Map(catalog.map(plan => [plan.id, plan.credits]))}
                cadence={cadence} chosenId={chosen?.id} disabled={purchase.busy}
                onCadence={next => { setCadence(next); setChosenId(null); }} onChoose={setChosenId} />
            {chosen?.interval ? <Text variant="caption" tone="tertiary" accessibilityLanguage="en">{renewalTerms(chosen.interval, chosen.priceString, Platform.OS === 'ios' ? 'ios' : 'android')}</Text> : null}
            {!billing.canPurchase ? <Text variant="footnote" tone="secondary">{t('credits.notOpen')}</Text> : null}
            <Button label={chosen ? t('credits.paywall.buyPlan', { plan: chosen.generationPlan ?? '', price: chosen.priceString, period: t(chosen.interval === 'year' ? 'credits.paywall.year' : 'credits.paywall.month') }) : ''}
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
