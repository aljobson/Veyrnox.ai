import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, AppState, FlatList, ScrollView, View } from 'react-native';
import { Button, Chip, Text, TextField, themedStyles, useThemedStyles } from '../../../components/ui';
import { TemplateCollage } from '../../../components/TemplateCollage';
import { TemplateCard } from '../../../components/templates/TemplateCard';
import { AudioTemplateCard } from '../../../components/templates/AudioTemplateCard';
import { ImageTemplateCard } from '../../../components/templates/ImageTemplateCard';
import { fetchImageTemplates, imageCategoriesOf, imageTemplatesIn, type ImageTemplate } from '../../../lib/imageTemplates';
import { audioCategoriesOf, audioTemplatesIn, fetchAudioTemplates, type AudioTemplate } from '../../../lib/audioTemplates';
import { promptHref } from '../../../lib/explore';
import { priceLines } from '../../../lib/catalogPages';
import { fetchCatalogCached, type CatalogModel } from '../../../lib/media';
import { t } from '../../../lib/i18n';
import { fetchPresets, searchPresets, themeTitle, type Preset } from '../../../lib/presets';
import { fetchPopularIds, templateChips, templatesFor, previewRatio, templatePageHref } from '../../../lib/templateFilters';
import { rankPresets } from '../../../lib/creatorTaste';
import { useVibeAnswers } from '../../../lib/useVibeAnswers';

type TemplateKind = 'video' | 'image' | 'audio';
const KINDS: readonly TemplateKind[] = ['video', 'image', 'audio'];

export default function Templates() {
    const styles = useThemedStyles(sheets);
    const router = useRouter();
    const params = useLocalSearchParams<{ unavailable?: string | string[]; kind?: string | string[] }>();
    const [presets, setPresets] = useState<Preset[] | null>(null);
    const [popular, setPopular] = useState<string[]>([]);
    const [failed, setFailed] = useState(false);
    const [query, setQuery] = useState('');
    const [chip, setChip] = useState('ALL');
    const [limit, setLimit] = useState(50);
    const [playing, setPlaying] = useState<string | null>(null);
    const [attempt, setAttempt] = useState(0);
    // Video, image and audio templates are separate lists behind a switch, never mixed in one grid.
    const [kind, setKind] = useState<TemplateKind>(KINDS.includes(params.kind as TemplateKind) ? params.kind as TemplateKind : 'video');
    const [images, setImages] = useState<ImageTemplate[] | null>(null);
    const [imagesFailed, setImagesFailed] = useState(false);
    const [imageChip, setImageChip] = useState('ALL');
    const [audio, setAudio] = useState<AudioTemplate[] | null>(null);
    const [audioFailed, setAudioFailed] = useState(false);
    const [audioChip, setAudioChip] = useState('ALL');
    const [catalog, setCatalog] = useState<CatalogModel[] | null>(null);
    const vibe = useVibeAnswers(attempt);
    useEffect(() => {
        let live = true; setFailed(false);
        fetchPresets().then(value => { if (live) setPresets(value); }).catch(() => { if (live) setFailed(true); });
        fetchPopularIds().then(value => { if (live) setPopular(value); });
        return () => { live = false; };
    }, [attempt]);
    useEffect(() => {
        if (kind !== 'audio') return;
        let live = true; setAudioFailed(false);
        fetchAudioTemplates().then(value => { if (live) setAudio(value); }).catch(() => { if (live) setAudioFailed(true); });
        // Audio templates carry no price; the card shows the catalog price of the template's model when it is listed.
        fetchCatalogCached(list => { if (live) setCatalog(list); }).catch(() => { /* Cards stay without a price. */ });
        return () => { live = false; };
    }, [kind, attempt]);
    useEffect(() => {
        if (kind !== 'image') return;
        let live = true; setImagesFailed(false);
        fetchImageTemplates().then(value => { if (live) setImages(value); }).catch(() => { if (live) setImagesFailed(true); });
        return () => { live = false; };
    }, [kind, attempt]);
    useFocusEffect(useCallback(() => () => setPlaying(null), []));
    useEffect(() => { const sub = AppState.addEventListener('change', state => { if (state !== 'active') setPlaying(null); }); return () => sub.remove(); }, []);
    useEffect(() => { setLimit(50); setPlaying(null); }, [chip, query]);
    const chips = useMemo(() => templateChips(presets ?? [], popular), [presets, popular]);
    const shown = useMemo(() => searchPresets(templatesFor(rankPresets(presets ?? [], vibe), chip, popular), query), [presets, vibe, chip, popular, query]);
    const unavailableId = Array.isArray(params.unavailable) ? params.unavailable[0] : params.unavailable;
    const unavailablePreset = presets?.find(p => p.id === unavailableId);
    const audioShown = useMemo(() => {
        const words = query.trim().toLowerCase();
        return audioTemplatesIn(audio ?? [], audioChip).filter(a => !words || a.name.toLowerCase().includes(words) || a.prompt.toLowerCase().includes(words));
    }, [audio, audioChip, query]);
    const imagesShown = useMemo(() => imageTemplatesIn(images ?? [], imageChip, query), [images, imageChip, query]);
    const audioCredits = useMemo(() => new Map((catalog ?? []).map(m => [m.id, priceLines(m)[0]?.credits])), [catalog]);
    const openAudio = (a: AudioTemplate) => router.push(promptHref(a.modelId, a.prompt));
    const openImage = (i: ImageTemplate) => router.push(promptHref(i.modelId, i.prompt));
    const retry = <View><Text tone="danger">{t('presets.couldnotloadtemplatesCheckyourconnection')}</Text><Button label={t('recovery.retry')} onPress={() => setAttempt(n => n + 1)} /></View>;
    const empty = <Text tone="secondary">{t(query ? 'presets.nomatchingeffects' : 'presets.notemplatesavailablerightnow')}</Text>;
    const open = (p: Preset) => { setPlaying(null); router.push(templatePageHref(p)); };
    return <View style={styles.screen}>
        <Stack.Screen options={{ title: t('presets.templates') }} />
        <Text variant="title1" accessibilityRole="header">{t('presets.templates')}</Text>
        {unavailableId ? <Text accessibilityLiveRegion="assertive">{unavailablePreset ? t('presets.isnotavailablerightnow', { value1: unavailablePreset.title }) : t('presets.thattemplateisnotavailablerightnow')}</Text> : null}
        <View style={styles.kinds} accessibilityRole="tablist" accessibilityLabel={t('templates.kind.label')}>
            {KINDS.map(k => <Chip key={k} selected={kind === k} accessibilityRole="tab" accessibilityState={{ selected: kind === k }} label={t(`templates.kind.${k}`)} onPress={() => { setKind(k); setQuery(''); }} />)}
        </View>
        {kind === 'image' ? (imagesFailed ? retry
            : images === null ? <ActivityIndicator /> : <FlatList key="image" data={imagesShown} numColumns={2} keyExtractor={i => i.id} contentContainerStyle={styles.list}
                ListHeaderComponent={<View style={styles.header}>
                    <TextField accessibilityLabel={t('libraryCreate.searchTemplates')} placeholder={t('libraryCreate.searchTemplates')} value={query} onChangeText={setQuery} />
                    <ScrollView horizontal contentContainerStyle={styles.chips}>{['ALL', ...imageCategoriesOf(images)].map(c => <Chip key={c} selected={imageChip === c} accessibilityState={{ selected: imageChip === c }} label={c === 'ALL' ? t('explore.type.all') : themeTitle(c)} onPress={() => setImageChip(c)} />)}</ScrollView>
                </View>}
                ListEmptyComponent={empty}
                renderItem={({ item }) => <ImageTemplateCard template={item} onOpen={() => openImage(item)} />} />)
        : kind === 'audio' ? (audioFailed ? <View><Text tone="danger">{t('presets.couldnotloadtemplatesCheckyourconnection')}</Text><Button label={t('recovery.retry')} onPress={() => setAttempt(n => n + 1)} /></View>
            : audio === null ? <ActivityIndicator /> : <FlatList key="audio" data={audioShown} keyExtractor={a => a.id} contentContainerStyle={styles.list}
                ListHeaderComponent={<View style={styles.header}>
                    <TextField accessibilityLabel={t('libraryCreate.searchTemplates')} placeholder={t('libraryCreate.searchTemplates')} value={query} onChangeText={setQuery} />
                    <ScrollView horizontal contentContainerStyle={styles.chips}>{['ALL', ...audioCategoriesOf(audio)].map(c => <Chip key={c} selected={audioChip === c} accessibilityState={{ selected: audioChip === c }} label={c === 'ALL' ? t('audioTemplates.all') : t(`audioTemplates.cat.${c}`)} onPress={() => setAudioChip(c)} />)}</ScrollView>
                </View>}
                ListEmptyComponent={<Text tone="secondary">{t(query ? 'presets.nomatchingeffects' : 'presets.notemplatesavailablerightnow')}</Text>}
                renderItem={({ item }) => <AudioTemplateCard template={item} credits={audioCredits.get(item.modelId)} onOpen={() => openAudio(item)} />} />)
        : failed ? <View><Text tone="danger">{t('presets.couldnotloadtemplatesCheckyourconnection')}</Text><Button label={t('recovery.retry')} onPress={() => setAttempt(n => n + 1)} /></View>
            : presets === null ? <ActivityIndicator /> : <FlatList key="video" data={shown.slice(0, limit)} numColumns={2} keyExtractor={p => p.id} contentContainerStyle={styles.list}
                ListHeaderComponent={<View style={styles.header}>
                    <Text>{t('explore.templateCount', { templates: String(shown.length), models: String(new Set(shown.map(p => p.modelId)).size) })}</Text>
                    <TextField accessibilityLabel={t('libraryCreate.searchTemplates')} placeholder={t('libraryCreate.searchTemplates')} value={query} onChangeText={setQuery} />
                    <ScrollView horizontal contentContainerStyle={styles.chips}>{chips.map(c => <Chip key={c} selected={chip === c} accessibilityState={{ selected: chip === c }} label={c === 'ALL' ? t('explore.type.all') : c === 'NEW' ? t('explore.new') : c === 'POPULAR' ? t('libraryCreate.popular') : themeTitle(c)} onPress={() => setChip(c)} />)}</ScrollView>
                    {chip === 'ALL' && !query.trim() ? <TemplateCollage presets={shown.filter(p => p.posterUrl).slice(0, 24)} isTall={p => previewRatio(p) < 1} onOpen={open} /> : null}
                </View>}
                ListEmptyComponent={<Text tone="secondary">{t(query ? 'presets.nomatchingeffects' : 'presets.notemplatesavailablerightnow')}</Text>}
                ListFooterComponent={shown.length > limit ? <Button label={t('libraryCreate.showMore')} onPress={() => setLimit(n => n + 50)} /> : undefined}
                renderItem={({ item }) => <TemplateCard preset={item} playing={playing === item.id} onPlay={() => setPlaying(id => id === item.id ? null : item.id)} onOpen={() => open(item)} />} />}
    </View>;
}
const sheets = themedStyles(p => ({ screen: { flex: 1, backgroundColor: p.bg, padding: 16 }, kinds: { flexDirection: 'row', gap: 8, marginBottom: 12 }, list: { paddingBottom: 80 }, header: { gap: 12 }, chips: { gap: 8 } }));
