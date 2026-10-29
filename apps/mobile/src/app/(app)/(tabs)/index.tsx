import { categoryLabel } from '../../../lib/presetCategoryLabel';
import { CheckInEntry } from '../../../components/credits/CheckInEntry';
import { Link, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { type ComponentRef, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, TextInput, View } from 'react-native';
import { useAuth } from '../../../auth/AuthProvider';
import { celebrateFinished } from '../../../lib/celebrate';
import { ALL_CATEGORIES, ALL_TYPES, filterPresets, firstModelFor, pickUp, promptHref, recentCreations, type TypeFilter } from '../../../lib/explore';
import { t } from '../../../lib/i18n';
import { fetchCatalogCached, mediaApi, type CatalogModel, type Job, type Kind } from '../../../lib/media';
import { LowBalanceNote } from '../../../components/LowBalanceNote';
import { CREATOR_PROFILE_ENABLED, syncVibe } from '../../../lib/creatorProfile';
import { loadVibe, storeVibe } from '../../../lib/creatorProfileStore';
import type { CreatorAnswers } from '../../../lib/creatorAnswers';
import { rankPresets } from '../../../lib/creatorTaste';
import { cheapestCredits, isLowBalance } from '../../../lib/lowBalance';
import { useBalance } from '../../../lib/useBalance';
import { fetchPresets, presetPrice, type Preset } from '../../../lib/presets';
import { fetchPopularIds, templateChips, templatesFor, templatePageHref } from '../../../lib/templateFilters';
import { colors, ds, LIST_END_PADDING } from '../../../theme';
import { Button, Card, Text, TextField, Chip, themedStyles, useThemedStyles, useAppearance } from '../../../components/ui';

import { StartOption } from '../../../components/home/StartOption';
import { EntryRow } from '../../../components/home/EntryRow';
import { PresetCard } from '../../../components/home/PresetCard';
import { OddlingsBanner } from '../../../components/home/OddlingsBanner';
import { VeyLoader } from '../../../components/VeyLoader';

// How many templates the home shows; the rest are on the Templates screen.
const SHOWN = 24;
// The type chips are always all four, so an empty type can say it is coming soon instead of vanishing.
const TYPES: readonly TypeFilter[] = [ALL_TYPES, 'image', 'video', 'audio'];
const RECENT = 6;


// Explore is the home: say what to make, or start from a template, or pick up what you were making.
export default function Explore() {
    const styles = useThemedStyles(sheets);
    const { scheme } = useAppearance();
    const { api } = useAuth();
    const router = useRouter();
    const { focusIdea } = useLocalSearchParams<{ focusIdea?: string }>();
    const ideaField = useRef<ComponentRef<typeof TextInput>>(null);
    const page = useRef<ComponentRef<typeof ScrollView>>(null);
    const ideaY = useRef(0);
    useFocusEffect(useCallback(() => {
        if (focusIdea !== '1') return;
        const timer = setTimeout(() => {
            page.current?.scrollTo({ y: ideaY.current, animated: true });
            ideaField.current?.focus();
            router.setParams({ focusIdea: undefined });
        }, 350);
        return () => clearTimeout(timer);
    }, [focusIdea, router]));
    const [prompt, setPrompt] = useState('');
    const [catalog, setCatalog] = useState<CatalogModel[]>([]);
    const [note, setNote] = useState<string | null>(null);
    const [presets, setPresets] = useState<Preset[] | null>(null);
    const [popularIds, setPopularIds] = useState<string[]>([]);
    const [presetsFailed, setPresetsFailed] = useState(false);
    const [type, setType] = useState<TypeFilter>(ALL_TYPES);
    const balance = useBalance();
    const [category, setCategory] = useState(ALL_CATEGORIES);
    const [query, setQuery] = useState('');
    // The search box and the category row are tucked away until asked for, so the templates are what you see.
    const [searchOpen, setSearchOpen] = useState(false);
    const [categoriesOpen, setCategoriesOpen] = useState(false);
    const [jobs, setJobs] = useState<Job[]>([]);

    useEffect(() => {
        void fetchCatalogCached((models) => setCatalog(models)).catch(() => {});
    }, []);

    const loadPresets = useCallback(() => {
        setPresetsFailed(false);
        fetchPresets()
            .then(setPresets)
            .catch(() => setPresetsFailed(true));
    }, []);
    useEffect(loadPresets, [loadPresets]);
    useEffect(() => {
        let live = true;
        void fetchPopularIds().then(ids => { if (live) setPopularIds(ids); });
        return () => { live = false; };
    }, []);

    // The vibe check answers on this phone steer the order of templates. A choice the server has not seen yet is sent now.
    const [vibe, setVibe] = useState<CreatorAnswers | null>(null);
    useEffect(() => {
        let alive = true;
        void loadVibe().then(async (stored) => {
            if (!alive || !stored) return;
            setVibe(stored.answers);
            if (CREATOR_PROFILE_ENABLED && !stored.synced) {
                const next = await syncVibe(api, stored);
                if (next.synced) await storeVibe(next);
            }
        });
        return () => {
            alive = false;
        };
    }, [api]);

    // On every return, so a creation started elsewhere shows at once.
    useFocusEffect(
        useCallback(() => {
            const controller = new AbortController();
            const media = mediaApi(api);
            media
                .listJobs()
                .then((page) => {
                    // A creation that finished while you were elsewhere gets its cheer and buzz now.
                    if (controller.signal.aborted) return;
                    celebrateFinished(page.jobs, (id) => media.getAsset(id), controller.signal);
                    setJobs(page.jobs);
                })
                .catch(() => {});
            return () => controller.abort();
        }, [api]),
    );

    const typedPresets = useMemo(() => filterPresets(presets ?? [], { type, category: ALL_CATEGORIES, query: '' }), [presets, type]);
    const categories = useMemo(() => templateChips(typedPresets, popularIds), [typedPresets, popularIds]);
    const shown = useMemo(() => rankPresets(filterPresets(templatesFor(typedPresets, category, popularIds), { type, category: ALL_CATEGORIES, query }), vibe).slice(0, SHOWN), [typedPresets, type, category, popularIds, query, vibe]);
    const modelCount = useMemo(() => new Set((presets ?? []).map((preset) => preset.modelId)).size, [presets]);

    function pickType(next: TypeFilter) {
        setType(next);
        // A category belongs to a type, so a new type starts at All.
        setCategory(ALL_CATEGORIES);
    }
    const resume = useMemo(() => pickUp(jobs), [jobs]);
    const recent = useMemo(() => recentCreations(jobs, RECENT), [jobs]);

    function make(kind: Kind) {
        const model = firstModelFor(catalog, kind);
        if (!model) return setNote(t('explore.noModel'));
        setNote(null);
        router.push(promptHref(model.id, prompt));
    }

    function openPreset(p: Preset) {
        router.push(templatePageHref(p));
    }

    const empty = prompt.trim().length === 0;
    const label = (j: Job) => j.label || t('edit.untitled');

    const searchShown = searchOpen || query.length > 0;

    return (
        <>
            <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
            <ScrollView ref={page} automaticallyAdjustKeyboardInsets style={styles.scroll} contentContainerStyle={styles.screen} keyboardShouldPersistTaps="handled">
                <View style={styles.intro}>
                    <Text variant="title1" style={styles.pageTitle} accessibilityRole="header">
                        {t('explore.start.title')}
                    </Text>
                    <Text variant="body" style={styles.pageIntro}>
                        {t('explore.start.body')}
                    </Text>
                </View>

                <Card style={styles.startGroup} accessibilityLabel={t('explore.start.title')}>
                    <StartOption href="/create" style={styles.startOption} icon="sparkle" title={t('menu.create')} body={t('explore.start.create.body')} hint={t('explore.start.create.hint')} />
                    <StartOption href="/chat" style={styles.startOption} icon="chat" title={t('menu.chat')} body={t('explore.start.chat.body')} hint={t('explore.chat.hint')} divided />
                    <StartOption href="/film" style={styles.startOption} icon="slate" title={t('menu.film')} body={t('explore.start.film.body')} hint={t('explore.start.film.hint')} divided />
                </Card>

                <Card style={styles.composer} onLayout={event => { ideaY.current = event.nativeEvent.layout.y; }}>
                    <Text variant="title3" style={styles.composerTitle}>
                        {t('explore.ideaTitle')}
                    </Text>
                    <TextField
                        ref={ideaField}
                        accessibilityLabel={t('explore.ideaTitle')}
                        placeholder={t('explore.promptPlaceholder')}
                        placeholderTextColor={colors.muted}
                        style={styles.prompt}
                        multiline
                        value={prompt}
                        onChangeText={setPrompt}
                    />
                    <View style={styles.actions}>
                        <Button variant="secondary" size="md" label={t('explore.makeVideo')} disabled={empty} onPress={() => make('video')} />
                        <Button size="md" label={t('explore.makeImage')} disabled={empty} onPress={() => make('image')} />
                    </View>
                </Card>

                <OddlingsBanner
                    href="/oddlings"
                    accessibilityLabel={t('explore.oddlings.title')}
                    accessibilityHint={t('explore.oddlings.hint')}
                    imageUrl="https://veyrnox.ai/oddlings/oddling-body-chaos.webp"
                    title={t('explore.heroTitle')}
                    body={t('explore.heroBody')}
                    action={t('explore.heroAction')}
                />
                <CheckInEntry unclaimedOnly />
                {balance !== null && isLowBalance(balance, cheapestCredits(presets?.filter((p) => p.available))) ? <LowBalanceNote balance={balance} /> : null}
                {note ? (
                    <Text style={styles.note} accessibilityLiveRegion="polite">
                        {note}
                    </Text>
                ) : null}

                <View style={styles.headerRow}>
                    <View style={styles.templateHeading}>
                        <Text variant="title2" style={styles.heading} accessibilityRole="header">
                            {t('explore.templates')}
                        </Text>
                        {presets ? (
                            <Text variant="footnote" style={styles.count}>
                                {t('explore.templateCount', {
                                    templates: presets.length,
                                    models: modelCount,
                                })}
                            </Text>
                        ) : null}
                    </View>
                    <View style={styles.headerLinks}>
                        <Button
                            variant="tertiary"
                            size="md"
                            label={t('explore.searchOpen')}
                            accessibilityState={{ expanded: searchShown }}
                            onPress={() => setSearchOpen((open) => !open)}
                        />
                        <Link href="/create/presets" asChild>
                            <Button variant="tertiary" size="md" label={t('explore.seeAllShort')} accessibilityLabel={t('explore.seeAll')} />
                        </Link>
                    </View>
                </View>
                {presetsFailed ? (
                    <Button variant="tertiary" label={t('explore.templatesError')} onPress={loadPresets} />
                ) : presets === null ? (
                    <VeyLoader />
                ) : (
                    <>
                        {searchShown ? (
                            <TextField
                                label={t('explore.search')}
                                accessibilityLabel={t('explore.search')}
                                placeholder={t('explore.search')}
                                placeholderTextColor={colors.muted}
                                style={styles.search}
                                value={query}
                                onChangeText={setQuery}
                                returnKeyType="search"
                                autoCorrect={false}
                                autoFocus={searchOpen && query.length === 0}
                                clearButtonMode="while-editing"
                            />
                        ) : null}
                        <ScrollView keyboardShouldPersistTaps="handled" horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
                            {TYPES.map((k) => (
                                <Chip key={k} label={t(`explore.type.${k}`)} selected={k === type} onPress={() => pickType(k)} />
                            ))}
                            {categories.length > 1 ? (
                                <Button
                                    size="md"
                                    variant="tertiary"
                                    label={category !== ALL_CATEGORIES ? categoryLabel(category) : t('explore.categories')}
                                    accessibilityState={{
                                        expanded: categoriesOpen,
                                        selected: category !== ALL_CATEGORIES,
                                    }}
                                    onPress={() => setCategoriesOpen((open) => !open)}
                                />
                            ) : null}
                        </ScrollView>
                        {categories.length > 1 && categoriesOpen ? (
                            <ScrollView keyboardShouldPersistTaps="handled" horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
                                {categories.map((c) => (
                                    <Chip key={c} label={c === ALL_CATEGORIES ? t('explore.categoryAll') : categoryLabel(c)} selected={c === category} onPress={() => setCategory(c)} />
                                ))}
                            </ScrollView>
                        ) : null}
                        {shown.length === 0 ? (
                            <Text style={styles.empty} accessibilityLiveRegion="polite">
                                {type === 'audio' && !query.trim() ? t('explore.audioSoon') : t('explore.noMatch')}
                            </Text>
                        ) : (
                            <View style={styles.grid}>
                                {shown.map((preset) => (
                                    <PresetCard key={preset.id} preset={preset} price={presetPrice(preset)} onOpen={openPreset} />
                                ))}
                            </View>
                        )}
                    </>
                )}

                {resume || recent.length > 0 ? (
                    <>
                        <Text variant="title3" style={styles.subheading} accessibilityRole="header">
                            {t('explore.recent')}
                        </Text>
                        <ScrollView keyboardShouldPersistTaps="handled" horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
                            {resume ? (
                                <Button
                                    variant="secondary"
                                    size="md"
                                    label={t(resume.kind === 'making' ? 'explore.pickUp.making' : 'explore.pickUp.latest', { label: label(resume.job) })}
                                    onPress={() =>
                                        router.push({
                                            pathname: '/job/[id]',
                                            params: { id: resume.job.job_id },
                                        })
                                    }
                                />
                            ) : null}
                            {recent.map((j) => (
                                <Button
                                    key={j.job_id}
                                    variant="secondary"
                                    size="md"
                                    label={label(j)}
                                    onPress={() =>
                                        router.push({
                                            pathname: '/job/[id]',
                                            params: { id: j.job_id },
                                        })
                                    }
                                />
                            ))}
                        </ScrollView>
                    </>
                ) : null}

                <Text variant="title3" style={styles.subheading} accessibilityRole="header">
                    {t('explore.more')}
                </Text>
                <EntryRow href="/edit" title={t('edit.title')} />
                <EntryRow href="/projects" title={t('label.Projects')} />
            </ScrollView>
        </>
    );
}

const sheets = themedStyles((p, ramp) => ({
    scroll: { flex: 1, backgroundColor: p.bg },
    screen: {
        padding: ds.space.gutter,
        paddingTop: ds.space.xxl,
        paddingBottom: LIST_END_PADDING,
        gap: 16,
    },
    intro: { gap: 8, marginBottom: 4 },
    pageTitle: { color: p.textPrimary },
    pageIntro: { color: p.textSecondary, maxWidth: 520 },
    startGroup: { overflow: 'hidden', padding: 0 },
    startOption: { minHeight: 80 },
    composer: { gap: ds.space.md },
    composerTitle: { color: p.textPrimary },
    prompt: {
        ...ramp.body,
        minHeight: 62,
        textAlignVertical: 'top',
        color: p.textPrimary,
        paddingHorizontal: 0,
        paddingTop: 2,
    },
    actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10 },
    note: { color: p.textSecondary },
    headerRow: {
        flexDirection: 'row',
        alignItems: 'flex-end',
        justifyContent: 'space-between',
        marginTop: 12,
    },
    templateHeading: { flex: 1, gap: 4 },
    headerLinks: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    heading: { color: p.textPrimary },
    count: { color: p.textTertiary },
    subheading: { color: p.textTertiary, marginTop: 8 },
    chips: { flexDirection: 'row', gap: 6, paddingVertical: 2 },
    // Only the chosen chip is a pill; the rest are plain words, so one thing in the row is lit.
    search: {
        ...ramp.body,
        minHeight: 44,
        color: p.textPrimary,
        backgroundColor: p.bgElevated1,
        borderColor: p.borderStrong,
        borderWidth: 1,
        borderRadius: 12,
        paddingHorizontal: 14,
    },
    empty: { color: p.textTertiary, paddingVertical: 12 },
    grid: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        justifyContent: 'space-between',
        rowGap: 12,
    },
}));
