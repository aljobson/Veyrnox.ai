import { Redirect, Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useReducer, useRef } from 'react';
import { Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import RevenueCatUI from 'react-native-purchases-ui';
import type { CustomerInfo, PurchasesError, PurchasesPackage, PurchasesStoreTransaction } from 'react-native-purchases';
import { useBilling, type BillingSource } from '../../billing/BillingProvider';
import { useStorePurchase } from '../../billing/useStorePurchase';
import { settleExternalUnmount, type ExternalPurchaseOperation, type PurchaseRequest } from '../../billing/storePurchaseStore';
import { checkPaywallPurchase, parsePaywallOffering, paywallsEnabled } from '../../billing/paywallGate';
import { PURCHASED_HOLD_MS, isPlanPick, paywallVey } from '../../billing/paywallVey';
import { VeyCharacter } from '../../components/VeyCharacter';
import { touchTarget } from '../../lib/a11y';
import { playSuccess } from '../../lib/haptics';
import { Button, Text, themedStyles, useThemedStyles } from '../../components/ui';
import { formatLocale, t } from '../../lib/i18n';
import { ds } from '../../theme';
import { creditsFor, hasRetiredGenerationPackages, isPaidSubscriptionProduct, WEB_PARITY_PACK_CREDITS } from '../../lib/billing';
import { PurchaseState } from '../../components/credits/PurchaseState';
import { useOptionalSafeAreaInsets } from '../../lib/safeArea';

const PURCHASE_CANCELLED_ERROR = '1';
const PAYMENT_PENDING_ERROR = '20';

// The RevenueCat dashboard paywall for one offering (ADR-0108 amendment 4). Off unless the build sets
// EXPO_PUBLIC_RC_PAYWALLS_ENABLED; the Credits and Publish screens stay the fallback.
export default function Paywall() {
    const router = useRouter();
    const themed = useThemedStyles(sheets);
    const insets = useOptionalSafeAreaInsets();
    const { fontScale } = useWindowDimensions();
    const billing = useBilling();
    const { startExternal, actions } = useStorePurchase();
    const offeringId = parsePaywallOffering(useLocalSearchParams<{ offering?: string }>().offering);
    const offering = offeringId ? billing.offerings?.all[offeringId] ?? null : null;
    const [vey, react] = useReducer(paywallVey, null, () => paywallVey(null, { type: 'open', offering: offeringId ?? 'generation' }));
    const active = useRef<ExternalPurchaseOperation | null>(null);
    const restoreActive = useRef<ExternalPurchaseOperation | null>(null);
    const untrackedRestore = useRef(false);
    const closing = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    // A cold deep link has no history: fall back to the credits screen so there is always a way out.
    const close = useCallback(() => { if (router.canGoBack()) router.back(); else router.replace('/credits'); }, [router]);
    useEffect(() => () => {
        clearTimeout(closing.current);
        const operation = active.current;
        if (operation) settleExternalUnmount(operation);
    }, []);

    const onInitiated = useCallback(({ packageBeingPurchased, resume }: { packageBeingPurchased: PurchasesPackage; resume: (go: boolean) => void }) => {
        if (!actions.buy) { react({ type: 'refused', result: 'busy' }); resume(false); return; }
        const request = requestFor(packageBeingPurchased);
        if (!request) { react({ type: 'refused', result: 'not_ready' }); resume(false); return; }
        const operation = startExternal(request);
        if (typeof operation === 'string') {
            react({ type: 'refused', result: operation === 'busy' ? 'busy' : 'not_ready' });
            resume(false);
            return;
        }
        active.current = operation;
        react({ type: 'checking' });
        void Promise.all([operation.ready, checkPaywallPurchase(packageBeingPurchased, {
            canPurchase: billing.canPurchase,
            generationActive: billing.generationActive,
            refreshSales: billing.refreshSales,
            refreshGenerationAccess: () => billing.refreshGenerationAccess(),
        })]).then(([prepared, result]) => {
            if (active.current !== operation) { resume(false); return; }
            if (!prepared) { react({ type: 'failed' }); resume(false); return; }
            if (result !== 'ok') {
                if (result === 'sales_closed') operation.finish({ kind: 'sales_closed' });
                else if (result === 'generation_already_active') operation.abort();
                else operation.finish({ kind: 'error' });
                react({ type: 'refused', result });
                resume(false);
                return;
            }
            if (!operation.markStore()) { resume(false); return; }
            react({ type: 'store' });
            resume(true);
        }).catch(() => {
            operation.finish({ kind: 'error' });
            react({ type: 'failed' });
            resume(false);
        });
    }, [actions.buy, billing, startExternal]);

    const scheduleClose = useCallback(() => {
        if (!closing.current) closing.current = setTimeout(close, PURCHASED_HOLD_MS);
    }, [close]);
    const onCompleted = useCallback(({ customerInfo, storeTransaction }: { customerInfo: CustomerInfo; storeTransaction: PurchasesStoreTransaction }) => {
        const operation = active.current;
        if (!operation) return;
        const applied = billing.applyCustomerInfo(customerInfo);
        if (!applied && operation.kind === 'plan') {
            const outcome = operation.finish({ kind: 'pending' });
            if (outcome?.kind === 'pending') { react({ type: 'pending' }); scheduleClose(); }
            return;
        }
        void operation.complete(storeTransaction.productIdentifier).then(outcome => {
            if (!outcome || active.current !== operation) return;
            if (outcome.kind === 'credited' || outcome.kind === 'subscribed') {
                if (offeringId) react({ type: 'purchased', offering: offeringId });
                void playSuccess();
            } else if (outcome.kind === 'pending') react({ type: 'pending' });
            scheduleClose();
        });
    }, [billing, offeringId, scheduleClose]);

    const onCancelled = useCallback(() => {
        const outcome = active.current?.finish({ kind: 'cancelled' });
        if (outcome?.kind === 'cancelled') react({ type: 'cancelled' });
    }, []);
    const onError = useCallback(({ error }: { error: PurchasesError }) => {
        const outcome = active.current?.finish({ kind: error.code === PAYMENT_PENDING_ERROR ? 'pending'
            : error.code === PURCHASE_CANCELLED_ERROR ? 'cancelled' : 'error' });
        if (outcome?.kind === 'pending') react({ type: 'pending' });
        else if (outcome?.kind === 'cancelled') react({ type: 'cancelled' });
        else if (outcome?.kind === 'error') react({ type: 'failed' });
    }, []);
    const onRestoreStarted = useCallback(() => {
        const operation = startExternal({ kind: 'restore' });
        if (typeof operation === 'string') {
            restoreActive.current = null; untrackedRestore.current = true;
            react({ type: 'refused', result: operation === 'busy' ? 'busy' : 'not_ready' }); return;
        }
        untrackedRestore.current = false;
        restoreActive.current = operation;
        active.current = operation;
        void operation.ready.then(prepared => {
            if (prepared && active.current === operation && operation.markStore()) react({ type: 'store' });
        });
    }, [startExternal]);
    const onRestoreCompleted = useCallback(({ customerInfo }: { customerInfo: CustomerInfo }) => {
        const operation = restoreActive.current;
        const restored = Object.keys(customerInfo.entitlements.active).length > 0 || customerInfo.activeSubscriptions.length > 0;
        const applied = billing.applyCustomerInfo(customerInfo);
        if (!operation || untrackedRestore.current) {
            untrackedRestore.current = false;
            react({ type: 'restored', restored }); if (restored) void playSuccess();
            if (!applied) void billing.refreshAccess();
            return;
        }
        if (!applied) void billing.refreshAccess();
        void operation.complete(undefined, restored).then(outcome => {
            if (!outcome || active.current !== operation) return;
            react({ type: 'restored', restored: outcome.kind === 'restored' });
            if (outcome.kind === 'restored') void playSuccess();
        });
    }, [billing]);
    const onRestoreError = useCallback(() => {
        const outcome = restoreActive.current?.finish({ kind: 'error' });
        if (outcome?.kind === 'error' || untrackedRestore.current) react({ type: 'failed' });
        untrackedRestore.current = false;
    }, []);

    const retry = useCallback(() => { billing.retryOfferings(); void billing.refreshSales(); }, [billing]);
    const retryAccess = useCallback(() => {
        billing.retryOfferings();
        void Promise.allSettled([billing.refreshSales(), billing.refreshAccess()]);
    }, [billing]);
    if (!paywallsEnabled()) return <Unavailable kind="unavailable" text={t('billing.paywall.unavailableBuild')} onClose={close} />;
    if (!offeringId) return <Redirect href="/credits" />;
    if (billing.status === 'loading') return <Unavailable kind="loading" text={t('common.loading')} onClose={close} />;
    const accessResolved = offeringId === 'credits' || (offeringId === 'generation' ? billing.generationAccessResolved : billing.publishAccessResolved);
    if (!accessResolved && billing.status === 'ready') return <Unavailable kind="unavailable"
        text={t(offeringId === 'generation' ? 'credits.subscriptions.accessUnavailable' : 'billing.paywall.notReady')} onRetry={retryAccess} onClose={close} />;
    const alreadyActive = offeringId === 'generation' ? billing.generationActive : offeringId === 'publish' ? billing.publishActive : false;
    if (alreadyActive && offeringId !== 'credits') {
        const source = offeringId === 'generation' ? billing.generationSource : billing.publishSource;
        const periodEnd = offeringId === 'generation' ? billing.generationPeriodEnd : billing.publishPeriodEnd;
        return <ActiveSubscription offering={offeringId} source={source} periodEnd={periodEnd} managementURL={billing.managementURL} canManage={actions.manage} onClose={close}
            onManageWeb={() => router.replace(offeringId === 'generation' ? '/credits' : '/publish/workflows')} />;
    }
    if (!offering || !billing.canPurchase) return <Unavailable kind="unavailable" text={t(billing.salesOpen ? 'billing.paywall.notReady' : 'billing.paywall.salesClosed')} onRetry={retry} onClose={close} />;
    // The custom Credits screen filters retired packages even when the dashboard offering is stale.
    if (hasRetiredGenerationPackages(offering.availablePackages)) return <Redirect href="/credits" />;
    return (
        <View style={[styles.screen, themed.page, { paddingLeft: insets.left, paddingRight: insets.right, paddingBottom: insets.bottom }]}>
            <Stack.Screen options={{ title: t('billing.paywall.title'), headerShown: false, presentation: 'modal' }} />
            <View style={[themed.header, { paddingTop: insets.top + ds.space.sm }]}>
                <VeyCharacter width={fontScale >= 1.3 ? 56 : 84} mood={vey.mood} interactive onReact={() => react({ type: 'poke' })} />
                <View style={themed.bubble}>
                    <Text variant="body" tone="primary" accessibilityLiveRegion="polite">{t(vey.line)}</Text>
                </View>
                <Pressable accessibilityRole="button" accessibilityLabel={t('common.close')} accessibilityState={{ disabled: !actions.close }} disabled={!actions.close}
                    hitSlop={8} style={[touchTarget, styles.close]} onPress={close}>
                    <Text variant="title3" tone="secondary">×</Text>
                </Pressable>
            </View>
            <RevenueCatUI.Paywall
                style={styles.screen}
                options={{ offering }}
                onInteraction={event => { if (isPlanPick(event.component_type)) react({ type: 'pick' }); }}
                onPurchasePackageInitiated={onInitiated}
                onPurchaseCompleted={onCompleted}
                onPurchaseCancelled={onCancelled}
                onPurchaseError={onError}
                onRestoreStarted={onRestoreStarted}
                onRestoreCompleted={onRestoreCompleted}
                onRestoreError={onRestoreError}
                // The paywall may dismiss itself after a purchase; the celebration timer closes instead.
                onDismiss={() => {
                    if (!closing.current && actions.close) close();
                }}
            />
        </View>
    );
}

function requestFor(pkg: PurchasesPackage): PurchaseRequest | null {
    const credits = creditsFor(pkg.product.identifier);
    if (credits !== null) return (WEB_PARITY_PACK_CREDITS as readonly number[]).includes(credits) ? { kind: 'pack', pkg, expectedCredits: credits } : null;
    return isPaidSubscriptionProduct(pkg.product.identifier) ? { kind: 'plan', pkg } : null;
}

function ActiveSubscription({ offering, source, periodEnd, managementURL, canManage, onManageWeb, onClose }: {
    offering: 'generation' | 'publish'; source: BillingSource; periodEnd: string | null; managementURL: string | null;
    canManage: boolean; onManageWeb(): void; onClose(): void;
}) {
    const themed = useThemedStyles(sheets);
    const insets = useOptionalSafeAreaInsets();
    const storeActive = source === 'store' || source === 'both';
    const webActive = source === 'web' || source === 'both';
    const period = periodEnd ? t('creditsPage.periodEnd', {
        date: new Date(periodEnd).toLocaleDateString(formatLocale(), { day: 'numeric', month: 'short', year: 'numeric' }),
    }) : null;
    return <ScrollView style={[styles.screen, themed.page]} contentInsetAdjustmentBehavior="automatic" contentContainerStyle={[styles.center, {
        paddingLeft: insets.left + ds.space.xxl, paddingRight: insets.right + ds.space.xxl, paddingBottom: insets.bottom + ds.space.xxl,
    }]}>
        <Stack.Screen options={{ title: t('billing.paywall.title'), presentation: 'modal' }} />
        <View style={themed.activeCard} accessibilityRole="summary">
            <Text variant="title2" tone="primary" accessibilityRole="header">{t(offering === 'generation' ? 'credits.subscriptions.active' : 'publishHome.fullPublishing')}</Text>
            {period ? <Text variant="body" tone="secondary">{period}</Text> : null}
            <View style={styles.actions}>
                {storeActive && managementURL ? <Button variant="primary" accessibilityRole="link" label={t('billing.paywall.manageStore')}
                    disabled={!canManage} onPress={() => { void WebBrowser.openBrowserAsync(managementURL); }} /> : null}
                {webActive ? <Button variant={storeActive ? 'secondary' : 'primary'} label={t('billing.paywall.manageWeb')} disabled={!canManage} onPress={onManageWeb} /> : null}
                <Button variant="secondary" label={t('common.close')} onPress={onClose} />
            </View>
        </View>
    </ScrollView>;
}

// A dead end is never acceptable: the person can always retry the store load or leave.
function Unavailable({ kind, text, onRetry, onClose }: { kind: 'loading' | 'unavailable'; text: string; onRetry?: () => void; onClose(): void }) {
    const themed = useThemedStyles(sheets);
    const insets = useOptionalSafeAreaInsets();
    return (
        <ScrollView style={[styles.screen, themed.page]} contentInsetAdjustmentBehavior="automatic" contentContainerStyle={[styles.center, {
            paddingLeft: insets.left + ds.space.xxl, paddingRight: insets.right + ds.space.xxl, paddingBottom: insets.bottom + ds.space.xxl,
        }]}>
            <Stack.Screen options={{ title: t('billing.paywall.title'), presentation: 'modal' }} />
            <PurchaseState kind={kind} text={text}>
                <View style={styles.actions}>
                    {onRetry ? <Button variant="primary" label={t('recovery.retry')} onPress={onRetry} /> : null}
                    <Button variant="secondary" label={t('common.close')} onPress={onClose} />
                </View>
            </PurchaseState>
        </ScrollView>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1 },
    close: { alignSelf: 'flex-start', alignItems: 'center' },
    actions: { gap: ds.space.md, alignSelf: 'stretch' },
    center: { flexGrow: 1, width: '100%', maxWidth: 760, alignSelf: 'center', alignItems: 'center', justifyContent: 'center', padding: ds.space.xxl },
});
const sheets = themedStyles(p => ({
    page: { backgroundColor: p.bg },
    header: { width: '100%', maxWidth: 900, alignSelf: 'center', flexDirection: 'row', alignItems: 'flex-start', gap: ds.space.md, paddingHorizontal: ds.space.gutter, paddingBottom: ds.space.sm },
    bubble: { flex: 1, padding: ds.space.md, borderRadius: ds.radius.xl, borderBottomStartRadius: ds.space.xs, backgroundColor: p.bgElevated1 },
    activeCard: { alignSelf: 'stretch', gap: ds.space.lg, padding: ds.space.xl, borderRadius: ds.radius.xl, borderWidth: 1, borderColor: p.borderSubtle, backgroundColor: p.bgElevated1 },
}));
