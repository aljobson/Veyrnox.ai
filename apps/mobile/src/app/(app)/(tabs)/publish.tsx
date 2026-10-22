import { Image } from 'expo-image';
import * as WebBrowser from 'expo-web-browser';
import { Stack, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useAuth } from '../../../auth/AuthProvider';
import { useBilling } from '../../../billing/BillingProvider';
import { API_BASE } from '../../../lib/api';
import { renewalTerms, toDisplayPackages, type Interval } from '../../../lib/billing';
import { t } from '../../../lib/i18n';
import { MENU_ICONS } from '../../../lib/menuIcons';
import { VEY_CLEARANCE } from '../../../components/VeyMascot';
import { fetchPublishPlan, paywallState, type PlanSource, type PublishTier } from '../../../lib/publishPlan';
import { colors, fonts } from '../../../theme';

const BENEFITS = ['plan.benefit.accounts', 'plan.benefit.schedule', 'plan.benefit.analytics', 'plan.benefit.bestTime'] as const;
const LABEL: Record<Interval, string> = { week: 'unlock.plan.week', month: 'unlock.plan.month', year: 'unlock.plan.year' };
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
            setMessage(result === 'purchased' ? t('plan.thanks') : null);
        } catch {
            setMessage(t('plan.notCompleted'));
        } finally {
            setBusy(false);
        }
    }

    async function onRestore() {
        setBusy(true);
        try {
            await restore();
            setMessage(t('plan.restored'));
        } catch {
            setMessage(t('plan.restoreFailed'));
        } finally {
            setBusy(false);
        }
    }

    return (
        <ScrollView style={styles.screen} contentContainerStyle={styles.body}>
            <Stack.Screen options={{ title: t('plan.navTitle') }} />
            <Text style={styles.title} accessibilityRole="header">{t('plan.headline')}</Text>
            {BENEFITS.map((b) => (
                <Text key={b} style={styles.benefit}><Text style={styles.tick}>✓  </Text>{t(b)}</Text>
            ))}
            {gate === 'checking' || status === 'loading' ? (
                <ActivityIndicator color={colors.accent} />
            ) : gate === 'active' || publishActive ? (
                <Text style={styles.ok}>{t('plan.active')} {source === 'stripe' ? t('plan.manageWeb') : source === 'store' || publishActive ? t('plan.manageStore', { store: store === 'ios' ? 'Apple ID' : 'Google Play' }) : ''}</Text>
            ) : gate === 'unknown' ? (
                <Text style={styles.muted}>{t('plan.checkFailed')}</Text>
            ) : status !== 'ready' || plans.length === 0 ? (
                <Text style={styles.muted}>{t('plan.unavailable')}{__DEV__ ? ` [${status}${debug ? `: ${debug}` : ''}; offerings: ${Object.keys(offerings?.all ?? {}).join(',') || 'none'}]` : ''}</Text>
            ) : (
                <>
                    <View style={styles.plans}>
                        {plans.map((p) => (
                            <Pressable key={p.id} accessibilityRole="button" style={[styles.plan, chosen?.id === p.id && styles.planOn]} onPress={() => setSelected(p.id)}>
                                <Text style={[styles.planName, chosen?.id === p.id && styles.planNameOn]}>{p.interval ? t(LABEL[p.interval]) : p.title}</Text>
                                <Text style={[styles.planPrice, chosen?.id === p.id && styles.planNameOn]}>{p.priceString}</Text>
                            </Pressable>
                        ))}
                    </View>
                    {chosen?.interval ? <Text style={styles.terms}>{renewalTerms(chosen.interval, chosen.priceString, store)}</Text> : null}
                    {!canPurchase ? <Text style={styles.muted}>{t('plan.notOpen')}</Text> : null}
                    <Pressable accessibilityRole="button" disabled={!canPurchase || busy || !chosen} style={[styles.button, (!canPurchase || busy || !chosen) && styles.off]} onPress={subscribe}>
                        {busy ? <ActivityIndicator color={colors.accentInk} /> : <Text style={styles.buttonText}>{t('unlock.subscribe')}</Text>}
                    </Pressable>
                </>
            )}
            {message ? <Text style={styles.muted}>{message}</Text> : null}
            {gate !== 'checking' ? (
                <View style={styles.menu}>
                    {([[t('plan.menu.accounts'), '/publish/accounts'], [t('plan.menu.posts'), '/publish/posts'], [t('analytics.title'), '/publish/analytics'], [t('calendar.title'), '/publish/calendar'], [t('plan.menu.bestTime'), '/publish/best-time'], [t('drafts.title'), '/publish/drafts'], [t('approvals.title'), '/publish/approvals'], [t('brands.title'), '/publish/brands'], [t('commerce.title'), '/publish/commerce'], [t('ads.title'), '/publish/ads'], [t('reports.title'), '/publish/reports'], [t('inbox.title'), '/publish/inbox'], [t('publishWorkflows.title'), '/publish/workflows'], [t('smartlink.title'), '/publish/smartlink'], [t('contacts.title'), '/publish/contacts'], [t('queues.title'), '/publish/queues'], [t('autolists.title'), '/publish/autolists'], [t('team.title'), '/publish/team'], [t('publishLinks.teamJoin.menu'), '/team-invite'], [t('activity.title'), '/publish/activity']] as const).map(([label, path]) => (
                        <Pressable key={path} accessibilityRole="button" style={styles.menuRow} onPress={() => router.push(path)}>
                            <Text style={styles.menuText}>{label}</Text>
                            <Image source={MENU_ICONS.caretRight} style={styles.menuCaret} tintColor={colors.muted} contentFit="contain" accessibilityElementsHidden />
                        </Pressable>
                    ))}
                </View>
            ) : null}
            <View style={styles.links}>
                <Pressable accessibilityRole="button" onPress={onRestore} disabled={busy}><Text style={styles.link}>{t('account.restore')}</Text></Pressable>
                <Pressable accessibilityRole="link" onPress={() => WebBrowser.openBrowserAsync(`${API_BASE}/legal/terms`)}><Text style={styles.link}>{t('plan.terms')}</Text></Pressable>
                <Pressable accessibilityRole="link" onPress={() => WebBrowser.openBrowserAsync(`${API_BASE}/legal/privacy`)}><Text style={styles.link}>{t('plan.privacy')}</Text></Pressable>
            </View>
        </ScrollView>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background },
    body: { padding: 20, paddingBottom: VEY_CLEARANCE, gap: 12 },
    title: { color: colors.text, fontFamily: fonts.display, fontSize: 26, marginBottom: 4 },
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
    menuRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 56, paddingVertical: 12, borderBottomColor: colors.border, borderBottomWidth: StyleSheet.hairlineWidth },
    menuText: { color: colors.text, fontSize: 16, flex: 1 },
    menuCaret: { width: 14, height: 14 },
    tick: { color: colors.accent, fontWeight: '700' },
    links: { flexDirection: 'row', justifyContent: 'space-around', marginTop: 16 },
    link: { color: colors.muted, textDecorationLine: 'underline' },
});
