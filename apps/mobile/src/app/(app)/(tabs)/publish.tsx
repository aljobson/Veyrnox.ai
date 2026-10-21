import * as WebBrowser from 'expo-web-browser';
import { Stack, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useAuth } from '../../../auth/AuthProvider';
import { useBilling } from '../../../billing/BillingProvider';
import { API_BASE } from '../../../lib/api';
import { renewalTerms, toDisplayPackages, type Interval } from '../../../lib/billing';
import { t } from '../../../lib/i18n';
import { VEY_CLEARANCE } from '../../../components/VeyMascot';
import { fetchPublishPlan, paywallState, type PlanSource, type PublishTier } from '../../../lib/publishPlan';
import { colors } from '../../../theme';

const BENEFITS = ['Up to five connected accounts', 'Schedule posts ahead', '366 days of analytics', 'Best-time recommendations'];
const LABEL: Record<Interval, string> = { week: 'Weekly', month: 'Monthly', year: 'Annual' };
const store = Platform.OS === 'ios' ? 'ios' : 'android';

export default function Publish() {
    const { api } = useAuth();
    const router = useRouter();
    const { status, offerings, canPurchase, publishActive, debug, purchase, restore } = useBilling();
    const [tier, setTier] = useState<PublishTier | null>(null);
    const [source, setSource] = useState<PlanSource | null>(null);
    const [tierChecked, setTierChecked] = useState(false);
    const [selected, setSelected] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        fetchPublishPlan(api).then((p) => {
            if (cancelled) return;
            setTier(p.tier);
            setSource(p.source);
            setTierChecked(true);
        });
        return () => {
            cancelled = true;
        };
    }, [api]);
    const gate = paywallState(tierChecked, tier);

    const plans = toDisplayPackages(offerings?.all.publish?.availablePackages ?? []).filter((p) => p.interval !== null);
    const chosen = plans.find((p) => p.id === (selected ?? plans.find((x) => x.interval === 'year')?.id)) ?? null;

    async function subscribe() {
        const pkg = offerings?.all.publish?.availablePackages.find((p) => p.identifier === chosen?.id);
        if (!pkg || busy) return;
        setBusy(true);
        setMessage(null);
        try {
            const result = await purchase(pkg);
            setMessage(result === 'purchased' ? 'Thank you. Your Publish Plan is on.' : null);
        } catch {
            setMessage('That did not complete. You were not charged.');
        } finally {
            setBusy(false);
        }
    }

    async function onRestore() {
        setBusy(true);
        try {
            await restore();
            setMessage('Purchases restored.');
        } catch {
            setMessage('Could not restore purchases. Try again.');
        } finally {
            setBusy(false);
        }
    }

    return (
        <ScrollView style={styles.screen} contentContainerStyle={styles.body}>
            <Stack.Screen options={{ title: 'Publish Plan' }} />
            <Text style={styles.title} accessibilityRole="header">Publish more, everywhere</Text>
            {BENEFITS.map((b) => (
                <Text key={b} style={styles.benefit}>✓  {b}</Text>
            ))}
            {gate === 'checking' || status === 'loading' ? (
                <ActivityIndicator color={colors.accent} />
            ) : gate === 'active' || publishActive ? (
                <Text style={styles.ok}>{t('plan.active')} {source === 'stripe' ? t('plan.manageWeb') : source === 'store' || publishActive ? t('plan.manageStore', { store: store === 'ios' ? 'Apple ID' : 'Google Play' }) : ''}</Text>
            ) : gate === 'unknown' ? (
                <Text style={styles.muted}>We could not check your plan right now. Try again in a moment.</Text>
            ) : status !== 'ready' || plans.length === 0 ? (
                <Text style={styles.muted}>The Publish Plan is not available right now.{__DEV__ ? ` [${status}${debug ? `: ${debug}` : ''}; offerings: ${Object.keys(offerings?.all ?? {}).join(',') || 'none'}]` : ''}</Text>
            ) : (
                <>
                    <View style={styles.plans}>
                        {plans.map((p) => (
                            <Pressable key={p.id} accessibilityRole="button" style={[styles.plan, chosen?.id === p.id && styles.planOn]} onPress={() => setSelected(p.id)}>
                                <Text style={[styles.planName, chosen?.id === p.id && styles.planNameOn]}>{p.interval ? LABEL[p.interval] : p.title}</Text>
                                <Text style={[styles.planPrice, chosen?.id === p.id && styles.planNameOn]}>{p.priceString}</Text>
                            </Pressable>
                        ))}
                    </View>
                    {chosen?.interval ? <Text style={styles.terms}>{renewalTerms(chosen.interval, chosen.priceString, store)}</Text> : null}
                    {!canPurchase ? <Text style={styles.muted}>Purchases are not open yet.</Text> : null}
                    <Pressable accessibilityRole="button" disabled={!canPurchase || busy || !chosen} style={[styles.button, (!canPurchase || busy || !chosen) && styles.off]} onPress={subscribe}>
                        {busy ? <ActivityIndicator color={colors.accentInk} /> : <Text style={styles.buttonText}>Subscribe</Text>}
                    </Pressable>
                </>
            )}
            {message ? <Text style={styles.muted}>{message}</Text> : null}
            {gate !== 'checking' ? (
                <View style={styles.menu}>
                    {([['Connected accounts', '/publish/accounts'], ['Posts', '/publish/posts'], ['Analytics', '/publish/analytics'], ['Calendar', '/publish/calendar'], ['Best time', '/publish/best-time'], ['Drafts', '/publish/drafts'], ['Approvals', '/publish/approvals'], ['Brand', '/publish/brands'], ['Products', '/publish/commerce'], ['Ads', '/publish/ads'], ['Reports', '/publish/reports'], ['Inbox', '/publish/inbox'], [t('publishWorkflows.title'), '/publish/workflows'], [t('smartlink.title'), '/publish/smartlink'], ['Contacts', '/publish/contacts'], [t('queues.title'), '/publish/queues'], [t('autolists.title'), '/publish/autolists'], [t('team.title'), '/publish/team'], [t('publishLinks.teamJoin.menu'), '/team-invite'], [t('activity.title'), '/publish/activity']] as const).map(([label, path]) => (
                        <Pressable key={path} accessibilityRole="button" style={styles.menuRow} onPress={() => router.push(path)}>
                            <Text style={styles.menuText}>{label}</Text>
                        </Pressable>
                    ))}
                </View>
            ) : null}
            <View style={styles.links}>
                <Pressable accessibilityRole="button" onPress={onRestore} disabled={busy}><Text style={styles.link}>Restore purchases</Text></Pressable>
                <Pressable accessibilityRole="link" onPress={() => WebBrowser.openBrowserAsync(`${API_BASE}/legal/terms`)}><Text style={styles.link}>Terms</Text></Pressable>
                <Pressable accessibilityRole="link" onPress={() => WebBrowser.openBrowserAsync(`${API_BASE}/legal/privacy`)}><Text style={styles.link}>Privacy</Text></Pressable>
            </View>
        </ScrollView>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background },
    body: { padding: 20, paddingBottom: VEY_CLEARANCE, gap: 12 },
    title: { color: colors.text, fontSize: 26, fontWeight: '700', marginBottom: 4 },
    benefit: { color: colors.body, fontSize: 16 },
    plans: { gap: 10, marginTop: 8 },
    plan: { flexDirection: 'row', justifyContent: 'space-between', backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 12, padding: 16 },
    planOn: { backgroundColor: colors.accent, borderColor: colors.accent },
    planName: { color: colors.text, fontSize: 17, fontWeight: '600' },
    planPrice: { color: colors.money, fontSize: 17, fontWeight: '700' },
    planNameOn: { color: colors.accentInk },
    terms: { color: colors.muted, fontSize: 13 },
    button: { backgroundColor: colors.accent, borderRadius: 12, paddingVertical: 16, alignItems: 'center' },
    off: { opacity: 0.4 },
    buttonText: { color: colors.accentInk, fontWeight: '700', fontSize: 16 },
    muted: { color: colors.muted },
    ok: { color: colors.accent },
    menu: { marginTop: 8, borderTopColor: colors.border, borderTopWidth: StyleSheet.hairlineWidth },
    menuRow: { paddingVertical: 16, borderBottomColor: colors.border, borderBottomWidth: StyleSheet.hairlineWidth },
    menuText: { color: colors.text, fontSize: 16 },
    links: { flexDirection: 'row', justifyContent: 'space-around', marginTop: 16 },
    link: { color: colors.muted, textDecorationLine: 'underline' },
});
