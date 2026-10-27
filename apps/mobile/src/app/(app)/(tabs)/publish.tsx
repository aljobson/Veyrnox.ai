import { Button, Card, Text, PriceText, themedStyles, useThemedStyles } from '../../../components/ui';
import { Image } from 'expo-image';
import { Stack, useFocusEffect, useRouter, type Href } from 'expo-router';
import { useCallback, useMemo, useState, useSyncExternalStore } from 'react';
import { ActivityIndicator, Platform, RefreshControl, ScrollView, View } from 'react-native';
import { useAuth } from '../../../auth/AuthProvider';
import { useBilling } from '../../../billing/BillingProvider';
import { renewalTerms, toDisplayPackages, type Interval } from '../../../lib/billing';
import { t } from '../../../lib/i18n';
import { MENU_ICONS, type MenuIcon } from '../../../lib/menuIcons';
import { fetchAccounts, fetchPosts, publishErrorMessage, type PublishAccountsState, type PublishPost } from '../../../lib/publish';
import { brandStore, fetchBrands, reconcileBrand, roleLabel, type Brand } from '../../../lib/publishBrand';
import { canConnectAccounts, canPublish, hasPublishPlan, publishDestinations, publishSummary, type PublishDestinationId } from '../../../lib/publishDashboard';
import { usePublishApi } from '../../../lib/usePublishApi';
import { VeyCardPeek, peekRoom } from '../../../components/VeyCardPeek';

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
    const styles = useThemedStyles(sheets);
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
            refreshControl={<RefreshControl refreshing={refreshing} tintColor={styles.accentInk.color} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}
        >
            <Stack.Screen options={{ title: t('tabs.publish') }} />
            <View style={styles.hero}>
                <Text variant="caption" style={styles.eyebrow}>{t('publishHome.eyebrow')}</Text>
                <Text variant="display" style={styles.title} accessibilityRole="header">{t('publishHome.title')}</Text>
                <Text variant="body" style={styles.lead}>{t('publishHome.lead')}</Text>
                <Card accessibilityRole="button" accessibilityLabel={t('publishHome.changeBrand', { brand: brandName })} style={[styles.brand]} onPress={() => router.push('/publish/brands')}>
                    <View style={styles.brandMark}><Text variant="bodyStrong" style={styles.brandInitial}>{brandName.slice(0, 1).toUpperCase()}</Text></View>
                    <View style={styles.brandCopy}>
                        <Text variant="caption" style={styles.brandLabel}>{t('publishHome.publishingFor')}</Text>
                        <Text variant="bodyStrong" style={styles.brandName} numberOfLines={1}>{brandName}</Text>
                        {data ? <Text variant="footnote" style={styles.brandRole}>{t('publishHome.role', { role: roleLabel(data.brandRole) })}</Text> : null}
                    </View>
                    <Image source={MENU_ICONS.caretRight} style={styles.caret} tintColor={styles.mutedInk.color} contentFit="contain" accessibilityElementsHidden />
                </Card>
                {data ? <View style={styles.heroActions}>
                    <Button label={primaryLabel} variant="primary" containerStyle={styles.grow} accessibilityRole="button" onPress={() => router.push(primaryPath)}>
                        <Image source={MENU_ICONS[primaryIcon]} style={styles.buttonIcon} tintColor={styles.onAccentInk.color} contentFit="contain" accessibilityElementsHidden />
                        <Text variant="bodyStrong" style={styles.primaryText}>{primaryLabel}</Text>
                    </Button>
                    <Button label={t('publishHome.library')} variant="secondary" accessibilityRole="button" onPress={() => router.push('/library')}>
                        <Image source={MENU_ICONS.image} style={styles.buttonIcon} tintColor={styles.textInk.color} contentFit="contain" accessibilityElementsHidden />
                        <Text variant="bodyStrong" style={styles.secondaryText}>{t('publishHome.library')}</Text>
                    </Button>
                </View> : null}
            </View>

            {!data && !error ? <View style={styles.loading}><ActivityIndicator color={styles.accentInk.color} /><Text variant="footnote" style={styles.muted}>{t('publishHome.loading')}</Text></View> : null}
            {error ? (
                <View style={styles.errorCard}>
                    <Text variant="footnote" style={styles.error} accessibilityRole="alert">{error}</Text>
                    <Button label={t('publishHome.retry')} variant="tertiary" accessibilityRole="button" onPress={() => void load()}><Text variant="bodyStrong" style={styles.retryText}>{t('publishHome.retry')}</Text></Button>
                </View>
            ) : null}

            {data && summary ? (
                <>
                    <View style={styles.stats}>
                        <Stat value={summary.connected} label={t('publishHome.connected')} />
                        <Stat value={summary.scheduled} label={t('publishHome.scheduled')} />
                        <Stat value={summary.attention + summary.failed} label={t('publishHome.attention')} danger={summary.attention + summary.failed > 0} />
                    </View>

                    <Card accessibilityRole="button" style={[styles.nextCard]} onPress={() => router.push(summary.nextScheduled ? '/publish/calendar' : canCreate && summary.connected ? '/publish/compose' : '/publish/posts')}>
                        <View style={styles.nextIcon}><Image source={MENU_ICONS.squares} style={styles.toolIcon} tintColor={styles.accentInk.color} contentFit="contain" accessibilityElementsHidden /></View>
                        <View style={styles.nextCopy}>
                            <Text variant="caption" style={styles.sectionKicker}>{summary.nextScheduled ? t('publishHome.nextUp') : t('publishHome.schedule')}</Text>
                            <Text variant="bodyStrong" style={styles.nextTitle} numberOfLines={1}>{summary.nextScheduled?.text || t('publishHome.nothingScheduled')}</Text>
                            <Text variant="footnote" style={styles.muted} numberOfLines={1}>{summary.nextScheduled ? when(summary.nextScheduled.scheduledAt) : t('publishHome.scheduleHint')}</Text>
                        </View>
                        <Image source={MENU_ICONS.caretRight} style={styles.caret} tintColor={styles.mutedInk.color} contentFit="contain" accessibilityElementsHidden />
                    </Card>

                    {!paid && data.plansEnabled ? (
                        <Card style={styles.planCard}>
                            <View style={styles.planHeading}>
                                <View style={styles.planBadge}><Text variant="caption" style={styles.planBadgeText}>{t('publishHome.upgradeBadge')}</Text></View>
                                <Text variant="title2" style={styles.planTitle}>{t('plan.headline')}</Text>
                                <Text variant="footnote" style={styles.planLead}>{t('publishHome.upgradeLead')}</Text>
                            </View>
                            {billingStatus === 'loading' ? <ActivityIndicator color={styles.accentInk.color} /> : plans.length ? (
                                <>
                                    <View style={styles.plans}>
                                        {plans.map((plan) => (
                                            <Card key={plan.id} accessibilityRole="radio" accessibilityState={{ selected: chosenPlan?.id === plan.id }} style={[styles.plan, chosenPlan?.id === plan.id && styles.planOn, selectedPlan === plan.id && { marginTop: peekRoom(72) }]} onPress={() => setSelectedPlan(plan.id)}>
                                                {selectedPlan === plan.id ? <VeyCardPeek width={72} /> : null}
                                                <Text variant="bodyStrong" style={[styles.planName, chosenPlan?.id === plan.id && styles.planTextOn]}>{plan.interval ? t(PLAN_LABEL[plan.interval]) : plan.title}</Text>
                                                <Text variant="bodyStrong" tone="warning">{plan.priceString}</Text>
                                            </Card>
                                        ))}
                                    </View>
                                    {chosenPlan?.interval ? <PriceText variant="caption" tone="secondary" text={renewalTerms(chosenPlan.interval, chosenPlan.priceString, store)} price={chosenPlan.priceString} /> : null}
                                    <Button label={t('unlock.subscribe')} variant="secondary" accessibilityRole="button" disabled={!canPurchase || busy || !chosenPlan}  onPress={() => void subscribe()}>
                                        {busy ? <ActivityIndicator color={styles.textInk.color} /> : <Text variant="bodyStrong">{t('unlock.subscribe')}</Text>}
                                    </Button>
                                </>
                            ) : <Text variant="footnote" style={styles.muted}>{t('plan.unavailable')}</Text>}
                            {message ? <Text variant="footnote" style={styles.planMessage} accessibilityLiveRegion="polite">{message}</Text> : null}
                            <View style={styles.planLinks}>
                                <Button label={t('account.restore')} variant="tertiary" accessibilityRole="button" disabled={busy || !canPurchase} onPress={() => void onRestore()}><Text variant="footnote" style={styles.link}>{t('account.restore')}</Text></Button>
                                <Button label={t('plan.terms')} variant="tertiary" accessibilityRole="link" onPress={() => void router.push('/legal/terms')}><Text variant="footnote" style={styles.link}>{t('plan.terms')}</Text></Button>
                                <Button label={t('plan.privacy')} variant="tertiary" accessibilityRole="link" onPress={() => void router.push('/legal/privacy')}><Text variant="footnote" style={styles.link}>{t('plan.privacy')}</Text></Button>
                            </View>
                        </Card>
                    ) : (
                        <View style={styles.activePlan}><View style={styles.liveDot} /><Text variant="footnote" style={styles.activePlanText}>{t('publishHome.fullPublishing')}</Text></View>
                    )}

                    {GROUPS.map((group) => {
                        const items = visible.filter((id) => DESTINATIONS[id].group === group);
                        if (!items.length) return null;
                        return (
                            <View key={group} style={styles.group}>
                                <Text variant="footnote" accessibilityRole="header" style={styles.groupTitle}>{t(`publishHome.group.${group}`)}</Text>
                                <Text variant="footnote" style={styles.groupLead}>{t(`publishHome.group.${group}.lead`)}</Text>
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
    const styles = useThemedStyles(sheets);
    return <Card style={styles.stat}><Text variant="title1" accessibilityRole={undefined} style={[styles.statValue, danger && styles.statDanger]}>{value}</Text><Text variant="footnote" style={styles.statLabel}>{label}</Text></Card>;
}

function ToolCard({ destination, onPress }: { readonly destination: Destination; readonly onPress: () => void }) {
    const styles = useThemedStyles(sheets);
    return (
        <Card accessibilityRole="button" accessibilityLabel={t(destination.title)} accessibilityHint={t(destination.body)} style={[styles.tool]} onPress={onPress}>
            <View style={styles.toolTop}>
                <View style={styles.toolIconBox}><Image source={MENU_ICONS[destination.icon]} style={styles.toolIcon} tintColor={styles.accentInk.color} contentFit="contain" accessibilityElementsHidden /></View>
                <Image source={MENU_ICONS.caretRight} style={styles.smallCaret} tintColor={styles.mutedInk.color} contentFit="contain" accessibilityElementsHidden />
            </View>
            <Text variant="bodyStrong" style={styles.toolTitle}>{t(destination.title)}</Text>
            <Text variant="footnote" style={styles.toolBody} numberOfLines={2}>{t(destination.body)}</Text>
        </Card>
    );
}

const sheets = themedStyles((p) => ({
    textInk: { color: p.textPrimary },
    mutedInk: { color: p.textSecondary },
    accentInk: { color: p.accent },
    onAccentInk: { color: p.onAccent },
    grow: { flex: 1 },
    screen: { flex: 1, backgroundColor: p.bg },
    body: { padding: 16, paddingBottom: 40, gap: 18 },
    hero: { gap: 10, paddingTop: 4 },
    eyebrow: { color: p.textSecondary },
    title: { color: p.textPrimary },
    lead: { color: p.textSecondary, maxWidth: 520 },
    brand: { flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1, borderColor: p.borderSubtle, backgroundColor: p.surface, borderRadius: 16, padding: 12, marginTop: 4 },
    brandMark: { width: 42, height: 42, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: p.accentSubtle, borderWidth: 1, borderColor: p.accent },
    brandInitial: { color: p.accent },
    brandCopy: { flex: 1, gap: 1 },
    brandLabel: { color: p.textSecondary },
    brandName: { color: p.textPrimary },
    brandRole: { color: p.textSecondary },
    caret: { width: 16, height: 16 },
    heroActions: { flexDirection: 'row', gap: 10, marginTop: 2 },
    primaryText: { color: p.onAccent },
    secondaryText: { color: p.textPrimary },
    buttonIcon: { width: 19, height: 19 },
    loading: { minHeight: 120, alignItems: 'center', justifyContent: 'center', gap: 10 },
    errorCard: { borderRadius: 16, borderWidth: 1, borderColor: p.danger, backgroundColor: p.surface, padding: 16, gap: 12 },
    error: { color: p.danger },
    retryText: { color: p.accent },
    stats: { flexDirection: 'row', gap: 8 },
    stat: { flex: 1, minHeight: 84, borderWidth: 1, borderColor: p.borderSubtle, backgroundColor: p.surface, borderRadius: 14, padding: 12, justifyContent: 'space-between' },
    statValue: { color: p.textPrimary },
    statDanger: { color: p.danger },
    statLabel: { color: p.textSecondary },
    nextCard: { flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1, borderColor: p.borderSubtle, backgroundColor: p.surface, borderRadius: 16, padding: 14 },
    nextIcon: { width: 42, height: 42, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: p.accentSubtle },
    nextCopy: { flex: 1, gap: 2 },
    sectionKicker: { color: p.textSecondary },
    nextTitle: { color: p.textPrimary },
    muted: { color: p.textSecondary },
    planCard: { borderWidth: 1, borderColor: p.accent, backgroundColor: p.surface, borderRadius: 18, padding: 16, gap: 12 },
    planHeading: { gap: 5 },
    planBadge: { alignSelf: 'flex-start', borderRadius: 999, backgroundColor: p.accentSubtle, paddingHorizontal: 10, paddingVertical: 5 },
    planBadgeText: { color: p.textSecondary },
    planTitle: { color: p.textPrimary },
    planLead: { color: p.textSecondary },
    plans: { gap: 8 },
    plan: { flexDirection: 'row', justifyContent: 'space-between', borderWidth: 1, borderColor: p.borderSubtle, borderRadius: 12, padding: 13 },
    planOn: { backgroundColor: p.accentSubtle, borderColor: p.accent },
    planName: { color: p.textPrimary },
    planTextOn: { color: p.accent },
    planMessage: { color: p.textSecondary },
    planLinks: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 18 },
    link: { color: p.textSecondary, textDecorationLine: 'underline' },
    activePlan: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 7, borderRadius: 999, backgroundColor: p.accentSubtle, paddingHorizontal: 12, paddingVertical: 7 },
    liveDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: p.accent },
    activePlanText: { color: p.accent },
    group: { gap: 8 },
    groupTitle: { color: p.textSecondary, marginTop: 4 },
    groupLead: { color: p.textSecondary },
    grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
    tool: { width: '48.5%', minHeight: 140, borderWidth: 1, borderColor: p.borderSubtle, backgroundColor: p.surface, borderRadius: 16, padding: 14, gap: 7 },
    toolTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    toolIconBox: { width: 38, height: 38, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: p.accentSubtle },
    toolIcon: { width: 21, height: 21 },
    smallCaret: { width: 13, height: 13 },
    toolTitle: { color: p.textPrimary },
    toolBody: { color: p.textSecondary },
}));
