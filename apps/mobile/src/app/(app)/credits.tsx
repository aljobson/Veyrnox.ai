import * as WebBrowser from 'expo-web-browser';
import { Link, Stack } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
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
import { plural, t } from '../../lib/i18n';
import { useVeyScroll } from '../../lib/useVeyScroll';
import { colors, fonts } from '../../theme';
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
    const { api } = useAuth();
    const billing = useBilling();
    const [catalog, setCatalog] = useState<GenerationCatalogPlan[]>([]);
    const [busyId, setBusyId] = useState<string | null>(null);
    const [outcome, setOutcome] = useState<Outcome>(null);
    const [chosenId, setChosenId] = useState<string | null>(null);
    const [chosenPlanId, setChosenPlanId] = useState<string | null>(null);
    const onScroll = useVeyScroll();

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
        <ScrollView style={styles.screen} contentContainerStyle={styles.content} onScroll={onScroll} scrollEventThrottle={64}>
            <Stack.Screen options={{ title: t('pricing.packs.buy') }} />
            <Text style={styles.title} accessibilityRole="header">{t('credits.title')}</Text>
            <Text style={styles.lead}>{t('credits.lead')}</Text>

            {!billing.canPurchase && billing.status !== 'loading' ? <Text style={styles.notice}>{t('credits.notOpen')}</Text> : null}

            <View style={styles.section}>
                <Text accessibilityRole="header" style={styles.sectionTitle}>{t('credits.subscriptions.title')}</Text>
                <Text style={styles.sectionBody}>{t('credits.subscriptions.body')}</Text>
                {billing.generationActive ? <Text style={styles.ok}>{t('credits.subscriptions.active')}</Text> : null}
                {!billing.generationActive && !billing.generationAccessResolved && billing.status !== 'loading' ? (
                    <View style={styles.accessCheck}>
                        <Text style={styles.muted}>{t('credits.subscriptions.accessUnavailable')}</Text>
                        <Pressable accessibilityRole="button" disabled={busyId !== null} onPress={() => void retryGenerationAccess()}>
                            <Text style={styles.linkText}>{t('credits.subscriptions.retryAccess')}</Text>
                        </Pressable>
                    </View>
                ) : null}
                {billing.generationActive ? null : billing.status === 'loading' ? <ActivityIndicator color={colors.accent} /> : plans.length === 0 ? (
                    <Text style={styles.muted}>{t('credits.subscriptions.unavailable')}</Text>
                ) : (
                    <View style={styles.list}>
                        {plans.map((plan) => {
                            const credits = catalogCredits.get(generationCatalogId(plan.productId) ?? '');
                            const chosen = chosenPlan?.id === plan.id;
                            return (
                                <Pressable
                                    key={plan.id}
                                    accessibilityRole="radio"
                                    accessibilityState={{ selected: chosen }}
                                    style={[styles.row, chosen && styles.rowOn]}
                                    onPress={() => { setChosenPlanId(plan.id); setOutcome(null); }}
                                >
                                    <View style={styles.rowText}>
                                        <Text style={styles.name}>{planName(plan.generationPlan)}</Text>
                                        <Text style={styles.meta}>{credits ? t('credits.plan.allowance', { count: credits.toLocaleString() }) : t('credits.plan.creationCredits')}</Text>
                                        <Text style={styles.meta}>{plan.interval === 'year' ? t('credits.plan.yearly') : t('credits.plan.monthly')}</Text>
                                    </View>
                                    <Text style={styles.price}>{plan.priceString}</Text>
                                </Pressable>
                            );
                        })}
                    </View>
                )}
                {!billing.generationActive && chosenPlan?.interval ? <Text style={styles.terms}>{renewalTerms(chosenPlan.interval, chosenPlan.priceString, store)}</Text> : null}
                {!billing.generationActive ? <Pressable
                    accessibilityRole="button"
                    disabled={!billing.generationPurchaseReady || !chosenPlan || busyId !== null}
                    style={[styles.primary, (!billing.generationPurchaseReady || !chosenPlan || busyId !== null) && styles.off]}
                    onPress={() => void buyPlan()}
                >
                    {busyId === chosenPlan?.id ? <ActivityIndicator color={colors.accentInk} /> : <Text style={styles.primaryText}>{t('credits.subscriptions.continue')}</Text>}
                </Pressable> : null}
            </View>

            <View style={styles.section}>
                <Text accessibilityRole="header" style={styles.sectionTitle}>{t('credits.packs.title')}</Text>
                <Text style={styles.sectionBody}>{t('credits.packs.body')}</Text>
                {billing.status === 'loading' ? <ActivityIndicator color={colors.accent} /> : packs.length === 0 ? (
                    <Text style={styles.muted}>{t('credits.unavailable')}</Text>
                ) : packs.map((item) => (
                    <Pressable
                        key={item.id}
                        accessibilityRole="button"
                        disabled={!billing.canPurchase || busyId !== null}
                        style={[styles.row, !billing.canPurchase && styles.off, chosenId === item.id && { marginTop: peekRoom() }]}
                        onPress={() => void buyPack(item.id)}
                    >
                        {chosenId === item.id ? <VeyCardPeek /> : null}
                        <View style={styles.rowText}>
                            <Text style={styles.name}>{plural('credits.pack', item.credits ?? 0, { count: item.credits?.toLocaleString() ?? '0' })}</Text>
                            <Text style={styles.meta}>{t('credits.packs.neverExpire')}</Text>
                        </View>
                        {busyId === item.id ? <ActivityIndicator color={colors.accent} /> : <Text style={styles.price}>{item.priceString}</Text>}
                    </Pressable>
                ))}
            </View>

            {outcome?.kind === 'credited' ? <Text accessibilityLiveRegion="polite" style={styles.ok}>{t('credits.added', { balance: outcome.balance })}</Text> : null}
            {outcome?.kind === 'subscribed' ? <Text accessibilityLiveRegion="polite" style={styles.ok}>{t('credits.subscriptions.started')}</Text> : null}
            {outcome?.kind === 'restored' ? <Text accessibilityLiveRegion="polite" style={styles.ok}>{t('credits.restored')}</Text> : null}
            {outcome?.kind === 'cancelled' ? <Text accessibilityLiveRegion="polite" style={styles.muted}>{t('credits.cancelled')}</Text> : null}
            {outcome?.kind === 'pending' ? <Text accessibilityLiveRegion="polite" style={styles.muted}>{t('credits.pending')}</Text> : null}
            {outcome?.kind === 'error' ? <Text accessibilityLiveRegion="polite" style={styles.error}>{t('credits.error')}</Text> : null}

            <Pressable accessibilityRole="button" disabled={busyId !== null || !billing.canPurchase} style={[styles.linkButton, !billing.canPurchase && styles.off]} onPress={() => void restore()}>
                {busyId === 'restore' ? <ActivityIndicator color={colors.accent} /> : <Text style={styles.linkText}>{t('credits.restore')}</Text>}
            </Pressable>
            {billing.managementURL ? (
                <Pressable accessibilityRole="link" style={styles.linkButton} onPress={() => void WebBrowser.openBrowserAsync(billing.managementURL as string)}>
                    <Text style={styles.linkText}>{t('credits.manage')}</Text>
                </Pressable>
            ) : null}
            <Link href="/history" asChild>
                <Pressable accessibilityRole="button" style={styles.linkButton}><Text style={styles.linkText}>{t('credits.history')}</Text></Pressable>
            </Link>
            <View style={styles.legal}>
                {LEGAL_LINKS.slice(0, 2).map((item) => (
                    <Pressable key={item.url} accessibilityRole="link" onPress={() => void WebBrowser.openBrowserAsync(item.url)}>
                        <Text style={styles.legalText}>{t(item.labelKey)}</Text>
                    </Pressable>
                ))}
            </View>
        </ScrollView>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background },
    content: { padding: 16, paddingBottom: 40, gap: 16 },
    title: { color: colors.text, fontFamily: fonts.display, fontSize: 30, lineHeight: 35 },
    lead: { color: colors.body, fontSize: 15, lineHeight: 22 },
    notice: { color: colors.body, backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 12, padding: 14 },
    section: { gap: 10, borderTopColor: colors.border, borderTopWidth: 1, paddingTop: 18 },
    sectionTitle: { color: colors.text, fontSize: 21, fontWeight: '800' },
    sectionBody: { color: colors.muted, lineHeight: 20 },
    accessCheck: { gap: 6 },
    list: { gap: 10 },
    row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 12, padding: 16, gap: 12 },
    rowOn: { borderColor: colors.accent, borderWidth: 2 },
    off: { opacity: 0.5 },
    rowText: { flex: 1, gap: 3 },
    name: { color: colors.text, fontSize: 17, fontWeight: '700' },
    meta: { color: colors.muted, fontSize: 13 },
    price: { color: colors.money, fontSize: 17, fontWeight: '800' },
    terms: { color: colors.muted, fontSize: 12, lineHeight: 17 },
    primary: { minHeight: 52, alignItems: 'center', justifyContent: 'center', borderRadius: 14, backgroundColor: colors.accent, paddingHorizontal: 16 },
    primaryText: { color: colors.accentInk, fontWeight: '800', fontSize: 16 },
    linkButton: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
    linkText: { color: colors.accent, fontSize: 15, textDecorationLine: 'underline' },
    legal: { flexDirection: 'row', justifyContent: 'center', gap: 20, marginTop: 4 },
    legalText: { color: colors.muted, fontSize: 12, textDecorationLine: 'underline' },
    muted: { color: colors.muted },
    ok: { color: colors.accent },
    error: { color: colors.danger },
});
