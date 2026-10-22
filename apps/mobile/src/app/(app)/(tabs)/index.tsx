import { Image } from 'expo-image';
import { Link, useFocusEffect, useRouter, type Href } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useAuth } from '../../../auth/AuthProvider';
import { VEY_CLEARANCE } from '../../../components/VeyMascot';
import { selectedState, touchTarget } from '../../../lib/a11y';
import { celebrateFinished } from '../../../lib/celebrate';
import { ALL_CATEGORIES, ALL_TYPES, categoriesFor, filterPresets, firstModelFor, pickUp, promptHref, recentCreations, type TypeFilter } from '../../../lib/explore';
import { t } from '../../../lib/i18n';
import { fetchCatalogCached, mediaApi, type CatalogModel, type Job, type Kind } from '../../../lib/media';
import { LowBalanceNote } from '../../../components/LowBalanceNote';
import { CREATOR_PROFILE_ENABLED, syncVibe } from '../../../lib/creatorProfile';
import { loadVibe, storeVibe } from '../../../lib/creatorProfileStore';
import type { CreatorAnswers } from '../../../lib/creatorAnswers';
import { rankPresets } from '../../../lib/creatorTaste';
import { cheapestCredits, isLowBalance } from '../../../lib/lowBalance';
import { useBalance } from '../../../lib/useBalance';
import { fetchPresets, presetHref, presetPrice, type Preset } from '../../../lib/presets';
import { fonts, studioColors as colors } from '../../../theme';
import { useVeyScroll } from '../../../lib/useVeyScroll';

// How many templates the home shows; the rest are on the Templates screen.
const SHOWN = 24;
// The type chips are always all four, so an empty type can say it is coming soon instead of vanishing.
const TYPES: readonly TypeFilter[] = [ALL_TYPES, 'image', 'video', 'audio'];
const RECENT = 6;

const titleCase = (s: string) => s.charAt(0) + s.slice(1).toLowerCase();

// Explore is the home: say what to make, or start from a template, or pick up what you were making.
export default function Explore() {
    const onScroll = useVeyScroll();
    const { api } = useAuth();
    const router = useRouter();
    const [prompt, setPrompt] = useState('');
    const [catalog, setCatalog] = useState<CatalogModel[]>([]);
    const [note, setNote] = useState<string | null>(null);
    const [presets, setPresets] = useState<Preset[] | null>(null);
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
        fetchPresets().then(setPresets).catch(() => setPresetsFailed(true));
    }, []);
    useEffect(loadPresets, [loadPresets]);

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
            mediaApi(api)
                .listJobs()
                .then((page) => {
                    // A creation that finished while you were elsewhere gets its cheer and buzz now.
                    celebrateFinished(page.jobs);
                    setJobs(page.jobs);
                })
                .catch(() => {});
        }, [api]),
    );

    const categories = useMemo(() => categoriesFor(presets ?? [], type), [presets, type]);
    const shown = useMemo(() => rankPresets(filterPresets(presets ?? [], { type, category, query }), vibe).slice(0, SHOWN), [presets, type, category, query, vibe]);
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

    const empty = prompt.trim().length === 0;
    const label = (j: Job) => j.label || t('edit.untitled');

    const searchShown = searchOpen || query.length > 0;

    return (
        <>
            <StatusBar style="light" />
            <ScrollView style={styles.scroll} contentContainerStyle={styles.screen} keyboardShouldPersistTaps="handled" onScroll={onScroll} scrollEventThrottle={64}>
            <View style={styles.intro}>
                <Text style={styles.pageTitle} accessibilityRole="header">{t('explore.presetsTitle')}</Text>
                <Text style={styles.pageIntro}>{t('explore.presetsIntro')}</Text>
            </View>

            <Link href="/oddlings" asChild>
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={t('explore.oddlings.title')}
                    accessibilityHint={t('explore.oddlings.hint')}
                    style={({ pressed }) => [styles.heroCard, pressed && styles.pressed]}
                >
                    <View style={styles.heroMedia}>
                        <Image source={{ uri: 'https://veyrnox.ai/oddlings/oddling-body-chaos.webp' }} style={StyleSheet.absoluteFill} contentFit="cover" accessibilityIgnoresInvertColors />
                        <View style={styles.heroShade} />
                        <View style={styles.heroLabel}><Text style={styles.heroLabelText}>ORIGINAL FICTIONAL CAST</Text></View>
                    </View>
                    <View style={styles.heroCopy}>
                        <Text style={styles.kicker}>{t('explore.heroKicker')}</Text>
                        <Text style={styles.heroTitle}>{t('explore.heroTitle')}</Text>
                        <Text style={styles.heroBody}>{t('explore.heroBody')}</Text>
                        <Text style={styles.heroAction}>{t('explore.heroAction')}</Text>
                    </View>
                </Pressable>
            </Link>

            <View style={styles.composer}>
                <Text style={styles.composerTitle}>{t('explore.ideaTitle')}</Text>
                <TextInput
                    accessibilityLabel={t('explore.promptLabel')}
                    placeholder={t('explore.promptPlaceholder')}
                    placeholderTextColor={colors.muted}
                    style={styles.prompt}
                    multiline
                    value={prompt}
                    onChangeText={setPrompt}
                />
                <View style={styles.actions}>
                    <Pressable accessibilityRole="button" accessibilityState={{ disabled: empty }} disabled={empty} style={[styles.makeGhost, empty && styles.off]} onPress={() => make('video')}>
                        <Text style={styles.makeGhostText}>{t('explore.makeVideo')}</Text>
                    </Pressable>
                    <Pressable accessibilityRole="button" accessibilityState={{ disabled: empty }} disabled={empty} style={[styles.make, empty && styles.off]} onPress={() => make('image')}>
                        <Text style={styles.makeText}>{t('explore.makeImage')}</Text>
                    </Pressable>
                </View>
            </View>
            <FeatureRow href="/chat" title={t('explore.chat.title')} body={t('explore.chat.body')} action={t('explore.chatAction')} hint={t('explore.chat.hint')} />
            {balance !== null && isLowBalance(balance, cheapestCredits(presets?.filter((p) => p.available))) ? <LowBalanceNote balance={balance} /> : null}
            {note ? <Text style={styles.note} accessibilityLiveRegion="polite">{note}</Text> : null}

            <View style={styles.headerRow}>
                <View style={styles.templateHeading}>
                    <Text style={styles.heading} accessibilityRole="header">{t('explore.templates')}</Text>
                    {presets ? <Text style={styles.count}>{t('explore.templateCount', { templates: presets.length, models: modelCount })}</Text> : null}
                </View>
                <View style={styles.headerLinks}>
                    <Pressable accessibilityRole="button" accessibilityState={{ expanded: searchShown }} style={touchTarget} onPress={() => setSearchOpen((open) => !open)}>
                        <Text style={styles.link}>{t('explore.searchOpen')}</Text>
                    </Pressable>
                    <Link href="/create/presets" asChild>
                        <Pressable accessibilityRole="button" accessibilityLabel={t('explore.seeAll')} style={touchTarget}>
                            <Text style={styles.link}>{t('explore.seeAllShort')}</Text>
                        </Pressable>
                    </Link>
                </View>
            </View>
            {presetsFailed ? (
                <Pressable accessibilityRole="button" style={touchTarget} onPress={loadPresets}>
                    <Text style={styles.error}>{t('explore.templatesError')}</Text>
                </Pressable>
            ) : presets === null ? (
                <ActivityIndicator color={colors.accent} />
            ) : (
                <>
                    {searchShown ? (
                        <TextInput
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
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
                        {TYPES.map((k) => (
                            <Pressable key={k} accessibilityRole="button" accessibilityState={selectedState(k === type)} style={[styles.chip, k === type && styles.chipOn, touchTarget]} onPress={() => pickType(k)}>
                                <Text style={[styles.chipText, k === type && styles.chipTextOn]}>{t(`explore.type.${k}`)}</Text>
                            </Pressable>
                        ))}
                        {categories.length > 1 ? (
                            <Pressable
                                accessibilityRole="button"
                                accessibilityState={{ expanded: categoriesOpen, selected: category !== ALL_CATEGORIES }}
                                style={[styles.chip, styles.chipGhost, category !== ALL_CATEGORIES && styles.chipOn, touchTarget]}
                                onPress={() => setCategoriesOpen((open) => !open)}
                            >
                                <Text style={[styles.chipText, category !== ALL_CATEGORIES && styles.chipTextOn]}>{category !== ALL_CATEGORIES ? titleCase(category) : t('explore.categories')}</Text>
                            </Pressable>
                        ) : null}
                    </ScrollView>
                    {categories.length > 1 && categoriesOpen ? (
                        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
                            {categories.map((c) => (
                                <Pressable key={c} accessibilityRole="button" accessibilityState={selectedState(c === category)} style={[styles.chip, c === category && styles.chipOn, touchTarget]} onPress={() => setCategory(c)}>
                                    <Text style={[styles.chipText, c === category && styles.chipTextOn]}>{c === ALL_CATEGORIES ? t('explore.categoryAll') : titleCase(c)}</Text>
                                </Pressable>
                            ))}
                        </ScrollView>
                    ) : null}
                    {shown.length === 0 ? (
                        <Text style={styles.empty} accessibilityLiveRegion="polite">{type === 'audio' && !query.trim() ? t('explore.audioSoon') : t('explore.noMatch')}</Text>
                    ) : (
                        <View style={styles.grid}>
                            {shown.map((p) => <PresetCard key={p.id} preset={p} onOpen={() => router.push(presetHref(p))} />)}
                        </View>
                    )}
                </>
            )}

            {resume || recent.length > 0 ? (
                <>
                    <Text style={styles.subheading} accessibilityRole="header">{t('explore.recent')}</Text>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
                        {resume ? (
                            <Pressable
                                accessibilityRole="button"
                                style={[styles.recent, styles.recentResume, touchTarget]}
                                onPress={() => router.push({ pathname: '/job/[id]', params: { id: resume.job.job_id } })}
                            >
                                <Text style={styles.resumeText} numberOfLines={1}>{t(resume.kind === 'making' ? 'explore.pickUp.making' : 'explore.pickUp.latest', { label: label(resume.job) })}</Text>
                            </Pressable>
                        ) : null}
                        {recent.map((j) => (
                            <Pressable key={j.job_id} accessibilityRole="button" style={[styles.recent, touchTarget]} onPress={() => router.push({ pathname: '/job/[id]', params: { id: j.job_id } })}>
                                <Text style={styles.recentText} numberOfLines={1}>{label(j)}</Text>
                            </Pressable>
                        ))}
                    </ScrollView>
                </>
            ) : null}

            <Text style={styles.subheading} accessibilityRole="header">{t('explore.more')}</Text>
            <EntryRow href="/edit" title={t('edit.title')} />
            <EntryRow href="/projects" title={t('label.Projects')} />
            </ScrollView>
        </>
    );
}

function PresetCard({ preset, onOpen }: { preset: Preset; onOpen: () => void }) {
    const label = `${preset.title}, ${preset.modelName}, ${presetPrice(preset)}${preset.available ? '' : ', not available right now'}`;
    return (
        <Pressable accessibilityRole="button" accessibilityLabel={label} style={({ pressed }) => [styles.presetCard, pressed && styles.pressed]} onPress={onOpen}>
            <View style={styles.presetMedia}>
                {preset.posterUrl ? <Image source={{ uri: preset.posterUrl }} style={StyleSheet.absoluteFill} contentFit="cover" accessibilityIgnoresInvertColors /> : <View style={styles.posterEmpty} />}
                {preset.isNew ? <View style={styles.newBadge}><Text style={styles.newBadgeText}>{t('explore.new')}</Text></View> : null}
            </View>
            <View style={styles.presetCopy}>
                <Text style={styles.presetTitle} numberOfLines={2}>{preset.title}</Text>
                <Text style={styles.presetModel} numberOfLines={1}>{preset.modelName}</Text>
                <Text style={styles.presetPrice}>{presetPrice(preset)}</Text>
            </View>
        </Pressable>
    );
}

function FeatureRow({ href, title, body, action, hint }: { href: Href; title: string; body: string; action: string; hint: string }) {
    return (
        <Link href={href} asChild>
            <Pressable accessibilityRole="button" accessibilityLabel={title} accessibilityHint={hint} style={({ pressed }) => [styles.featureRow, pressed && styles.pressed]}>
                <View style={styles.featureText}>
                    <Text style={styles.featureTitle}>{title}</Text>
                    <Text style={styles.featureBody}>{body}</Text>
                </View>
                <Text style={styles.featureAction}>{action}</Text>
            </Pressable>
        </Link>
    );
}

// One calm row for a place you can go: a title, an optional line under it, and a chevron. Hairlines, no fill, so the
// page has one thing that is lit at a time.
function EntryRow({ href, title, body, hint }: { href: Href; title: string; body?: string; hint?: string }) {
    return (
        <Link href={href} asChild>
            <Pressable accessibilityRole="button" accessibilityLabel={title} accessibilityHint={hint} style={styles.entry}>
                <View style={styles.entryText}>
                    <Text style={styles.entryName}>{title}</Text>
                    {body ? <Text style={styles.entryBody}>{body}</Text> : null}
                </View>
                <Text style={styles.entryArrow} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">›</Text>
            </Pressable>
        </Link>
    );
}

const styles = StyleSheet.create({
    scroll: { flex: 1, backgroundColor: colors.background },
    screen: { padding: 16, paddingTop: 24, paddingBottom: VEY_CLEARANCE, gap: 16 },
    intro: { gap: 8, marginBottom: 4 },
    pageTitle: { color: colors.text, fontFamily: fonts.displayHeavy, fontSize: 40, lineHeight: 42, letterSpacing: -1.3 },
    pageIntro: { color: colors.body, fontSize: 16, lineHeight: 25, maxWidth: 520 },
    heroCard: { overflow: 'hidden', borderRadius: 18, backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1 },
    heroMedia: { height: 205, backgroundColor: colors.border },
    heroShade: { position: 'absolute', inset: 0, backgroundColor: 'rgba(0,0,0,0.20)' },
    heroLabel: { position: 'absolute', left: 14, bottom: 14, borderRadius: 999, borderWidth: 1, borderColor: 'rgba(255,255,255,0.24)', backgroundColor: 'rgba(0,0,0,0.48)', paddingHorizontal: 11, paddingVertical: 6 },
    heroLabelText: { color: '#fff', fontSize: 9, fontWeight: '800', letterSpacing: 1.2 },
    heroCopy: { padding: 20, gap: 10 },
    kicker: { color: colors.accent, fontSize: 10, fontWeight: '800', letterSpacing: 1.5 },
    heroTitle: { color: colors.text, fontFamily: fonts.displayHeavy, fontSize: 31, lineHeight: 33, letterSpacing: -0.8 },
    heroBody: { color: colors.body, fontSize: 15, lineHeight: 22 },
    heroAction: { color: colors.accent, fontSize: 15, fontWeight: '800', marginTop: 2 },
    pressed: { opacity: 0.86, transform: [{ scale: 0.992 }] },
    composer: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 16, padding: 14, gap: 10 },
    composerTitle: { color: colors.text, fontSize: 17, fontWeight: '700' },
    prompt: { minHeight: 62, textAlignVertical: 'top', color: colors.text, fontSize: 16, paddingHorizontal: 0, paddingTop: 2 },
    actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10 },
    make: { minHeight: 44, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.accent, borderRadius: 12, paddingHorizontal: 18 },
    makeText: { color: colors.accentInk, fontWeight: '700', fontSize: 16 },
    makeGhost: { minHeight: 44, justifyContent: 'center', alignItems: 'center', borderColor: colors.borderStrong, borderWidth: 1, borderRadius: 12, paddingHorizontal: 16 },
    makeGhostText: { color: colors.text, fontWeight: '600', fontSize: 16 },
    off: { opacity: 0.4 },
    featureRow: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 17, borderRadius: 16, backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1 },
    featureText: { flex: 1, gap: 4 },
    featureTitle: { color: colors.text, fontSize: 18, fontWeight: '700' },
    featureBody: { color: colors.body, fontSize: 14, lineHeight: 20 },
    featureAction: { color: colors.accent, fontSize: 14, fontWeight: '800' },
    entry: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 52, paddingVertical: 10, borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
    entryText: { flex: 1, gap: 2 },
    entryName: { color: colors.text, fontSize: 16, fontWeight: '600' },
    entryBody: { color: colors.muted, fontSize: 14 },
    entryArrow: { color: colors.muted, fontSize: 26 },
    note: { color: colors.body },
    recentResume: { borderColor: colors.accent, maxWidth: 280 },
    resumeText: { color: colors.text, fontWeight: '600' },
    headerRow: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', marginTop: 12 },
    templateHeading: { flex: 1, gap: 4 },
    headerLinks: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    heading: { color: colors.text, fontFamily: fonts.displayHeavy, fontSize: 30, letterSpacing: -0.8 },
    count: { color: colors.muted, fontSize: 13 },
    subheading: { color: colors.muted, fontSize: 15, fontWeight: '600', marginTop: 8 },
    link: { color: colors.body, fontSize: 15, fontWeight: '600' },
    error: { color: colors.danger },
    chips: { flexDirection: 'row', gap: 6, paddingVertical: 2 },
    // Only the chosen chip is a pill; the rest are plain words, so one thing in the row is lit.
    chip: { minHeight: 38, paddingHorizontal: 14, borderRadius: 999, borderColor: colors.border, borderWidth: 1, justifyContent: 'center', backgroundColor: colors.surface },
    chipGhost: { borderColor: colors.border },
    chipOn: { backgroundColor: colors.accent, borderColor: colors.accent },
    chipText: { color: colors.muted, fontSize: 15 },
    chipTextOn: { color: colors.accentInk, fontWeight: '700' },
    search: { minHeight: 44, color: colors.text, fontSize: 16, backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 12, paddingHorizontal: 14 },
    empty: { color: colors.muted, paddingVertical: 12 },
    grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 12 },
    presetCard: { width: '48.4%', overflow: 'hidden', borderRadius: 15, backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1 },
    presetMedia: { width: '100%', aspectRatio: 0.92, backgroundColor: colors.border },
    posterEmpty: { flex: 1, backgroundColor: colors.border },
    newBadge: { position: 'absolute', left: 8, top: 8, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 4, backgroundColor: colors.accent },
    newBadgeText: { color: colors.accentInk, fontSize: 9, fontWeight: '800', letterSpacing: 0.7 },
    presetCopy: { minHeight: 96, padding: 11, gap: 3 },
    presetTitle: { color: colors.text, fontSize: 15, lineHeight: 18, fontWeight: '700' },
    presetModel: { color: colors.muted, fontSize: 12 },
    presetPrice: { color: colors.money, fontSize: 12, fontWeight: '700', marginTop: 'auto' },
    recent: { paddingHorizontal: 14, borderRadius: 999, backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, justifyContent: 'center', maxWidth: 220 },
    recentText: { color: colors.text },
});
