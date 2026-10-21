import { Image } from 'expo-image';
import { Link, useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useAuth } from '../../../auth/AuthProvider';
import { VEY_CLEARANCE } from '../../../components/VeyMascot';
import { selectedState, touchTarget } from '../../../lib/a11y';
import { ALL_CATEGORIES, ALL_TYPES, categoriesFor, filterPresets, firstModelFor, pickUp, presetKind, promptHref, recentCreations, type TypeFilter } from '../../../lib/explore';
import { t } from '../../../lib/i18n';
import { fetchCatalogCached, mediaApi, type CatalogModel, type Job, type Kind } from '../../../lib/media';
import { LowBalanceNote } from '../../../components/LowBalanceNote';
import { TemplateCollage } from '../../../components/TemplateCollage';
import { cheapestCredits, isLowBalance } from '../../../lib/lowBalance';
import { useBalance } from '../../../lib/useBalance';
import { fetchPresets, presetHref, presetPrice, type Preset } from '../../../lib/presets';
import { colors } from '../../../theme';
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
    const [jobs, setJobs] = useState<Job[]>([]);

    useEffect(() => {
        void fetchCatalogCached((models) => setCatalog(models)).catch(() => {});
    }, []);

    const loadPresets = useCallback(() => {
        setPresetsFailed(false);
        fetchPresets().then(setPresets).catch(() => setPresetsFailed(true));
    }, []);
    useEffect(loadPresets, [loadPresets]);

    // On every return, so a creation started elsewhere shows at once.
    useFocusEffect(
        useCallback(() => {
            mediaApi(api)
                .listJobs()
                .then((page) => setJobs(page.jobs))
                .catch(() => {});
        }, [api]),
    );

    const categories = useMemo(() => categoriesFor(presets ?? [], type), [presets, type]);
    const shown = useMemo(() => filterPresets(presets ?? [], { type, category, query }).slice(0, SHOWN), [presets, type, category, query]);

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

    return (
        <ScrollView style={styles.scroll} contentContainerStyle={styles.screen} keyboardShouldPersistTaps="handled" onScroll={onScroll} scrollEventThrottle={64}>
            <TextInput
                accessibilityLabel={t('explore.promptLabel')}
                placeholder={t('explore.promptPlaceholder')}
                placeholderTextColor={colors.muted}
                style={styles.prompt}
                multiline
                value={prompt}
                onChangeText={setPrompt}
            />
            <View style={styles.row}>
                <Pressable accessibilityRole="button" accessibilityState={{ disabled: empty }} disabled={empty} style={[styles.make, empty && styles.off]} onPress={() => make('image')}>
                    <Text style={styles.makeText}>{t('explore.makeImage')}</Text>
                </Pressable>
                <Pressable accessibilityRole="button" accessibilityState={{ disabled: empty }} disabled={empty} style={[styles.make, empty && styles.off]} onPress={() => make('video')}>
                    <Text style={styles.makeText}>{t('explore.makeVideo')}</Text>
                </Pressable>
            </View>
            {balance !== null && isLowBalance(balance, cheapestCredits(presets)) ? <LowBalanceNote balance={balance} /> : null}
            {note ? <Text style={styles.note} accessibilityLiveRegion="polite">{note}</Text> : null}

            <View style={styles.headerRow}>
                <Text style={styles.heading} accessibilityRole="header">{t('explore.templates')}</Text>
                <Link href="/create/presets" asChild>
                    <Pressable accessibilityRole="button" style={touchTarget}>
                        <Text style={styles.link}>{t('explore.seeAll')}</Text>
                    </Pressable>
                </Link>
            </View>
            {presetsFailed ? (
                <Pressable accessibilityRole="button" style={touchTarget} onPress={loadPresets}>
                    <Text style={styles.error}>{t('explore.templatesError')}</Text>
                </Pressable>
            ) : presets === null ? (
                <ActivityIndicator color={colors.accent} />
            ) : (
                <>
                    <TextInput
                        accessibilityLabel={t('explore.search')}
                        placeholder={t('explore.search')}
                        placeholderTextColor={colors.muted}
                        style={styles.search}
                        value={query}
                        onChangeText={setQuery}
                        returnKeyType="search"
                        autoCorrect={false}
                        clearButtonMode="while-editing"
                    />
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
                        {TYPES.map((k) => (
                            <Pressable key={k} accessibilityRole="button" accessibilityState={selectedState(k === type)} style={[styles.chip, k === type && styles.chipOn, touchTarget]} onPress={() => pickType(k)}>
                                <Text style={[styles.chipText, k === type && styles.chipTextOn]}>{t(`explore.type.${k}`)}</Text>
                            </Pressable>
                        ))}
                    </ScrollView>
                    {categories.length > 1 ? (
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
                        <TemplateCollage presets={shown} isTall={(p) => presetKind(p) === 'video'} onOpen={(p) => router.push(presetHref(p))} />
                    )}
                </>
            )}

            <Link href="/oddlings" asChild>
                <Pressable accessibilityRole="button" accessibilityLabel={t('explore.oddlings.title')} accessibilityHint={t('explore.oddlings.hint')} style={styles.banner}>
                    <Text style={styles.bannerTitle}>{t('explore.oddlings.title')}</Text>
                    <Text style={styles.bannerText}>{t('explore.oddlings.body')}</Text>
                </Pressable>
            </Link>

            {resume || recent.length > 0 ? (
                <>
                    <Text style={styles.heading} accessibilityRole="header">{t('explore.recent')}</Text>
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

            <Text style={styles.heading} accessibilityRole="header">{t('explore.more')}</Text>
            <Link href="/edit" asChild>
                <Pressable accessibilityRole="button" style={styles.secondary}>
                    <Text style={styles.secondaryText}>{t('edit.title')}</Text>
                </Pressable>
            </Link>
            <Link href="/projects" asChild>
                <Pressable accessibilityRole="button" style={styles.secondary}>
                    <Text style={styles.secondaryText}>{t('label.Projects')}</Text>
                </Pressable>
            </Link>
        </ScrollView>
    );
}

const styles = StyleSheet.create({
    scroll: { flex: 1, backgroundColor: colors.background },
    screen: { padding: 16, paddingBottom: VEY_CLEARANCE, gap: 12 },
    prompt: { minHeight: 96, textAlignVertical: 'top', color: colors.text, fontSize: 16, backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 12, padding: 14 },
    row: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
    make: { flexGrow: 1, minHeight: 44, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.accent, borderRadius: 12, paddingVertical: 12, paddingHorizontal: 16 },
    makeText: { color: colors.accentInk, fontWeight: '700', fontSize: 16 },
    off: { opacity: 0.4 },
    banner: { backgroundColor: colors.surface, borderColor: colors.accent, borderWidth: 1, borderRadius: 12, padding: 14, gap: 4, minHeight: 44, justifyContent: 'center' },
    bannerTitle: { color: colors.accent, fontSize: 17, fontWeight: '700' },
    bannerText: { color: colors.body, fontSize: 15 },
    note: { color: colors.body },
    recentResume: { borderColor: colors.accent, maxWidth: 280 },
    resumeText: { color: colors.text, fontWeight: '600' },
    headerRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 },
    heading: { color: colors.text, fontSize: 18, fontWeight: '700', marginTop: 8 },
    link: { color: colors.accent, fontSize: 15 },
    error: { color: colors.danger },
    chips: { flexDirection: 'row', gap: 8, paddingVertical: 2 },
    chip: { paddingHorizontal: 14, borderRadius: 10, backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, justifyContent: 'center' },
    chipOn: { backgroundColor: colors.accent, borderColor: colors.accent },
    chipText: { color: colors.body },
    chipTextOn: { color: colors.accentInk, fontWeight: '600' },
    search: { minHeight: 44, color: colors.text, fontSize: 16, backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 12, paddingHorizontal: 14 },
    empty: { color: colors.muted, paddingVertical: 12 },
    recent: { paddingHorizontal: 14, borderRadius: 10, backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, justifyContent: 'center', maxWidth: 220 },
    recentText: { color: colors.text },
    secondary: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 12, paddingVertical: 16, alignItems: 'center' },
    secondaryText: { color: colors.text, fontSize: 16, fontWeight: '600' },
});
