import { useOwnerProofCatalog } from '../../../lib/useOwnerProofModels';
import { rawText } from '../../../lib/i18n/translate';
import { createTileColumns } from '../../../lib/createLayout';
import { SectionLabel } from '../../../components/create/SectionLabel';
import { Button, Text, VividCard, themedStyles, useThemedStyles, useAppearance } from '../../../components/ui';

import { Stack, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ScrollView, View, useWindowDimensions } from 'react-native';
import { LoadingSkeleton } from '../../../components/LoadingSkeleton';
import { fetchCatalogCached, type CatalogModel, type Kind } from '../../../lib/media';
import { starterModel } from '../../../lib/createOptions';
import { EXAMPLE, FirstGoalCard } from '../../../components/create/FirstGoalCard';
import { firstGoalTarget, type FirstGoal } from '../../../lib/firstGoal';
import { homeStartRecorded, readFirstGoal, writeFirstGoal } from '../../../lib/firstGoalStore';
import { fetchRemoteFirstGoal, pushFirstGoal } from '../../../lib/firstGoalSync';
import { useAuth } from '../../../auth/AuthProvider';
import { fetchAgentListing } from '../../../lib/montage';
import { type MenuIcon } from '../../../lib/menuIcons';
import { type FeatureIcon } from '../../../lib/featureIcons';
import { ds, TEXT_SCALE, LIST_END_PADDING, vividFromFeatureHue, type VividHue } from '../../../theme';
import { t } from '../../../lib/i18n';

export function EntryTile({ icon, label, hue = 'blue', accessibilityLabel, onPress }: { readonly icon: MenuIcon; readonly label: string; readonly hue?: VividHue; readonly accessibilityLabel?: string; readonly onPress: () => void }) {
    const styles = useThemedStyles(sheets);
    const { width, fontScale } = useWindowDimensions();
    const { settings } = useAppearance();
    const single = createTileColumns(width, fontScale, TEXT_SCALE[settings.textSize]) === 1;
    return <VividCard hue={hue} icon={icon} title={label} accessibilityLabel={rawText(accessibilityLabel ?? label)} onPress={onPress} style={[styles.entry, { width: single ? '100%' : '48.7%' }]} />;
}

// Create is for visual generation. Music, speech and sound have their own workspaces from Home and Audio.
const MAKE: readonly { readonly kind: Kind; readonly label: string; readonly badge: FeatureIcon }[] = [
    { kind: 'image', label: 'create.goal.image', badge: { icon: 'image', hue: 'sky' } },
    { kind: 'video', label: 'create.goal.video', badge: { icon: 'video', hue: 'iris' } },
];

// Create starts from what you want to make, not from a list of models. Each goal opens the form with its starter
// model (the cheapest one that works from a prompt alone, as on the web); "Change model" on the form switches it, and
// Generate shows the exact cost.
export default function Create() {
    const { scheme } = useAppearance();
    const styles = useThemedStyles(sheets);
    const router = useRouter();
    const [publicModels, setModels] = useState<CatalogModel[] | null>(null);
    const models = useOwnerProofCatalog(publicModels ?? []);
    const [failed, setFailed] = useState(false);
    const [agent, setAgent] = useState<{ readonly credits: number } | null>(null);

    // A saved copy of the catalog is enough to choose the starter model; the form loads the live one.
    const loadCatalog = useCallback(() => {
        setFailed(false);
        fetchCatalogCached((list) => setModels(list)).catch(() => setFailed(true));
    }, []);
    useEffect(() => {
        loadCatalog();
        fetchAgentListing().then(setAgent);
    }, [loadCatalog]);

    const starters = useMemo(() => MAKE
        .map((goal) => ({ ...goal, model: starterModel(models ?? [], goal.kind) }))
        .filter((goal) => goal.model), [models]);

    // The first-goal question is asked once per account. The account's own answer wins when the server has one (so a
    // second phone, or a second account on this phone, is right); only when it cannot be asked does this phone's copy decide.
    // Until the answer is known nothing is shown.
    const { api } = useAuth();
    const [asked, setAsked] = useState<'checking' | 'ask' | 'done'>('checking');
    useEffect(() => {
        let alive = true;
        (async () => {
            if (homeStartRecorded()) { setAsked('done'); return; }
            const remote = await fetchRemoteFirstGoal(api);
            if (!alive) return;
            if (remote.kind === 'goal') { void writeFirstGoal(remote.goal); setAsked('done'); return; }
            if (remote.kind === 'none') { setAsked('ask'); return; }
            const local = await readFirstGoal();
            if (alive) setAsked(local ? 'done' : 'ask');
        })();
        return () => { alive = false; };
    }, [api]);
    const chooseFirstGoal = useCallback((goal: FirstGoal) => {
        setAsked('done');
        void writeFirstGoal(goal);
        void pushFirstGoal(api, goal);
        const target = firstGoalTarget(goal);
        if (target.kind === 'tab') return router.push(target.href);
        if (target.kind !== 'create') return;
        const model = starters.find((s) => s.kind === target.goal)?.model;
        if (model) router.push({ pathname: '/create/[modelId]', params: { modelId: model.id, prompt: EXAMPLE[target.goal]() } });
    }, [api, router, starters]);
    const skipFirstGoal = useCallback(() => { setAsked('done'); void writeFirstGoal('skipped'); void pushFirstGoal(api, 'skipped'); }, [api]);

    return (
        <View style={styles.screen}>
            <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
            <Stack.Screen options={{ title: t('label.Create') }} />
            {failed ? (
                <View style={styles.body}>
                    <Text variant="body" tone="danger" style={styles.error}>{t('create.loadError')}</Text>
                    <Button label={t('recovery.retry')} onPress={loadCatalog} />
                </View>
            ) : publicModels === null ? (
                <LoadingSkeleton variant="form" />
            ) : (
                <ScrollView contentContainerStyle={styles.list}>
                    <View style={styles.intro}>
                        <Text variant="title1" tone="primary" style={styles.heading} accessibilityRole="header">{t('label.Create')}</Text>
                        <Text variant="body" tone="secondary" style={styles.introText}>{t('create.intro')}</Text>
                    </View>

                    {asked === 'ask' ? <FirstGoalCard onChoose={chooseFirstGoal} onSkip={skipFirstGoal} /> : null}

                    {asked !== 'ask' ? (<>
                    <SectionLabel style={styles.sectionTop}>{t('create.what')}</SectionLabel>
                    <View style={styles.goals}>
                        {starters.map((goal) => (
                            <EntryTile key={goal.kind} hue={vividFromFeatureHue(goal.badge.hue)} icon={goal.badge.icon} label={t(goal.label)}
                                onPress={() => goal.model && router.push({ pathname: '/create/[modelId]', params: { modelId: goal.model.id } })} />
                        ))}
                        {starters.length === 0 ? <Text variant="body" tone="tertiary">{t('create.noModels', { kind: t('library.type.all') })}</Text> : null}
                    </View>
                    </>) : null}

                    <SectionLabel style={styles.sectionTop}>{t('create.startFrom')}</SectionLabel>
                    <View style={styles.entries}>
                        <EntryTile hue="purple" icon="squares" label={`${t('templates.kind.video')} ${t('label.Templates')}`} onPress={() => router.push('/create/presets')} />
                        <EntryTile hue="pink" icon="squares" label={`${t('templates.kind.image')} ${t('label.Templates')}`} onPress={() => router.push({ pathname: '/create/presets', params: { kind: 'image' } })} />
                        <EntryTile hue="green" icon="squares" label={t('label.Templates')} onPress={() => router.push({ pathname: '/create/presets', params: { kind: 'crun' } })} />
                        <EntryTile hue="orange" icon="wrench" label={t('menu.tools')} accessibilityLabel={t('toolsDir.entry')} onPress={() => router.push('/create/tools')} />
                        {models.some(m => m.id === 'wan-2.5-kie' && !m.gated) ? <EntryTile hue="green" icon="film" label={t('facelessReel.chip')} onPress={() => router.push('/faceless-reel')} /> : null}
                        {agent ? <EntryTile hue="purple" icon="filmReel" label={t('create.agentTitle')} accessibilityLabel={rawText(`${t('create.agentTitle')}. ${t('create.agentHint')}`)} onPress={() => router.push('/create/agent')} /> : null}
                        <EntryTile hue="blue" icon="chat" label={t('chat.skills.title')} onPress={() => router.push('/chat/skills')} />
                    </View>
                </ScrollView>
            )}
        </View>
    );
}

const sheets = themedStyles((p) => ({
    screen: { flex: 1, backgroundColor: p.bg },
    body: { paddingHorizontal: ds.space.gutter, paddingVertical: ds.space.lg },
    list: { paddingHorizontal: ds.space.gutter, paddingTop: ds.space.xl, paddingBottom: LIST_END_PADDING, gap: ds.space.md },
    intro: { gap: ds.space.sm },
    heading: { color: p.textPrimary },
    introText: { color: p.textSecondary, maxWidth: 520 },
    sectionTop: { marginTop: ds.space.md },
    goals: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: ds.space.sm },
    entries: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: ds.space.sm },
    entry: { minHeight: 150 },
    error: { color: p.danger },
}));
