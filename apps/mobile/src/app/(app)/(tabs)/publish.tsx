import { Image } from 'expo-image';
import * as WebBrowser from 'expo-web-browser';
import { Stack, useFocusEffect, useRouter, type Href } from 'expo-router';
import { useCallback, useMemo, useState, useSyncExternalStore } from 'react';
import { ActivityIndicator, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useAuth } from '../../../auth/AuthProvider';
import { useBilling } from '../../../billing/BillingProvider';
import { API_BASE } from '../../../lib/api';
import { renewalTerms, toDisplayPackages, type Interval } from '../../../lib/billing';
import { t } from '../../../lib/i18n';
import { MENU_ICONS, type MenuIcon } from '../../../lib/menuIcons';
import { fetchAccounts, fetchPosts, publishErrorMessage, type PublishAccountsState, type PublishPost } from '../../../lib/publish';
import { brandStore, fetchBrands, reconcileBrand, roleLabel, type Brand } from '../../../lib/publishBrand';
import { canConnectAccounts, canPublish, hasPublishPlan, publishDestinations, publishSummary, type PublishDestinationId } from '../../../lib/publishDashboard';
import { usePublishApi } from '../../../lib/usePublishApi';
import { colors, fonts } from '../../../theme';

const PLAN_LABEL: Record<Interval, string> = { week: 'unlock.plan.week', month: 'unlock.plan.month', year: 'unlock.plan.year' };
const store = Platform.OS === 'ios' ? 'ios' : 'android';
const GROUPS = ['work', 'engage', 'grow', 'manage'] as const;
type Group = (typeof GROUPS)[number];
type Destination = { readonly group: Group; readonly icon: MenuIcon; readonly path: Href; readonly title: string; readonly body: string };

const DESTINATIONS: Record<PublishDestinationId, Destination> = {
    accounts: { group: 'manage', icon: 'user', path: '/publish/accounts', title: 'plan.menu.accounts', body: 'publishHome.tool.accounts' },
    posts: { group: 'work', icon: 'send', path: '/publish/posts', title: 'plan.menu.posts', body: 'publishHome.tool.posts' },
    calendar: { group: 'work', icon: 'squares', path: '/publish/calendar', title: 'calendar.title', body: 'publishHome.tool.calendar' },
    analytics: { group: 'grow', icon: 'trophy', path: '/publish/analytics', title: 'analytics.title', body: 'publishHome.tool.analytics' },
    bestTime: { group: 'grow', icon: 'sparkle', path: '/publish/best-time', title: 'plan.menu.bestTime', body: 'publishHome.tool.bestTime' },
    drafts: { group: 'work', icon: 'bookmark', path: '/publish/drafts', title: 'drafts.title', body: 'publishHome.tool.drafts' },
    approvals: { group: 'manage', icon: 'thumbsUp', path: '/publish/approvals', title: 'approvals.title', body: 'publishHome.tool.approvals' },
    brands: { group: 'manage', icon: 'palette', path: '/publish/brands', title: 'brands.title', body: 'publishHome.tool.brands' },
    inbox: { group: 'engage', icon: 'chat', path: '/publish/inbox', title: 'inbox.title', body: 'publishHome.tool.inbox' },
    contacts: { group: 'engage', icon: 'user', path: '/publish/contacts', title: 'contacts.title', body: 'publishHome.tool.contacts' },
    workflows: { group: 'engage', icon: 'wrench', path: '/publish/workflows', title: 'publishWorkflows.title', body: 'publishHome.tool.workflows' },
    smartlink: { group: 'grow', icon: 'play', path: '/publish/smartlink', title: 'smartlink.title', body: 'publishHome.tool.smartlink' },
    queues: { group: 'work', icon: 'squares', path: '/publish/queues', title: 'queues.title', body: 'publishHome.tool.queues' },
    autolists: { group: 'work', icon: 'folder', path: '/publish/autolists', title: 'autolists.title', body: 'publishHome.tool.autolists' },
    reports: { group: 'grow', icon: 'slate', path: '/publish/reports', title: 'reports.title', body: 'publishHome.tool.reports' },
    ads: { group: 'grow', icon: 'flag', path: '/publish/ads', title: 'ads.title', body: 'publishHome.tool.ads' },
    commerce: { group: 'grow', icon: 'coins', path: '/publish/commerce', title: 'commerce.title', body: 'publishHome.tool.commerce' },
    team: { group: 'manage', icon: 'user', path: '/publish/team', title: 'team.title', body: 'publishHome.tool.team' },
    activity: { group: 'manage', icon: 'bookmark', path: '/publish/activity', title: 'activity.title', body: 'publishHome.tool.activity' },
    developer: { group: 'manage', icon: 'wrench', path: '/publish/developer', title: 'dev.row', body: 'publishHome.tool.developer' },
};

const when = (iso: string | null): string => iso ? new Date(iso).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '';

export default function Publish() {
    const { api: baseApi } = useAuth();
    const api = usePublishApi();
    const router = useRouter();
    const selectedBrand = useSyncExternalStore(brandStore.subscribe, brandStore.get, () => null);
    const { status: billingStatus, offerings, canPurchase, publishActive, purchase, restore } = useBilling();
    const [data, setData] = useState<PublishAccountsState | null>(null);
    const [posts, setPosts] = useState<PublishPost[]>([]);
    const [brands, setBrands] = useState<Brand[]>([]);
    const [error, setError] = useState<string | null>(null);
    const [refreshing, setRefreshing] = useState(false);
    const [selectedPlan, setSelectedPlan] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState<string | null>(null);

    const load = useCallback(async () => {
        try {
            const nextData = await fetchAccounts(api);
            const [nextPosts, nextBrands] = await Promise.all([
                fetchPosts(api).catch(() => null),
                fetchBrands(baseApi).catch(() => null),
            ]);
            setData(nextData);
            if (nextPosts) setPosts(nextPosts);
            if (nextBrands) {
                reconcileBrand(nextBrands);
                setBrands(nextBrands);
            }
            setError(null);
        } catch (err) {
            setError(publishErrorMessage(err));
        }
    }, [api, baseApi]);

    useFocusEffect(useCallback(() => { void load(); }, [load]));

    const summary = useMemo(() => data ? publishSummary(data, posts) : null, [data, posts]);
    const visible = useMemo(() => data ? publishDestinations(data) : [], [data]);
    const chosenBrand = selectedBrand ? brands.find((brand) => brand.id === selectedBrand) ?? null : null;
    const brandName = chosenBrand?.label ?? t('brands.mine');
    const paid = data ? hasPublishPlan(data) || publishActive : publishActive;
    const plans = toDisplayPackages(offerings?.all.publish?.availablePackages ?? []).filter((plan) => plan.interval !== null);
    const chosenPlan = plans.find((plan) => plan.id === (selectedPlan ?? plans.find((item) => item.interval === 'year')?.id)) ?? null;
    const canCreate = data ? canPublish(data.brandRole) : false;
    // Social OAuth currently belongs to the person's default brand. Never send a client-brand collaborator through a
    // flow that would silently connect the account somewhere else, and respect the account limit before offering it.
    const canConnect = data ? canConnectAccounts(data, selectedBrand) : false;
    const primaryPath: Href = summary?.connected && canCreate ? '/publish/compose' : canConnect ? '/publish/connect' : '/publish/accounts';
    const primaryLabel = summary?.connected && canCreate ? t('publishHome.newPost') : canConnect ? t('publishHome.connectAccount') : t('plan.menu.accounts');
    const primaryIcon: MenuIcon = summary?.connected && canCreate ? 'send' : 'user';

    async function subscribe() {
        const pkg = offerings?.all.publish?.availablePackages.find((item) => item.identifier === chosenPlan?.id);
        if (!pkg || busy) return;
        setBusy(true);
        setMessage(null);
        try {
            const result = await purchase(pkg);
            if (result === 'purchased') {
                setMessage(t('plan.thanks'));
                await load();
            }
        } catch {
            setMessage(t('plan.notCompleted'));
        } finally {
            setBusy(false);
        }
    }

    async function onRestore() {
        setBusy(true);
        setMessage(null);
        try {
            await restore();
            setMessage(t('plan.restored'));
            await load();
        } catch {
            setMessage(t('plan.restoreFailed'));
        } finally {
            setBusy(false);
        }
    }

    return (
        <ScrollView
            style={styles.screen}
            contentContainerStyle={styles.body}
            refreshControl={<RefreshControl refreshing={refreshing} tintColor={colors.accent} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}
        >
            <Stack.Screen options={{ title: t('tabs.publish') }} />
            <View style={styles.hero}>
                <Text style={styles.eyebrow}>{t('publishHome.eyebrow')}</Text>
                <Text style={styles.title} accessibilityRole="header">{t('publishHome.title')}</Text>
                <Text style={styles.lead}>{t('publishHome.lead')}</Text>
                <Pressable accessibilityRole="button" accessibilityLabel={t('publishHome.changeBrand', { brand: brandName })} style={({ pressed }) => [styles.brand, pressed && styles.pressed]} onPress={() => router.push('/publish/brands')}>
                    <View style={styles.brandMark}><Text style={styles.brandInitial}>{brandName.slice(0, 1).toUpperCase()}</Text></View>
                    <View style={styles.brandCopy}>
                        <Text style={styles.brandLabel}>{t('publishHome.publishingFor')}</Text>
                        <Text style={styles.brandName} numberOfLines={1}>{brandName}</Text>
                        {data ? <Text style={styles.brandRole}>{t('publishHome.role', { role: roleLabel(data.brandRole) })}</Text> : null}
                    </View>
                    <Image source={MENU_ICONS.caretRight} style={styles.caret} tintColor={colors.muted} contentFit="contain" accessibilityElementsHidden />
                </Pressable>
                {data ? <View style={styles.heroActions}>
                    <Pressable accessibilityRole="button" style={({ pressed }) => [styles.primary, pressed && styles.primaryPressed]} onPress={() => router.push(primaryPath)}>
                        <Image source={MENU_ICONS[primaryIcon]} style={styles.buttonIcon} tintColor={colors.accentInk} contentFit="contain" accessibilityElementsHidden />
                        <Text style={styles.primaryText}>{primaryLabel}</Text>
                    </Pressable>
                    <Pressable accessibilityRole="button" style={({ pressed }) => [styles.secondary, pressed && styles.pressed]} onPress={() => router.push('/library')}>
                        <Image source={MENU_ICONS.image} style={styles.buttonIcon} tintColor={colors.text} contentFit="contain" accessibilityElementsHidden />
                        <Text style={styles.secondaryText}>{t('publishHome.library')}</Text>
                    </Pressable>
                </View> : null}
            </View>

            {!data && !error ? <View style={styles.loading}><ActivityIndicator color={colors.accent} /><Text style={styles.muted}>{t('publishHome.loading')}</Text></View> : null}
            {error ? (
                <View style={styles.errorCard}>
                    <Text style={styles.error} accessibilityRole="alert">{error}</Text>
                    <Pressable accessibilityRole="button" style={styles.retry} onPress={() => void load()}><Text style={styles.retryText}>{t('publishHome.retry')}</Text></Pressable>
                </View>
            ) : null}

            {data && summary ? (
                <>
                    <View style={styles.stats}>
                        <Stat value={summary.connected} label={t('publishHome.connected')} />
                        <Stat value={summary.scheduled} label={t('publishHome.scheduled')} />
                        <Stat value={summary.attention + summary.failed} label={t('publishHome.attention')} danger={summary.attention + summary.failed > 0} />
                    </View>

                    <Pressable accessibilityRole="button" style={({ pressed }) => [styles.nextCard, pressed && styles.pressed]} onPress={() => router.push(summary.nextScheduled ? '/publish/calendar' : canCreate && summary.connected ? '/publish/compose' : '/publish/posts')}>
                        <View style={styles.nextIcon}><Image source={MENU_ICONS.squares} style={styles.toolIcon} tintColor={colors.accent} contentFit="contain" accessibilityElementsHidden /></View>
                        <View style={styles.nextCopy}>
                            <Text style={styles.sectionKicker}>{summary.nextScheduled ? t('publishHome.nextUp') : t('publishHome.schedule')}</Text>
                            <Text style={styles.nextTitle} numberOfLines={1}>{summary.nextScheduled?.text || t('publishHome.nothingScheduled')}</Text>
                            <Text style={styles.muted} numberOfLines={1}>{summary.nextScheduled ? when(summary.nextScheduled.scheduledAt) : t('publishHome.scheduleHint')}</Text>
                        </View>
                        <Image source={MENU_ICONS.caretRight} style={styles.caret} tintColor={colors.muted} contentFit="contain" accessibilityElementsHidden />
                    </Pressable>

                    {!paid && data.plansEnabled ? (
                        <View style={styles.planCard}>
                            <View style={styles.planHeading}>
                                <View style={styles.planBadge}><Text style={styles.planBadgeText}>{t('publishHome.upgradeBadge')}</Text></View>
                                <Text style={styles.planTitle}>{t('plan.headline')}</Text>
                                <Text style={styles.planLead}>{t('publishHome.upgradeLead')}</Text>
                            </View>
                            {billingStatus === 'loading' ? <ActivityIndicator color={colors.accent} /> : plans.length ? (
                                <>
                                    <View style={styles.plans}>
                                        {plans.map((plan) => (
                                            <Pressable key={plan.id} accessibilityRole="radio" accessibilityState={{ selected: chosenPlan?.id === plan.id }} style={[styles.plan, chosenPlan?.id === plan.id && styles.planOn]} onPress={() => setSelectedPlan(plan.id)}>
                                                <Text style={[styles.planName, chosenPlan?.id === plan.id && styles.planTextOn]}>{plan.interval ? t(PLAN_LABEL[plan.interval]) : plan.title}</Text>
                                                <Text style={[styles.planPrice, chosenPlan?.id === plan.id && styles.planTextOn]}>{plan.priceString}</Text>
                                            </Pressable>
                                        ))}
                                    </View>
                                    {chosenPlan?.interval ? <Text style={styles.terms}>{renewalTerms(chosenPlan.interval, chosenPlan.priceString, store)}</Text> : null}
                                    <Pressable accessibilityRole="button" disabled={!canPurchase || busy || !chosenPlan} style={[styles.primary, (!canPurchase || busy || !chosenPlan) && styles.off]} onPress={() => void subscribe()}>
                                        {busy ? <ActivityIndicator color={colors.accentInk} /> : <Text style={styles.primaryText}>{t('unlock.subscribe')}</Text>}
                                    </Pressable>
                                </>
                            ) : <Text style={styles.muted}>{t('plan.unavailable')}</Text>}
                            {message ? <Text style={styles.planMessage} accessibilityLiveRegion="polite">{message}</Text> : null}
                            <View style={styles.planLinks}>
                                <Pressable accessibilityRole="button" disabled={busy} onPress={() => void onRestore()}><Text style={styles.link}>{t('account.restore')}</Text></Pressable>
                                <Pressable accessibilityRole="link" onPress={() => void WebBrowser.openBrowserAsync(`${API_BASE}/legal/terms`)}><Text style={styles.link}>{t('plan.terms')}</Text></Pressable>
                                <Pressable accessibilityRole="link" onPress={() => void WebBrowser.openBrowserAsync(`${API_BASE}/legal/privacy`)}><Text style={styles.link}>{t('plan.privacy')}</Text></Pressable>
                            </View>
                        </View>
                    ) : (
                        <View style={styles.activePlan}><View style={styles.liveDot} /><Text style={styles.activePlanText}>{t('publishHome.fullPublishing')}</Text></View>
                    )}

                    {GROUPS.map((group) => {
                        const items = visible.filter((id) => DESTINATIONS[id].group === group);
                        if (!items.length) return null;
                        return (
                            <View key={group} style={styles.group}>
                                <Text style={styles.groupTitle}>{t(`publishHome.group.${group}`)}</Text>
                                <Text style={styles.groupLead}>{t(`publishHome.group.${group}.lead`)}</Text>
                                <View style={styles.grid}>
                                    {items.map((id) => <ToolCard key={id} destination={DESTINATIONS[id]} onPress={() => router.push(DESTINATIONS[id].path)} />)}
                                </View>
                            </View>
                        );
                    })}
                </>
            ) : null}
        </ScrollView>
    );
}

function Stat({ value, label, danger = false }: { readonly value: number; readonly label: string; readonly danger?: boolean }) {
    return <View style={styles.stat}><Text style={[styles.statValue, danger && styles.statDanger]}>{value}</Text><Text style={styles.statLabel}>{label}</Text></View>;
}

function ToolCard({ destination, onPress }: { readonly destination: Destination; readonly onPress: () => void }) {
    return (
        <Pressable accessibilityRole="button" accessibilityLabel={t(destination.title)} accessibilityHint={t(destination.body)} style={({ pressed }) => [styles.tool, pressed && styles.toolPressed]} onPress={onPress}>
            <View style={styles.toolTop}>
                <View style={styles.toolIconBox}><Image source={MENU_ICONS[destination.icon]} style={styles.toolIcon} tintColor={colors.accent} contentFit="contain" accessibilityElementsHidden /></View>
                <Image source={MENU_ICONS.caretRight} style={styles.smallCaret} tintColor={colors.muted} contentFit="contain" accessibilityElementsHidden />
            </View>
            <Text style={styles.toolTitle}>{t(destination.title)}</Text>
            <Text style={styles.toolBody} numberOfLines={2}>{t(destination.body)}</Text>
        </Pressable>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background },
    body: { padding: 16, paddingBottom: 40, gap: 18 },
    hero: { gap: 10, paddingTop: 4 },
    eyebrow: { color: colors.accent, fontSize: 12, fontWeight: '800', letterSpacing: 1.4 },
    title: { color: colors.text, fontFamily: fonts.displayHeavy, fontSize: 34, lineHeight: 38, letterSpacing: -0.8 },
    lead: { color: colors.body, fontSize: 16, lineHeight: 23, maxWidth: 520 },
    brand: { flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, borderRadius: 16, padding: 12, marginTop: 4 },
    brandMark: { width: 42, height: 42, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accentSoft, borderWidth: 1, borderColor: colors.accent },
    brandInitial: { color: colors.accent, fontFamily: fonts.display, fontSize: 18 },
    brandCopy: { flex: 1, gap: 1 },
    brandLabel: { color: colors.muted, fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.8 },
    brandName: { color: colors.text, fontSize: 16, fontWeight: '700' },
    brandRole: { color: colors.body, fontSize: 12 },
    caret: { width: 16, height: 16 },
    heroActions: { flexDirection: 'row', gap: 10, marginTop: 2 },
    primary: { flex: 1, minHeight: 52, borderRadius: 14, backgroundColor: colors.accent, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 16 },
    primaryPressed: { opacity: 0.82, transform: [{ scale: 0.985 }] },
    primaryText: { color: colors.accentInk, fontSize: 15, fontWeight: '800' },
    secondary: { minHeight: 52, borderRadius: 14, borderWidth: 1, borderColor: colors.borderStrong, backgroundColor: colors.surface, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 16 },
    secondaryText: { color: colors.text, fontSize: 15, fontWeight: '700' },
    buttonIcon: { width: 19, height: 19 },
    pressed: { opacity: 0.72 },
    loading: { minHeight: 120, alignItems: 'center', justifyContent: 'center', gap: 10 },
    errorCard: { borderRadius: 16, borderWidth: 1, borderColor: colors.danger, backgroundColor: colors.surface, padding: 16, gap: 12 },
    error: { color: colors.danger, fontSize: 14 },
    retry: { alignSelf: 'flex-start', borderRadius: 10, backgroundColor: colors.accent, paddingVertical: 10, paddingHorizontal: 16 },
    retryText: { color: colors.accentInk, fontWeight: '800' },
    stats: { flexDirection: 'row', gap: 8 },
    stat: { flex: 1, minHeight: 84, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, borderRadius: 14, padding: 12, justifyContent: 'space-between' },
    statValue: { color: colors.text, fontFamily: fonts.display, fontSize: 26 },
    statDanger: { color: colors.danger },
    statLabel: { color: colors.muted, fontSize: 12, fontWeight: '600' },
    nextCard: { flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, borderRadius: 16, padding: 14 },
    nextIcon: { width: 42, height: 42, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accentSoft },
    nextCopy: { flex: 1, gap: 2 },
    sectionKicker: { color: colors.accent, fontSize: 11, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.8 },
    nextTitle: { color: colors.text, fontSize: 15, fontWeight: '700' },
    muted: { color: colors.muted, fontSize: 13 },
    planCard: { borderWidth: 1, borderColor: colors.accent, backgroundColor: colors.surface, borderRadius: 18, padding: 16, gap: 12 },
    planHeading: { gap: 5 },
    planBadge: { alignSelf: 'flex-start', borderRadius: 999, backgroundColor: colors.accentSoft, paddingHorizontal: 10, paddingVertical: 5 },
    planBadgeText: { color: colors.accent, fontSize: 11, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.7 },
    planTitle: { color: colors.text, fontFamily: fonts.display, fontSize: 22 },
    planLead: { color: colors.body, fontSize: 14, lineHeight: 20 },
    plans: { gap: 8 },
    plan: { flexDirection: 'row', justifyContent: 'space-between', borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: 13 },
    planOn: { backgroundColor: colors.accent, borderColor: colors.accent },
    planName: { color: colors.text, fontSize: 15, fontWeight: '700' },
    planPrice: { color: colors.money, fontSize: 15, fontWeight: '800' },
    planTextOn: { color: colors.accentInk },
    terms: { color: colors.muted, fontSize: 12, lineHeight: 17 },
    planMessage: { color: colors.body, fontSize: 13 },
    planLinks: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 18 },
    link: { color: colors.muted, fontSize: 12, textDecorationLine: 'underline' },
    off: { opacity: 0.4 },
    activePlan: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 7, borderRadius: 999, backgroundColor: colors.accentSoft, paddingHorizontal: 12, paddingVertical: 7 },
    liveDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.accent },
    activePlanText: { color: colors.accent, fontSize: 12, fontWeight: '800' },
    group: { gap: 8 },
    groupTitle: { color: colors.text, fontFamily: fonts.display, fontSize: 21, marginTop: 4 },
    groupLead: { color: colors.muted, fontSize: 13, lineHeight: 18 },
    grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
    tool: { width: '48.5%', minHeight: 140, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, borderRadius: 16, padding: 14, gap: 7 },
    toolPressed: { borderColor: colors.accent, backgroundColor: colors.accentSoft, transform: [{ scale: 0.985 }] },
    toolTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    toolIconBox: { width: 38, height: 38, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accentSoft },
    toolIcon: { width: 21, height: 21 },
    smallCaret: { width: 13, height: 13 },
    toolTitle: { color: colors.text, fontSize: 15, fontWeight: '800' },
    toolBody: { color: colors.muted, fontSize: 12, lineHeight: 17 },
});
