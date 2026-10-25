import * as WebBrowser from 'expo-web-browser';
import { useMemo, useState, type ReactNode } from 'react';
import { ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useAuth } from '../auth/AuthProvider';
import { useBilling } from '../billing/BillingProvider';
import { LEGAL_LINKS } from '../lib/account';
import { renewalTerms, toDisplayPackages } from '../lib/billing';
import { colors, fonts } from '../theme';

const ENABLED = process.env.EXPO_PUBLIC_HARD_PAYWALL_ENABLED === 'true';
const store = Platform.OS === 'ios' ? 'ios' : 'android';
type Family = 'generation' | 'publish';

export function HardPaywallGate({ children }: { children: ReactNode }) {
    const { signOut } = useAuth();
    const billing = useBilling();
    const [family, setFamily] = useState<Family>('generation');
    const [selected, setSelected] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState<string | null>(null);

    const packages = useMemo(() => family === 'generation'
        ? billing.offerings?.all.generation?.availablePackages ?? []
        : billing.offerings?.all.publish?.availablePackages ?? [], [billing.offerings, family]);
    const plans = useMemo(() => toDisplayPackages(packages).filter((plan) => plan.interval !== null && (family === 'publish' || plan.generationPlan !== null)), [packages, family]);
    const chosen = plans.find((plan) => plan.id === selected)
        ?? plans.find((plan) => family === 'generation' && plan.generationPlan === 'starter' && plan.interval === 'month')
        ?? plans.find((plan) => plan.interval === 'year')
        ?? plans[0]
        ?? null;

    if (!ENABLED || billing.paidAccess) return <>{children}</>;

    async function buy() {
        const pkg = packages.find((item) => item.identifier === chosen?.id);
        if (!pkg || busy) return;
        setBusy(true);
        setMessage(null);
        try {
            if ((await billing.purchase(pkg)) === 'cancelled') setMessage('Purchase cancelled. You were not charged.');
        } catch {
            setMessage('The purchase could not be completed. Try again or restore a previous purchase.');
        } finally {
            setBusy(false);
        }
    }

    async function restore() {
        if (busy) return;
        setBusy(true);
        setMessage(null);
        try {
            await billing.restore();
            setMessage('Purchases restored.');
        } catch {
            setMessage('The store could not restore purchases. Try again.');
        } finally {
            setBusy(false);
        }
    }

    // An unconfigured or unavailable store must still show Restore and Sign out instead of trapping
    // the person behind an endless spinner. Only a configured store can still be resolving access.
    const waiting = billing.status === 'loading' || (billing.status === 'ready' && !billing.accessResolved);
    return (
        <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
            <Text style={styles.brand}>VEY RNOX</Text>
            <Text style={styles.title} accessibilityRole="header">Choose how you create</Text>
            <Text style={styles.lead}>A paid plan is required after sign-up. Pick AI Generation for monthly creation credits or Publish for social planning and publishing.</Text>

            <View style={styles.switcher} accessibilityRole="tablist">
                {(['generation', 'publish'] as const).map((item) => (
                    <Pressable key={item} accessibilityRole="tab" accessibilityState={{ selected: family === item }} style={[styles.tab, family === item && styles.tabOn]} onPress={() => { setFamily(item); setSelected(null); setMessage(null); }}>
                        <Text style={[styles.tabText, family === item && styles.tabTextOn]}>{item === 'generation' ? 'AI Generation' : 'Publish'}</Text>
                    </Pressable>
                ))}
            </View>

            <View style={styles.benefits}>
                <Text style={styles.benefit}>✓ {family === 'generation' ? 'Fresh creation credits every billing cycle' : 'Plan, schedule and measure your social content'}</Text>
                <Text style={styles.benefit}>✓ Cancel in your store settings</Text>
                <Text style={styles.benefit}>✓ 15% stay offer when eligible</Text>
            </View>

            {waiting ? <ActivityIndicator color={colors.accent} size="large" /> : plans.length === 0 ? (
                <View style={styles.notice}><Text style={styles.noticeText}>Plans are temporarily unavailable. You can restore a purchase or sign out and try again later.</Text></View>
            ) : (
                <View style={styles.plans}>
                    {plans.map((plan) => (
                        <Pressable key={plan.id} accessibilityRole="radio" accessibilityState={{ selected: chosen?.id === plan.id }} style={[styles.plan, chosen?.id === plan.id && styles.planOn]} onPress={() => setSelected(plan.id)}>
                            <View style={styles.planCopy}>
                                <Text style={styles.planName}>{plan.generationPlan ? `${plan.generationPlan[0].toUpperCase()}${plan.generationPlan.slice(1)}` : plan.interval === 'week' ? 'Weekly' : plan.interval === 'month' ? 'Monthly' : 'Annual'}</Text>
                                <Text style={styles.planPeriod}>{plan.interval === 'year' ? 'Billed yearly' : plan.interval === 'week' ? 'Billed weekly' : 'Billed monthly'}</Text>
                            </View>
                            <Text style={styles.price}>{plan.priceString}</Text>
                        </Pressable>
                    ))}
                </View>
            )}

            {chosen?.interval ? <Text style={styles.terms}>{renewalTerms(chosen.interval, chosen.priceString, store)}</Text> : null}
            <Pressable accessibilityRole="button" disabled={!billing.canPurchase || !chosen || busy} style={[styles.primary, (!billing.canPurchase || !chosen || busy) && styles.disabled]} onPress={() => void buy()}>
                {busy ? <ActivityIndicator color={colors.accentInk} /> : <Text style={styles.primaryText}>Continue with {family === 'generation' ? 'AI Generation' : 'Publish'}</Text>}
            </Pressable>
            {message ? <Text accessibilityLiveRegion="polite" style={styles.message}>{message}</Text> : null}
            <Pressable accessibilityRole="button" disabled={busy} style={styles.linkButton} onPress={() => void restore()}><Text style={styles.link}>Restore purchases</Text></Pressable>
            <Pressable accessibilityRole="button" disabled={busy} style={styles.linkButton} onPress={() => void signOut()}><Text style={styles.link}>Sign out</Text></Pressable>
            <View style={styles.legal}>{LEGAL_LINKS.slice(0, 2).map((item) => <Pressable key={item.url} accessibilityRole="link" onPress={() => void WebBrowser.openBrowserAsync(item.url)}><Text style={styles.legalText}>{item.label}</Text></Pressable>)}</View>
        </ScrollView>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background },
    content: { flexGrow: 1, paddingHorizontal: 22, paddingTop: 64, paddingBottom: 36, gap: 18 },
    brand: { color: colors.accent, fontWeight: '800', letterSpacing: 3, fontSize: 12 },
    title: { color: colors.text, fontFamily: fonts.display, fontSize: 34, lineHeight: 39 },
    lead: { color: colors.body, fontSize: 16, lineHeight: 23 },
    switcher: { flexDirection: 'row', padding: 4, borderRadius: 14, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
    tab: { flex: 1, minHeight: 48, alignItems: 'center', justifyContent: 'center', borderRadius: 10 },
    tabOn: { backgroundColor: colors.accent },
    tabText: { color: colors.body, fontWeight: '700' },
    tabTextOn: { color: colors.accentInk },
    benefits: { gap: 8 }, benefit: { color: colors.body, fontSize: 14 },
    plans: { gap: 10 },
    plan: { minHeight: 72, flexDirection: 'row', alignItems: 'center', borderRadius: 14, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, padding: 14, gap: 12 },
    planOn: { borderColor: colors.accent, borderWidth: 2 }, planCopy: { flex: 1, gap: 3 },
    planName: { color: colors.text, fontWeight: '700', fontSize: 17 }, planPeriod: { color: colors.muted, fontSize: 13 },
    price: { color: colors.money, fontWeight: '800', fontSize: 18 }, terms: { color: colors.muted, fontSize: 12, lineHeight: 17 },
    primary: { minHeight: 54, alignItems: 'center', justifyContent: 'center', borderRadius: 14, backgroundColor: colors.accent, paddingHorizontal: 16 },
    primaryText: { color: colors.accentInk, fontWeight: '800', fontSize: 16 }, disabled: { opacity: 0.45 },
    notice: { padding: 16, borderRadius: 12, backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1 }, noticeText: { color: colors.body, lineHeight: 21 },
    message: { color: colors.body, textAlign: 'center', fontSize: 13 }, linkButton: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
    link: { color: colors.accent, textDecorationLine: 'underline' }, legal: { flexDirection: 'row', justifyContent: 'center', gap: 20 }, legalText: { color: colors.muted, fontSize: 12 },
});
