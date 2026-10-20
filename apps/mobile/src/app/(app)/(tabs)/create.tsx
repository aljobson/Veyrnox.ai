import { Stack, useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { FreeAllowanceCard } from '../../../components/FreeAllowanceCard';
import { fetchCatalogCached, type CatalogModel } from '../../../lib/media';
import { GOALS, TIERS, filterByTier, freeLeftFor, modelsForGoal, type Goal, type Tier } from '../../../lib/createOptions';
import { useFreeLeft } from '../../../lib/useFreeLeft';
import { selectedState, touchTarget } from '../../../lib/a11y';
import { fetchAgentListing } from '../../../lib/montage';
import { VEY_CLEARANCE } from '../../../components/VeyMascot';
import { colors } from '../../../theme';
import { plural, t } from '../../../lib/i18n';

export default function Create() {
    const router = useRouter();
    const [models, setModels] = useState<CatalogModel[] | null>(null);
    const [failed, setFailed] = useState(false);
    const [goal, setGoal] = useState<Goal>('image');
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
            <Pressable accessibilityRole="button" style={styles.templates} onPress={() => router.push('/create/presets')}>
                <Text style={styles.name}>{t('label.Templates')}</Text>
                <Text style={styles.muted}>{t('create.templatesHint')}</Text>
            </Pressable>
            <Pressable accessibilityRole="button" style={styles.templates} onPress={() => router.push('/create/tools')}>
                <Text style={styles.name}>{t('toolsDir.entry')}</Text>
                <Text style={styles.muted}>{t('toolsDir.entryHint')}</Text>
            </Pressable>
            {models ? <FreeAllowanceCard models={models} left={freeLeft} /> : null}
            <View style={styles.tabs} accessibilityLabel={t('create.goalLabel')}>
                {GOALS.map((g) => (
                    <Pressable
                        key={g.goal}
                        accessibilityRole="tab"
                        accessibilityState={selectedState(goal === g.goal)}
                        style={[styles.tab, goal === g.goal && styles.tabOn]}
                        onPress={() => {
                            setGoal(g.goal);
                            setTier(null);
                        }}
                    >
                        <Text style={[styles.tabText, goal === g.goal && styles.tabTextOn]}>{t(g.label)}</Text>
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
                    data={shown}
                    ListHeaderComponent={
                        (goal === 'video' || goal === 'all') && agent ? (
                            <Pressable accessibilityRole="button" style={styles.row} onPress={() => router.push('/create/agent')}>
                                <View style={styles.agentText}>
                                    <Text style={styles.name}>{t('create.agentTitle')}</Text>
                                    <Text style={styles.muted}>{t('create.agentHint')}</Text>
                                </View>
                                <Text style={styles.price}>{plural('create.agentFrom', agent.credits)}</Text>
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
    templates: { padding: 14, borderRadius: 12, backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, gap: 2 },
    tabs: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    tab: { flexGrow: 1, flexBasis: '45%', minHeight: 44, justifyContent: 'center', paddingVertical: 10, borderRadius: 10, alignItems: 'center', backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1 },
    tabOn: { backgroundColor: colors.accent, borderColor: colors.accent },
    tiers: { flexDirection: 'row', gap: 8 },
    tierChip: { flex: 1, paddingHorizontal: 8, borderRadius: 10, alignItems: 'center', backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1 },
    free: { color: colors.accent, fontWeight: '700' },
    tabText: { color: colors.body, fontWeight: '600' },
    tabTextOn: { color: colors.accentInk },
    row: { paddingVertical: 14, borderBottomColor: colors.border, borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
    name: { color: colors.text, fontSize: 16, flexShrink: 1 },
    price: { color: colors.money },
    muted: { color: colors.muted },
    agentText: { flexShrink: 1, gap: 2 },
    error: { color: colors.danger },
});
