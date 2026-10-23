import { Image } from 'expo-image';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { FreeAllowanceCard } from '../../../components/FreeAllowanceCard';
import { fetchCatalogCached, kindOf, type CatalogModel } from '../../../lib/media';
import { GOALS, TIERS, filterByTier, freeLeftFor, modelsForGoal, type Goal, type Tier } from '../../../lib/createOptions';
import { useFreeLeft } from '../../../lib/useFreeLeft';
import { selectedState, touchTarget } from '../../../lib/a11y';
import { fetchAgentListing } from '../../../lib/montage';
import { MENU_ICONS, type MenuIcon } from '../../../lib/menuIcons';
import { VEY_CLEARANCE } from '../../../components/VeyMascot';
import { colors, fonts, isDark } from '../../../theme';
import { plural, t } from '../../../lib/i18n';
import { useVeyScroll } from '../../../lib/useVeyScroll';

// One word per goal; the full "Make an image" wording stays as the accessibility label.
const SHORT_GOAL: Record<Goal, string> = { image: 'library.type.image', video: 'library.type.video', audio: 'library.type.audio', all: 'library.type.all' };
const GOAL_ICON: Record<Goal, MenuIcon> = { image: 'image', video: 'video', audio: 'audio', all: 'squares' };

function EntryTile({ icon, label, accessibilityLabel, onPress }: { readonly icon: MenuIcon; readonly label: string; readonly accessibilityLabel?: string; readonly onPress: () => void }) {
    return (
        <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel ?? label} style={({ pressed }) => [styles.entry, touchTarget, pressed && styles.entryPressed]} onPress={onPress}>
            <View style={styles.entryIconBox}>
                <Image source={MENU_ICONS[icon]} style={styles.entryIcon} tintColor={colors.accent} contentFit="contain" accessibilityElementsHidden />
            </View>
            <Text style={styles.entryText} numberOfLines={2}>{label}</Text>
            <Text style={styles.entryArrow} accessibilityElementsHidden>›</Text>
        </Pressable>
    );
}

export default function Create() {
    const onScroll = useVeyScroll();
    const router = useRouter();
    const params = useLocalSearchParams<{ goal?: string }>();
    const [models, setModels] = useState<CatalogModel[] | null>(null);
    const [failed, setFailed] = useState(false);
    const [goal, setGoal] = useState<Goal>(params.goal === 'video' || params.goal === 'audio' ? params.goal : 'image');
    const [tier, setTier] = useState<Tier | null>(null);
    const freeLeft = useFreeLeft();
    const [agent, setAgent] = useState<{ readonly credits: number } | null>(null);

    useEffect(() => {
        // Browsing the list works from a saved copy; the next screen loads the live catalog and prices.
        fetchCatalogCached((list) => setModels(list)).catch(() => setFailed(true));
        fetchAgentListing().then(setAgent);
    }, []);

    const goalModels = useMemo(() => modelsForGoal(models ?? [], goal), [models, goal]);
    // Tiers are thirds of the goal's own prices, as on the web. Cheapest first, so Low reads as the top of the list.
    const shown = useMemo(() => [...filterByTier(goalModels, tier)].sort((a, b) => a.credits - b.credits || a.name.localeCompare(b.name)), [goalModels, tier]);
    const kindWord = t(`create.goal.${goal}`).toLowerCase();

    return (
        <View style={styles.screen}>
            <StatusBar style={isDark ? 'light' : 'dark'} />
            <Stack.Screen options={{ title: t('label.Create') }} />
            {failed ? (
                <View style={styles.body}><Text style={styles.error}>{t('create.loadError')}</Text></View>
            ) : models === null ? (
                <ActivityIndicator color={colors.accent} />
            ) : (
                <FlatList
                    contentContainerStyle={styles.list}
                    onScroll={onScroll}
                    scrollEventThrottle={64}
                    data={shown}
                    ListHeaderComponent={
                        <View style={styles.header}>
                            <View style={styles.intro}>
                                <Text style={styles.eyebrow}>{t('create.eyebrow')}</Text>
                                <Text style={styles.heading} accessibilityRole="header">{t('label.Create')}</Text>
                                <Text style={styles.introText}>{t('create.intro')}</Text>
                            </View>

                            <View style={styles.sectionTop}>
                                <Text style={styles.sectionLabel}>{t('create.startFrom')}</Text>
                                <Text style={styles.sectionMeta}>{t('create.pickPreset')}</Text>
                            </View>
                            <View style={styles.entries}>
                                <EntryTile icon="squares" label={t('label.Templates')} onPress={() => router.push('/create/presets')} />
                                <EntryTile icon="wrench" label={t('menu.tools')} accessibilityLabel={t('toolsDir.entry')} onPress={() => router.push('/create/tools')} />
                                <EntryTile icon="smiley" label={t('faceFilters.title')} onPress={() => router.push('/face-filters')} />
                                <EntryTile icon="chat" label={t('chat.skills.title')} onPress={() => router.push('/chat/skills')} />
                            </View>

                            <View style={styles.sectionTop}>
                                <Text style={styles.sectionLabel}>{t('create.what')}</Text>
                                <Text style={styles.sectionMeta}>{t('create.freeChoice')}</Text>
                            </View>
                            <View style={styles.tabs} accessibilityLabel={t('create.goalLabel')}>
                                {GOALS.map((g) => (
                                    <Pressable
                                        key={g.goal}
                                        accessibilityRole="tab"
                                        accessibilityLabel={t(g.label)}
                                        accessibilityState={selectedState(goal === g.goal)}
                                        style={[styles.tab, goal === g.goal && styles.tabOn]}
                                        onPress={() => {
                                            setGoal(g.goal);
                                            setTier(null);
                                        }}
                                    >
                                        <Image source={MENU_ICONS[GOAL_ICON[g.goal]]} style={styles.tabIcon} tintColor={goal === g.goal ? colors.accentInk : colors.body} contentFit="contain" accessibilityElementsHidden />
                                        <Text style={[styles.tabText, goal === g.goal && styles.tabTextOn]} numberOfLines={1}>{t(SHORT_GOAL[g.goal])}</Text>
                                    </Pressable>
                                ))}
                            </View>
                            <Text style={styles.explainer}>{t('create.goalExplainer')}</Text>

                            <View style={styles.sectionTop}>
                                <Text style={styles.sectionLabel}>{t('create.model')}</Text>
                                <View style={styles.live}><View style={styles.liveDot} /><Text style={styles.liveText}>{t('create.livePrices')}</Text></View>
                            </View>
                            <View style={styles.tiers} accessibilityLabel={t('create.tierLabel')}>
                                {[null, ...TIERS].map((x) => (
                                    <Pressable key={x ?? 'all'} accessibilityRole="button" accessibilityState={selectedState(tier === x)} style={[styles.tierChip, touchTarget, tier === x && styles.tabOn]} onPress={() => setTier(x)}>
                                        <Text style={[styles.tabText, tier === x && styles.tabTextOn]}>{t(`create.tier.${x ?? 'all'}`)}</Text>
                                    </Pressable>
                                ))}
                            </View>
                            <Text style={styles.explainer}>{t('create.priceExplainer')}</Text>
                            <FreeAllowanceCard models={models} left={freeLeft} />
                            {(goal === 'video' || goal === 'all') && agent ? (
                                <Pressable accessibilityRole="button" style={({ pressed }) => [styles.row, styles.agentRow, pressed && styles.entryPressed]} onPress={() => router.push('/create/agent')}>
                                    <View style={styles.agentText}>
                                        <Text style={styles.modality}>{t('create.videoAgent')}</Text>
                                        <Text style={styles.name}>{t('create.agentTitle')}</Text>
                                        <Text style={styles.muted}>{t('create.agentHint')}</Text>
                                    </View>
                                    <Text style={styles.price}>{plural('create.agentFrom', agent.credits)}</Text>
                                    <Image source={MENU_ICONS.caretRight} style={styles.caret} tintColor={colors.muted} contentFit="contain" accessibilityElementsHidden />
                                </Pressable>
                            ) : null}
                        </View>
                    }
                    keyExtractor={(m) => m.id}
                    ListEmptyComponent={<Text style={styles.muted}>{t('create.noModels', { kind: kindWord })}</Text>}
                    renderItem={({ item }) => {
                        const kind = kindOf(item.modality);
                        return (
                        <Pressable accessibilityRole="button" style={({ pressed }) => [styles.row, pressed && styles.entryPressed]} onPress={() => router.push({ pathname: '/create/[modelId]', params: { modelId: item.id } })}>
                            <View style={styles.modelText}>
                                <Text style={styles.modality}>{kind ? t(SHORT_GOAL[kind]).toUpperCase() : item.modality.toUpperCase()}</Text>
                                <Text style={styles.name}>{item.name}</Text>
                            </View>
                            {freeLeftFor(freeLeft, item.id) > 0 ? (
                                <Text style={styles.free} accessibilityLabel={t('create.freeLeftLabel', { name: item.name, count: String(freeLeftFor(freeLeft, item.id)) })}>
                                    {plural('create.freeLeft', freeLeftFor(freeLeft, item.id))}
                                </Text>
                            ) : (
                                <Text style={styles.price}>{plural('create.from', item.credits)}</Text>
                            )}
                            <Image source={MENU_ICONS.caretRight} style={styles.caret} tintColor={colors.muted} contentFit="contain" accessibilityElementsHidden />
                        </Pressable>
                    );}}
                />
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    // The mascot sits in the bottom corner of every tab; the last row scrolls clear of it.
    list: { padding: 16, paddingTop: 24, paddingBottom: VEY_CLEARANCE, gap: 10 },
    body: { padding: 16 },
    screen: { flex: 1, backgroundColor: colors.background },
    header: { gap: 12, marginBottom: 4 },
    intro: { gap: 6, marginBottom: 8 },
    eyebrow: { color: colors.muted, fontSize: 10, fontWeight: '800', letterSpacing: 1.6 },
    heading: { color: colors.text, fontFamily: fonts.displayHeavy, fontSize: 40, lineHeight: 42, letterSpacing: -1.2 },
    introText: { color: colors.body, fontSize: 16, lineHeight: 24, maxWidth: 520 },
    sectionTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 },
    sectionLabel: { color: colors.text, fontSize: 11, fontWeight: '800', letterSpacing: 1.4 },
    sectionMeta: { color: colors.muted, fontSize: 11, fontWeight: '700' },
    entries: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 8 },
    entry: { width: '48.7%', minHeight: 58, flexDirection: 'row', alignItems: 'center', gap: 9, padding: 10, borderRadius: 13, backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1 },
    entryPressed: { opacity: 0.76, transform: [{ scale: 0.992 }] },
    entryIconBox: { width: 34, height: 34, borderRadius: 10, backgroundColor: colors.accentSoft, alignItems: 'center', justifyContent: 'center' },
    entryIcon: { width: 19, height: 19 },
    entryText: { color: colors.text, fontSize: 13, fontWeight: '700', flex: 1 },
    entryArrow: { color: colors.muted, fontSize: 20 },
    tabIcon: { width: 20, height: 20 },
    tabs: { flexDirection: 'row', gap: 8 },
    tab: { flex: 1, minHeight: 58, gap: 4, justifyContent: 'center', paddingVertical: 8, paddingHorizontal: 2, borderRadius: 12, alignItems: 'center', backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1 },
    tabOn: { backgroundColor: colors.accent, borderColor: colors.accent },
    tiers: { flexDirection: 'row', gap: 8 },
    tierChip: { flex: 1, minHeight: 40, paddingHorizontal: 8, borderRadius: 999, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1 },
    live: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.accent },
    liveText: { color: colors.accent, fontSize: 10, fontWeight: '800', letterSpacing: 1.1 },
    explainer: { color: colors.muted, fontSize: 12, lineHeight: 18 },
    free: { color: colors.accent, fontWeight: '700' },
    tabText: { color: colors.body, fontWeight: '600' },
    tabTextOn: { color: colors.accentInk },
    row: { minHeight: 76, alignItems: 'center', padding: 14, borderRadius: 14, backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, flexDirection: 'row', justifyContent: 'space-between', gap: 12, marginTop: 2 },
    agentRow: { borderColor: colors.accent },
    modelText: { flex: 1, gap: 4 },
    modality: { color: colors.muted, fontSize: 9, fontWeight: '800', letterSpacing: 1.2 },
    name: { color: colors.text, fontSize: 16, fontWeight: '700', flexShrink: 1 },
    price: { color: colors.money, fontSize: 14, fontWeight: '600', backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4, overflow: 'hidden' },
    caret: { width: 14, height: 14 },
    muted: { color: colors.muted },
    agentText: { flexShrink: 1, gap: 2 },
    error: { color: colors.danger },
});
