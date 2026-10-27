import { router } from 'expo-router';
import { Text, Button, Card, themedStyles, useThemedStyles } from '../../components/ui';
import * as WebBrowser from 'expo-web-browser';
import { Link, Stack } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Platform, ScrollView, View } from 'react-native';
import { useAuth } from '../../auth/AuthProvider';
import { useBilling } from '../../billing/BillingProvider';
import { LEGAL_LINKS } from '../../lib/account';
import {
    generationCatalogId,
    isWebParityPack,
    parseGenerationCatalog,
    renewalTerms,
    toDisplayPackages,
    waitForBalanceChange,
    type GenerationCatalogPlan,
} from '../../lib/billing';
import { formatLocale, plural, t } from '../../lib/i18n';
import { ds } from '../../theme';
import { VeyCardPeek, peekRoom } from '../../components/VeyCardPeek';

type Outcome =
    | { kind: 'credited'; balance: number }
    | { kind: 'subscribed' }
    | { kind: 'restored' }
    | { kind: 'cancelled' }
    | { kind: 'pending' }
    | { kind: 'error' }
    | null;

const store = Platform.OS === 'ios' ? 'ios' : 'android';
const planName = (value: string | null) => value ? `${value[0].toUpperCase()}${value.slice(1)}` : t('credits.plan.generation');

export default function Credits() {
    const styles = useThemedStyles(sheets);
    const { api } = useAuth();
    const billing = useBilling();
    const [catalog, setCatalog] = useState<GenerationCatalogPlan[]>([]);
    const [busyId, setBusyId] = useState<string | null>(null);
    const [outcome, setOutcome] = useState<Outcome>(null);
    const [chosenId, setChosenId] = useState<string | null>(null);
    const [chosenPlanId, setChosenPlanId] = useState<string | null>(null);

    const packPackages = useMemo(() => billing.offerings?.all.credits?.availablePackages ?? [], [billing.offerings]);
    const planPackages = useMemo(() => billing.offerings?.all.generation?.availablePackages ?? [], [billing.offerings]);
    const packs = useMemo(() => toDisplayPackages(packPackages).filter(isWebParityPack), [packPackages]);
    const plans = useMemo(
        () => toDisplayPackages(planPackages).filter((plan) => plan.generationPlan !== null && plan.interval !== null),
        [planPackages],
    );
    const chosenPlan = plans.find((plan) => plan.id === chosenPlanId)
        ?? plans.find((plan) => plan.generationPlan === 'starter' && plan.interval === 'month')
        ?? plans[0]
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
        setBusyId(id);
        setOutcome(null);
        setChosenId(id);
        try {
            const before = (await api.getBalance()).balance;
            if ((await billing.purchase(pkg)) === 'cancelled') {
                setOutcome({ kind: 'cancelled' });
                return;
            }
            const result = await waitForBalanceChange(async () => (await api.getBalance()).balance, before, { minimumIncrease: expectedCredits });
            setOutcome(result.changed ? { kind: 'credited', balance: result.balance } : { kind: 'pending' });
        } catch {
            setOutcome({ kind: 'error' });
        } finally {
            setBusyId(null);
        }
    }

    async function buyPlan() {
        const pkg = planPackages.find((item) => item.identifier === chosenPlan?.id);
        if (!pkg || busyId) return;
        setBusyId(pkg.identifier);
        setOutcome(null);
        try {
            setOutcome((await billing.purchase(pkg)) === 'cancelled' ? { kind: 'cancelled' } : { kind: 'subscribed' });
        } catch {
            setOutcome({ kind: 'error' });
        } finally {
            setBusyId(null);
        }
    }

    async function restore() {
        if (busyId || !billing.canPurchase) return;
        setBusyId('restore');
        setOutcome(null);
        try {
            await billing.restore();
            setOutcome({ kind: 'restored' });
        } catch {
            setOutcome({ kind: 'error' });
        } finally {
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
            setBusyId(null);
        }
    }

    return (
        <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
            <Stack.Screen options={{ title: t('pricing.packs.buy') }} />
            <Text variant="title1" tone="primary" style={styles.title} accessibilityRole="header">{t('credits.title')}</Text>
            <Text variant="callout" tone="secondary" style={styles.lead}>{t('credits.lead')}</Text>

            {!billing.canPurchase && billing.status !== 'loading' ? <Text variant="body" tone="secondary" style={styles.notice}>{t('credits.notOpen')}</Text> : null}

            <View style={styles.section}>
                <Text variant="title2" tone="primary" accessibilityRole="header" style={styles.sectionTitle}>{t('credits.subscriptions.title')}</Text>
                <Text variant="body" tone="tertiary" style={styles.sectionBody}>{t('credits.subscriptions.body')}</Text>
                {billing.generationActive ? <Text variant="body" tone="accent" style={styles.ok}>{t('credits.subscriptions.active')}</Text> : null}
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
                        {plans.map((plan) => {
                            const credits = catalogCredits.get(generationCatalogId(plan.productId) ?? '');
                            const chosen = chosenPlan?.id === plan.id;
                            return (
                                <Card
                                    key={plan.id}
                                    accessibilityRole="radio"
                                    accessibilityState={{ selected: chosen }}
                                    selected={chosen} style={[styles.row, chosen && styles.rowOn]}
                                    onPress={() => { setChosenPlanId(plan.id); setOutcome(null); }}
                                >
                                    <View style={styles.rowText}>
                                        <Text variant="bodyStrong" tone="primary" style={styles.name}>{planName(plan.generationPlan)}</Text>
                                        <Text variant="footnote" tone="warning">{credits ? t('credits.plan.allowance', { count: credits.toLocaleString(formatLocale()) }) : t('credits.plan.creationCredits')}</Text>
                                        <Text variant="footnote" tone="tertiary" style={styles.meta}>{plan.interval === 'year' ? t('credits.plan.yearly') : t('credits.plan.monthly')}</Text>
                                    </View>
                                    <Text variant="body" tone="warning" style={styles.price}>{plan.priceString}</Text>
                                </Card>
                            );
                        })}
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
                ) : packs.map((item) => (
                    <Button variant="secondary" label={[plural('credits.pack', item.credits ?? 0, { count: item.credits?.toLocaleString(formatLocale()) ?? '0' }), t('credits.packs.neverExpire'), busyId === item.id ? '' : item.priceString].filter(Boolean).join(', ')}
                        key={item.id}
                        accessibilityRole="button"
                        disabled={!billing.canPurchase || busyId !== null}
                        style={styles.row} containerStyle={chosenId === item.id ? styles.peek : undefined}
                        onPress={() => void buyPack(item.id)}
                    >
                        {chosenId === item.id ? <VeyCardPeek /> : null}
                        <View style={styles.rowText}>
                            <Text variant="bodyStrong" tone="warning">{plural('credits.pack', item.credits ?? 0, { count: item.credits?.toLocaleString(formatLocale()) ?? '0' })}</Text>
                            <Text variant="footnote" tone="tertiary" style={styles.meta}>{t('credits.packs.neverExpire')}</Text>
                        </View>
                        {busyId === item.id ? <ActivityIndicator color={styles.accentInk.color} /> : <Text variant="body" tone="warning" style={styles.price}>{item.priceString}</Text>}
                    </Button>
                ))}
            </View>

            {outcome?.kind === 'credited' ? <Text variant="body" tone="secondary" style={styles.balance} accessibilityLiveRegion="polite">{t('credits.added', { balance: outcome.balance })}</Text> : null}
            {outcome?.kind === 'subscribed' ? <Text variant="body" tone="accent" accessibilityLiveRegion="polite" style={styles.ok}>{t('credits.subscriptions.started')}</Text> : null}
            {outcome?.kind === 'restored' ? <Text variant="body" tone="accent" accessibilityLiveRegion="polite" style={styles.ok}>{t('credits.restored')}</Text> : null}
            {outcome?.kind === 'cancelled' ? <Text variant="body" tone="tertiary" accessibilityLiveRegion="polite" style={styles.muted}>{t('credits.cancelled')}</Text> : null}
            {outcome?.kind === 'pending' ? <Text variant="body" tone="tertiary" accessibilityLiveRegion="polite" style={styles.muted}>{t('credits.pending')}</Text> : null}
            {outcome?.kind === 'error' ? <Text variant="body" tone="danger" accessibilityLiveRegion="polite" style={styles.error}>{t('credits.error')}</Text> : null}

            <Button variant="tertiary" accessibilityRole="button" disabled={busyId !== null || !billing.canPurchase} onPress={() => void restore()} textStyle={styles.accentInk} label={t('credits.restore')} loading={busyId === 'restore'} />
            {billing.managementURL ? (
                <Button variant="tertiary" accessibilityRole="link" onPress={() => void WebBrowser.openBrowserAsync(billing.managementURL as string)} textStyle={styles.accentInk} label={t('credits.manage')} />
            ) : null}
            <Link href="/history" asChild>
                <Button variant="tertiary" accessibilityRole="button" textStyle={styles.accentInk} label={t('credits.history')} />
            </Link>
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
    peek: { marginTop: peekRoom() },
    row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: p.bgElevated1, borderColor: p.borderSubtle, borderWidth: 1, borderRadius: ds.radius.md, padding: ds.space.lg, gap: ds.space.md },
    rowOn: { borderColor: p.accent, backgroundColor: p.accentSubtle },
    rowText: { flex: 1, gap: ds.space.xs },
    name: { color: p.textPrimary, },
    meta: { color: p.textTertiary, },
    price: { color: p.warning, fontVariant: ['tabular-nums'], },
    terms: { color: p.textTertiary, },
    balance: { fontVariant: ['tabular-nums'] },
    legalText: { textDecorationLine: 'underline' },
    legal: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: ds.space.xl, marginTop: ds.space.xs },
    muted: { color: p.textTertiary },
    ok: { color: p.accent },
    error: { color: p.danger },
}));
