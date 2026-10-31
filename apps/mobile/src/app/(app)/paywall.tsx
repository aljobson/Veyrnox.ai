import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useReducer, useRef } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import RevenueCatUI from 'react-native-purchases-ui';
import type { PurchasesPackage } from 'react-native-purchases';
import { useAuth } from '../../auth/AuthProvider';
import { useBilling } from '../../billing/BillingProvider';
import { useStorePurchase } from '../../billing/useStorePurchase';
import { checkPaywallPurchase, parsePaywallOffering, paywallsEnabled } from '../../billing/paywallGate';
import { PURCHASED_HOLD_MS, isPlanPick, paywallVey } from '../../billing/paywallVey';
import { VeyCharacter } from '../../components/VeyCharacter';
import { touchTarget } from '../../lib/a11y';
import { playSuccess } from '../../lib/haptics';
import { Text, themedStyles, useThemedStyles } from '../../components/ui';
import { getCacheUser } from '../../lib/appCache';
import { publishBalance } from '../../lib/balanceEvents';
import { t } from '../../lib/i18n';
import { ds } from '../../theme';

// The RevenueCat dashboard paywall for one offering (ADR-0108 amendment 4). Off unless the build sets
// EXPO_PUBLIC_RC_PAYWALLS_ENABLED; the Credits and Publish screens stay the fallback.
export default function Paywall() {
    const router = useRouter();
    const themed = useThemedStyles(sheets);
    const insets = useSafeAreaInsets();
    const { api } = useAuth();
    const billing = useBilling();
    const purchase = useStorePurchase();
    const offeringId = parsePaywallOffering(useLocalSearchParams<{ offering?: string }>().offering);
    const offering = offeringId ? billing.offerings?.all[offeringId] ?? null : null;
    const [vey, react] = useReducer(paywallVey, null, () => paywallVey(null, { type: 'open', offering: offeringId ?? 'generation' }));
    const release = useRef<() => void>(() => undefined);
    const closing = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    const close = useCallback(() => { if (router.canGoBack()) router.back(); }, [router]);
    useEffect(() => () => { clearTimeout(closing.current); release.current(); }, []);

    const onInitiated = useCallback(({ packageBeingPurchased, resume }: { packageBeingPurchased: PurchasesPackage; resume: (go: boolean) => void }) => {
        react({ type: 'checking' });
        void checkPaywallPurchase(packageBeingPurchased, {
            canPurchase: billing.canPurchase,
            generationActive: billing.generationActive,
            acquireLock: purchase.acquireAuxiliary,
            refreshSales: billing.refreshSales,
            refreshGenerationAccess: () => billing.refreshGenerationAccess(),
        }).then(({ result, release: done }) => {
            release.current = done;
            react(result === 'ok' ? { type: 'store' } : { type: 'refused', result });
            resume(result === 'ok');
        });
    }, [billing, purchase.acquireAuxiliary]);

    const finish = useCallback(() => { release.current(); release.current = () => undefined; }, []);
    const onCompleted = useCallback(() => {
        finish();
        if (offeringId) react({ type: 'purchased', offering: offeringId });
        void playSuccess();
        // Credits are granted by the store webhook; refresh the shown balance once it lands.
        const owner = getCacheUser();
        void api.getBalance().then(({ balance }) => { if (owner && owner === getCacheUser()) publishBalance(owner, balance); }).catch(() => undefined);
        closing.current = setTimeout(close, PURCHASED_HOLD_MS);
    }, [api, close, finish, offeringId]);

    if (!paywallsEnabled() || !offeringId) return <Unavailable text={t('billing.paywall.notReady')} />;
    if (billing.status === 'loading') return <View style={styles.center}><ActivityIndicator /></View>;
    if (!offering || !billing.canPurchase) return <Unavailable text={t(billing.salesOpen ? 'billing.paywall.notReady' : 'billing.paywall.salesClosed')} />;
    return (
        <View style={[styles.screen, themed.page]}>
            <Stack.Screen options={{ title: t('billing.paywall.title'), headerShown: false, presentation: 'modal' }} />
            <View style={[themed.header, { paddingTop: insets.top + ds.space.sm }]}>
                <VeyCharacter width={84} mood={vey.mood} interactive onReact={() => react({ type: 'poke' })} />
                <View style={themed.bubble}>
                    <Text variant="body" tone="primary" accessibilityLiveRegion="polite">{t(vey.line)}</Text>
                </View>
                <Pressable accessibilityRole="button" accessibilityLabel={t('common.close')} hitSlop={8} style={[touchTarget, styles.close]} onPress={close}>
                    <Text variant="title3" tone="secondary">×</Text>
                </Pressable>
            </View>
            <RevenueCatUI.Paywall
                style={styles.screen}
                options={{ offering }}
                onInteraction={event => { if (isPlanPick(event.component_type)) react({ type: 'pick' }); }}
                onPurchasePackageInitiated={onInitiated}
                onPurchaseCompleted={onCompleted}
                onPurchaseCancelled={() => { finish(); react({ type: 'cancelled' }); }}
                onPurchaseError={() => { finish(); react({ type: 'failed' }); }}
                onRestoreCompleted={close}
                onDismiss={close}
            />
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
    close: { alignSelf: 'flex-start', alignItems: 'center' },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: ds.space.xxl },
});
const sheets = themedStyles(p => ({
    page: { backgroundColor: p.bg },
    header: { flexDirection: 'row', alignItems: 'center', gap: ds.space.md, paddingHorizontal: ds.space.gutter, paddingBottom: ds.space.sm },
    bubble: { flex: 1, padding: ds.space.md, borderRadius: ds.radius.xl, borderBottomLeftRadius: ds.space.xs, backgroundColor: p.bgElevated1 },
}));
