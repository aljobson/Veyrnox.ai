import { rawText } from '../../../lib/i18n/translate';
import { useFaceFiltersAvailable } from '../../../lib/useFaceFiltersAvailable';
import { createTileColumns } from '../../../lib/createLayout';
import { SectionLabel } from '../../../components/create/SectionLabel';
import { Text, Card, Chip, Icon, ListRow, SegmentedControl, themedStyles, useThemedStyles, useAppearance } from '../../../components/ui';

import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, View, useWindowDimensions } from 'react-native';
import { FreeAllowanceCard } from '../../../components/FreeAllowanceCard';
import { fetchCatalogCached, kindOf, type CatalogModel } from '../../../lib/media';
import { GOALS, TIERS, filterByTier, freeLeftFor, modelsForGoal, type Goal, type Tier } from '../../../lib/createOptions';
import { useFreeLeft } from '../../../lib/useFreeLeft';
import { selectedState } from '../../../lib/a11y';
import { fetchAgentListing } from '../../../lib/montage';
import { type MenuIcon } from '../../../lib/menuIcons';
import { ds, TEXT_SCALE, LIST_END_PADDING } from '../../../theme';
import { plural, t } from '../../../lib/i18n';

// One word per goal; the full "Make an image" wording stays as the accessibility label.
const SHORT_GOAL: Record<Goal, string> = { image: 'library.type.image', video: 'library.type.video', audio: 'library.type.audio', all: 'library.type.all' };
const GOAL_ICON: Record<Goal, MenuIcon> = { image: 'image', video: 'video', audio: 'audio', all: 'squares' };

export function EntryTile({ icon, label, accessibilityLabel, onPress }: { readonly icon: MenuIcon; readonly label: string; readonly accessibilityLabel?: string; readonly onPress: () => void }) {
    const styles = useThemedStyles(sheets);
    const { width, fontScale } = useWindowDimensions();
    const { settings } = useAppearance();
    const single = createTileColumns(width, fontScale, TEXT_SCALE[settings.textSize]) === 1;
    return <ListRow icon={icon} title={label} accessibilityLabel={rawText(accessibilityLabel ?? label)} onPress={onPress} style={[styles.entry, { width: single ? '100%' : '48.7%' }]} />;
}

export default function Create() {
    const faceAvailable = useFaceFiltersAvailable();
    const { scheme, settings } = useAppearance();
    const { width, fontScale } = useWindowDimensions();
    const largeText = createTileColumns(width, fontScale, TEXT_SCALE[settings.textSize]) === 1;
    const styles = useThemedStyles(sheets);
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
    const kindWord = t(`create.goal.${goal}`);

    return (
        <View style={styles.screen}>
            <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
            <Stack.Screen options={{ title: t('label.Create') }} />
            {failed ? (
                <View style={styles.body}><Text variant="body" tone="danger" style={styles.error}>{t('create.loadError')}</Text></View>
            ) : models === null ? (
                <ActivityIndicator color={styles.accentInk.color} />
            ) : (
                <FlatList
                    contentContainerStyle={styles.list}
                    data={shown}
                    ListHeaderComponent={
                        <View style={styles.header}>
                            <View style={styles.intro}>
                                <Text variant="title1" tone="primary" style={styles.heading} accessibilityRole="header">{t('label.Create')}</Text>
                                <Text variant="body" tone="secondary" style={styles.introText}>{t('create.intro')}</Text>
                            </View>

                            <View style={styles.sectionTop}>
                                <SectionLabel style={styles.sectionLabel}>{t('create.startFrom')}</SectionLabel>
                                <SectionLabel style={styles.sectionMeta}>{t('create.pickPreset')}</SectionLabel>
                            </View>
                            <View style={styles.entries}>
                                <EntryTile icon="squares" label={t('label.Templates')} onPress={() => router.push('/create/presets')} />
                                <EntryTile icon="wrench" label={t('menu.tools')} accessibilityLabel={t('toolsDir.entry')} onPress={() => router.push('/create/tools')} />
                                {faceAvailable ? <EntryTile icon="smiley" label={t('faceFilters.title')} onPress={() => router.push('/face-filters')} /> : null}
                                {models.some(m => m.id === 'wan-2.5-kie' && !m.gated) ? <EntryTile icon="film" label={t('facelessReel.chip')} onPress={() => router.push('/faceless-reel')} /> : null}
                                <EntryTile icon="chat" label={t('chat.skills.title')} onPress={() => router.push('/chat/skills')} />
                            </View>

                            <View style={styles.sectionTop}>
                                <SectionLabel style={styles.sectionLabel}>{t('create.what')}</SectionLabel>
                                <SectionLabel style={styles.sectionMeta}>{t('create.freeChoice')}</SectionLabel>
                            </View>
                            <SegmentedControl style={largeText ? styles.stacked : undefined} accessibilityLabel={t('create.goalLabel')} options={GOALS.map(g => ({ value: g.goal, label: t(SHORT_GOAL[g.goal]), accessibilityLabel: t(g.label), icon: GOAL_ICON[g.goal] }))} value={goal} onChange={next => { setGoal(next); setTier(null); }} />
                            <Text variant="caption" tone="tertiary" style={styles.explainer}>{t('create.goalExplainer')}</Text>

                            <View style={styles.sectionTop}>
                                <SectionLabel style={styles.sectionLabel}>{t('create.model')}</SectionLabel>
                                <View style={styles.live}><View style={styles.liveDot} /><SectionLabel style={styles.liveText}>{t('create.livePrices')}</SectionLabel></View>
                            </View>
                            <View style={[styles.tiers, largeText && styles.stacked]} accessibilityLabel={t('create.tierLabel')}>
                                {[null, ...TIERS].map((x) => (
                                    <Chip style={styles.tier} fullWidth selected={tier === x} key={x ?? 'all'} accessibilityRole="button" accessibilityState={selectedState(tier === x)} onPress={() => setTier(x)} label={t(`create.tier.${x ?? 'all'}`)} />
                                ))}
                            </View>
                            <Text variant="caption" tone="tertiary" style={styles.explainer}>{t('create.priceExplainer')}</Text>
                            <FreeAllowanceCard models={models} left={freeLeft} />
                            {(goal === 'video' || goal === 'all') && agent ? (
                                <Card accessibilityRole="button" style={[styles.row, styles.agentRow, largeText && styles.modelStack]} onPress={() => router.push('/create/agent')}>
                                    <View style={styles.agentText}>
                                        <SectionLabel style={styles.modality}>{t('create.videoAgent')}</SectionLabel>
                                        <Text variant="bodyStrong" tone="primary" style={styles.name}>{t('create.agentTitle')}</Text>
                                        <Text variant="body" tone="tertiary" style={styles.muted}>{t('create.agentHint')}</Text>
                                    </View>
                                    <Text variant="footnote" tone="warning" style={styles.price}>{plural('create.agentFrom', agent.credits)}</Text>
                                    <Icon name="caretRight" size={20} />
                                </Card>
                            ) : null}
                        </View>
                    }
                    keyExtractor={(m) => m.id}
                    ListEmptyComponent={<Text variant="body" tone="tertiary" style={styles.muted}>{t('create.noModels', { kind: kindWord })}</Text>}
                    renderItem={({ item }) => {
                        const kind = kindOf(item.modality);
                        return (
                        <Card accessibilityRole="button" style={[styles.row, largeText && styles.modelStack]} onPress={() => router.push({ pathname: '/create/[modelId]', params: { modelId: item.id } })}>
                            <View style={styles.modelText}>
                                <SectionLabel style={styles.modality}>{kind ? t(SHORT_GOAL[kind]) : item.modality}</SectionLabel>
                                <Text variant="bodyStrong" tone="primary" style={styles.name}>{item.name}</Text>
                            </View>
                            {freeLeftFor(freeLeft, item.id) > 0 ? (
                                <Text variant="body" tone="accent" style={styles.free} accessibilityLabel={rawText(t('create.freeLeftLabel', { name: item.name, count: String(freeLeftFor(freeLeft, item.id)) }))}>
                                    {plural('create.freeLeft', freeLeftFor(freeLeft, item.id))}
                                </Text>
                            ) : (
                                <Text variant="footnote" tone="warning" style={styles.price}>{plural('create.from', item.credits)}</Text>
                            )}
                            <Icon name="caretRight" size={20} />
                        </Card>
                    );}}
                />
            )}
        </View>
    );
}

const sheets = themedStyles((p) => ({
    accentInk: { color: p.accent },

    list: { padding: ds.space.lg, paddingTop: ds.space.xl, paddingBottom: LIST_END_PADDING, gap: ds.space.sm },
    body: { padding: ds.space.lg },
    screen: { flex: 1, backgroundColor: p.bg },
    header: { gap: ds.space.md, marginBottom: ds.space.xs },
    intro: { gap: ds.space.sm, marginBottom: ds.space.sm },
    heading: { color: p.textPrimary, },
    introText: { color: p.textSecondary, maxWidth: 520 },
    sectionTop: { flexDirection: 'row', flexWrap: 'wrap', gap: ds.space.sm, alignItems: 'center', justifyContent: 'space-between', marginTop: ds.space.sm },
    sectionLabel: { },
    sectionMeta: { },
    entries: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: ds.space.sm },
    entry: { minHeight: 58, flexDirection: 'row', alignItems: 'center', gap: ds.space.sm, padding: ds.space.sm, borderRadius: ds.radius.md, backgroundColor: p.bgElevated1, borderColor: p.borderSubtle, borderWidth: 1 },
    stacked: { flexDirection: 'column' },
    modelStack: { flexDirection: 'column', alignItems: 'flex-start' },
    tier: { flex: 1 },
    tiers: { flexDirection: 'row', gap: ds.space.sm },
    live: { flexDirection: 'row', alignItems: 'center', gap: ds.space.sm },
    liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: p.accent },
    liveText: { },
    explainer: { color: p.textTertiary, },
    free: { color: p.accent, fontVariant: ['tabular-nums'], },
    row: { minHeight: 76, alignItems: 'center', padding: ds.space.md, borderRadius: ds.radius.md, backgroundColor: p.bgElevated1, borderColor: p.borderSubtle, borderWidth: 1, flexDirection: 'row', justifyContent: 'space-between', gap: ds.space.md, marginTop: ds.space.xxs },
    agentRow: { borderColor: p.accent },
    modelText: { flex: 1, gap: ds.space.xs },
    modality: { },
    name: { color: p.textPrimary, flexShrink: 1 },
    price: { backgroundColor: p.bgElevated1, borderColor: p.borderSubtle, borderWidth: 1, borderRadius: ds.radius.pill, paddingHorizontal: ds.space.sm, paddingVertical: ds.space.xs, overflow: 'hidden', color: p.warning, fontVariant: ['tabular-nums'], },
    muted: { color: p.textTertiary },
    agentText: { flexShrink: 1, gap: ds.space.xxs },
    error: { color: p.danger },
}));
