import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import RevenueCatUI from 'react-native-purchases-ui';
import type { PurchasesPackage } from 'react-native-purchases';
import { useAuth } from '../../auth/AuthProvider';
import { useBilling } from '../../billing/BillingProvider';
import { useStorePurchase } from '../../billing/useStorePurchase';
import { checkPaywallPurchase, parsePaywallOffering, paywallsEnabled, type PaywallGateResult } from '../../billing/paywallGate';
import { Text, themedStyles, useThemedStyles } from '../../components/ui';
import { getCacheUser } from '../../lib/appCache';
import { publishBalance } from '../../lib/balanceEvents';
import { t } from '../../lib/i18n';
import { ds } from '../../theme';

const GATE_MESSAGE: Record<Exclude<PaywallGateResult, 'ok'>, string> = {
    not_ready: 'billing.paywall.notReady',
    busy: 'billing.paywall.busy',
    sales_closed: 'billing.paywall.salesClosed',
    generation_already_active: 'billing.paywall.alreadyActive',
};

// The RevenueCat dashboard paywall for one offering (ADR-0108 amendment 4). Off unless the build sets
// EXPO_PUBLIC_RC_PAYWALLS_ENABLED; the Credits and Publish screens stay the fallback.
export default function Paywall() {
    const router = useRouter();
    const themed = useThemedStyles(sheets);
    const { api } = useAuth();
    const billing = useBilling();
    const purchase = useStorePurchase();
    const offeringId = parsePaywallOffering(useLocalSearchParams<{ offering?: string }>().offering);
    const offering = offeringId ? billing.offerings?.all[offeringId] ?? null : null;
    const [message, setMessage] = useState<string | null>(null);
    const release = useRef<() => void>(() => undefined);
    const close = useCallback(() => { if (router.canGoBack()) router.back(); }, [router]);

    const onInitiated = useCallback(({ packageBeingPurchased, resume }: { packageBeingPurchased: PurchasesPackage; resume: (go: boolean) => void }) => {
        setMessage(null);
        void checkPaywallPurchase(packageBeingPurchased, {
            canPurchase: billing.canPurchase,
            generationActive: billing.generationActive,
            acquireLock: purchase.acquireAuxiliary,
            refreshSales: billing.refreshSales,
            refreshGenerationAccess: () => billing.refreshGenerationAccess(),
        }).then(({ result, release: done }) => {
            release.current = done;
            if (result !== 'ok') setMessage(t(GATE_MESSAGE[result]));
            resume(result === 'ok');
        });
    }, [billing, purchase.acquireAuxiliary]);

    const finish = useCallback(() => { release.current(); release.current = () => undefined; }, []);
    const onCompleted = useCallback(() => {
        finish();
        // Credits are granted by the store webhook; refresh the shown balance once it lands.
        const owner = getCacheUser();
        void api.getBalance().then(({ balance }) => { if (owner && owner === getCacheUser()) publishBalance(owner, balance); }).catch(() => undefined);
        close();
    }, [api, close, finish]);

    if (!paywallsEnabled() || !offeringId) return <Unavailable text={t('billing.paywall.notReady')} />;
    if (billing.status === 'loading') return <View style={styles.center}><ActivityIndicator /></View>;
    if (!offering || !billing.canPurchase) return <Unavailable text={t(billing.salesOpen ? 'billing.paywall.notReady' : 'billing.paywall.salesClosed')} />;
    return (
        <View style={styles.screen}>
            <Stack.Screen options={{ title: t('billing.paywall.title'), headerShown: false, presentation: 'modal' }} />
            <RevenueCatUI.Paywall
                style={styles.screen}
                options={{ offering }}
                onPurchasePackageInitiated={onInitiated}
                onPurchaseCompleted={onCompleted}
                onPurchaseCancelled={finish}
                onPurchaseError={finish}
                onRestoreCompleted={close}
                onDismiss={close}
            />
            {message ? <View style={themed.banner}><Text variant="body" tone="primary" accessibilityLiveRegion="polite">{message}</Text></View> : null}
        </View>
    );
}

function Unavailable({ text }: { text: string }) {
    return (
        <View style={styles.center}>
            <Stack.Screen options={{ title: t('billing.paywall.title'), presentation: 'modal' }} />
            <Text variant="body" tone="secondary" accessibilityRole="alert">{text}</Text>
        </View>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1 },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: ds.space.xxl },
});
const sheets = themedStyles(p => ({
    banner: { position: 'absolute', left: ds.space.gutter, right: ds.space.gutter, bottom: ds.space.xxl, padding: ds.space.lg, borderRadius: ds.radius.xl, backgroundColor: p.bgElevated1 },
}));
