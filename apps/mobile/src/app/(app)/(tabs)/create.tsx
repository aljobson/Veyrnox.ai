import { Image } from 'expo-image';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { FreeAllowanceCard } from '../../../components/FreeAllowanceCard';
import { fetchCatalogCached, type CatalogModel } from '../../../lib/media';
import { GOALS, TIERS, filterByTier, freeLeftFor, modelsForGoal, type Goal, type Tier } from '../../../lib/createOptions';
import { useFreeLeft } from '../../../lib/useFreeLeft';
import { selectedState, touchTarget } from '../../../lib/a11y';
import { fetchAgentListing } from '../../../lib/montage';
import { MENU_ICONS, type MenuIcon } from '../../../lib/menuIcons';
import { VEY_CLEARANCE } from '../../../components/VeyMascot';
import { colors, fonts } from '../../../theme';
import { plural, t } from '../../../lib/i18n';
import { useVeyScroll } from '../../../lib/useVeyScroll';

// One word per goal; the full "Make an image" wording stays as the accessibility label.
const SHORT_GOAL: Record<Goal, string> = { image: 'library.type.image', video: 'library.type.video', audio: 'library.type.audio', all: 'library.type.all' };
const GOAL_ICON: Record<Goal, MenuIcon> = { image: 'image', video: 'video', audio: 'audio', all: 'squares' };

function EntryTile({ icon, label, accessibilityLabel, onPress }: { readonly icon: MenuIcon; readonly label: string; readonly accessibilityLabel?: string; readonly onPress: () => void }) {
    return (
        <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel ?? label} style={({ pressed }) => [styles.entry, touchTarget, pressed && styles.entryPressed]} onPress={onPress}>
            <Image source={MENU_ICONS[icon]} style={styles.entryIcon} tintColor={colors.accent} contentFit="contain" accessibilityElementsHidden />
            <Text style={styles.entryText} numberOfLines={2}>{label}</Text>
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
            <Stack.Screen options={{ title: t('label.Create') }} />
            <Text style={styles.heading} accessibilityRole="header">{t('label.Create')}</Text>
            <View style={styles.entries}>
                <EntryTile icon="squares" label={t('label.Templates')} onPress={() => router.push('/create/presets')} />
                <EntryTile icon="wrench" label={t('menu.tools')} accessibilityLabel={t('toolsDir.entry')} onPress={() => router.push('/create/tools')} />
                <EntryTile icon="smiley" label={t('faceFilters.title')} onPress={() => router.push('/face-filters')} />
                <EntryTile icon="chat" label={t('chat.skills.title')} onPress={() => router.push('/chat/skills')} />
            </View>
            {models ? <FreeAllowanceCard models={models} left={freeLeft} /> : null}
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
            <View style={styles.tiers} accessibilityLabel={t('create.tierLabel')}>
                {[null, ...TIERS].map((x) => (
                    <Pressable key={x ?? 'all'} accessibilityRole="button" accessibilityState={selectedState(tier === x)} style={[styles.tierChip, touchTarget, tier === x && styles.tabOn]} onPress={() => setTier(x)}>
                        <Text style={[styles.tabText, tier === x && styles.tabTextOn]}>{t(`create.tier.${x ?? 'all'}`)}</Text>
                    </Pressable>
                ))}
            </View>
            {failed ? (
                <Text style={styles.error}>{t('create.loadError')}</Text>
            ) : models === null ? (
                <ActivityIndicator color={colors.accent} />
            ) : (
                <FlatList
                    contentContainerStyle={styles.list}
                    onScroll={onScroll}
                    scrollEventThrottle={64}
                    data={shown}
                    ListHeaderComponent={
                        (goal === 'video' || goal === 'all') && agent ? (
                            <Pressable accessibilityRole="button" style={styles.row} onPress={() => router.push('/create/agent')}>
                                <View style={styles.agentText}>
                                    <Text style={styles.name}>{t('create.agentTitle')}</Text>
                                    <Text style={styles.muted}>{t('create.agentHint')}</Text>
                                </View>
                                <Text style={styles.price}>{plural('create.agentFrom', agent.credits)}</Text>
                                <Image source={MENU_ICONS.caretRight} style={styles.caret} tintColor={colors.muted} contentFit="contain" accessibilityElementsHidden />
                            </Pressable>
                        ) : undefined
                    }
                    keyExtractor={(m) => m.id}
                    ListEmptyComponent={<Text style={styles.muted}>{t('create.noModels', { kind: kindWord })}</Text>}
                    renderItem={({ item }) => (
                        <Pressable accessibilityRole="button" style={styles.row} onPress={() => router.push({ pathname: '/create/[modelId]', params: { modelId: item.id } })}>
                            <Text style={styles.name}>{item.name}</Text>
                            {freeLeftFor(freeLeft, item.id) > 0 ? (
                                <Text style={styles.free} accessibilityLabel={t('create.freeLeftLabel', { name: item.name, count: String(freeLeftFor(freeLeft, item.id)) })}>
                                    {plural('create.freeLeft', freeLeftFor(freeLeft, item.id))}
                                </Text>
                            ) : (
                                <Text style={styles.price}>{plural('create.from', item.credits)}</Text>
                            )}
                            <Image source={MENU_ICONS.caretRight} style={styles.caret} tintColor={colors.muted} contentFit="contain" accessibilityElementsHidden />
                        </Pressable>
                    )}
                />
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    // The mascot sits in the bottom corner of every tab; the last row scrolls clear of it.
    list: { paddingBottom: VEY_CLEARANCE },
    screen: { flex: 1, backgroundColor: colors.background, padding: 16, gap: 12 },
    entries: { flexDirection: 'row', gap: 8 },
    entry: { flex: 1, alignItems: 'center', gap: 6, paddingVertical: 14, paddingHorizontal: 4, borderRadius: 12, backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1 },
    entryPressed: { opacity: 0.7 },
    entryIcon: { width: 28, height: 28 },
    entryText: { color: colors.text, fontSize: 12, fontWeight: '600', textAlign: 'center' },
    tabIcon: { width: 20, height: 20 },
    tabs: { flexDirection: 'row', gap: 8 },
    tab: { flex: 1, minHeight: 44, gap: 4, justifyContent: 'center', paddingVertical: 10, paddingHorizontal: 2, borderRadius: 10, alignItems: 'center', backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1 },
    tabOn: { backgroundColor: colors.accent, borderColor: colors.accent },
    tiers: { flexDirection: 'row', gap: 8 },
    tierChip: { flex: 1, paddingHorizontal: 8, borderRadius: 10, alignItems: 'center', backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1 },
    free: { color: colors.accent, fontWeight: '700' },
    tabText: { color: colors.body, fontWeight: '600' },
    tabTextOn: { color: colors.accentInk },
    row: { alignItems: 'center', paddingVertical: 16, borderBottomColor: colors.border, borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
    name: { color: colors.text, fontSize: 16, flexShrink: 1, flex: 1 },
    price: { color: colors.money, fontSize: 14, fontWeight: '600', backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4, overflow: 'hidden' },
    caret: { width: 14, height: 14 },
    heading: { color: colors.text, fontFamily: fonts.display, fontSize: 26 },
    muted: { color: colors.muted },
    agentText: { flexShrink: 1, gap: 2 },
    error: { color: colors.danger },
});
