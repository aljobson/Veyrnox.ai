import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, AppState, FlatList, ScrollView, View } from 'react-native';
import { Button, Chip, Text, TextField, themedStyles, useThemedStyles } from '../../../components/ui';
import { TemplateCollage } from '../../../components/TemplateCollage';
import { TemplateCard } from '../../../components/templates/TemplateCard';
import { t } from '../../../lib/i18n';
import { fetchPresets, searchPresets, themeTitle, type Preset } from '../../../lib/presets';
import { fetchPopularIds, templateChips, templatesFor, previewRatio, templatePageHref } from '../../../lib/templateFilters';
import { rankPresets } from '../../../lib/creatorTaste';
import { useVibeAnswers } from '../../../lib/useVibeAnswers';

export default function Templates() {
    const styles = useThemedStyles(sheets);
    const router = useRouter();
    const params = useLocalSearchParams<{ unavailable?: string | string[] }>();
    const [presets, setPresets] = useState<Preset[] | null>(null);
    const [popular, setPopular] = useState<string[]>([]);
    const [failed, setFailed] = useState(false);
    const [query, setQuery] = useState('');
    const [chip, setChip] = useState('ALL');
    const [limit, setLimit] = useState(50);
    const [playing, setPlaying] = useState<string | null>(null);
    const [attempt, setAttempt] = useState(0);
    const vibe = useVibeAnswers(attempt);
    useEffect(() => {
        let live = true; setFailed(false);
        fetchPresets().then(value => { if (live) setPresets(value); }).catch(() => { if (live) setFailed(true); });
        fetchPopularIds().then(value => { if (live) setPopular(value); });
        return () => { live = false; };
    }, [attempt]);
    useFocusEffect(useCallback(() => () => setPlaying(null), []));
    useEffect(() => { const sub = AppState.addEventListener('change', state => { if (state !== 'active') setPlaying(null); }); return () => sub.remove(); }, []);
    useEffect(() => { setLimit(50); setPlaying(null); }, [chip, query]);
    const chips = useMemo(() => templateChips(presets ?? [], popular), [presets, popular]);
    const shown = useMemo(() => searchPresets(templatesFor(rankPresets(presets ?? [], vibe), chip, popular), query), [presets, vibe, chip, popular, query]);
    const unavailableId = Array.isArray(params.unavailable) ? params.unavailable[0] : params.unavailable;
    const unavailablePreset = presets?.find(p => p.id === unavailableId);
    const open = (p: Preset) => { setPlaying(null); router.push(templatePageHref(p)); };
    return <View style={styles.screen}>
        <Stack.Screen options={{ title: t('presets.templates') }} />
        <Text variant="title1" accessibilityRole="header">{t('presets.templates')}</Text>
        {unavailableId ? <Text accessibilityLiveRegion="assertive">{unavailablePreset ? t('presets.isnotavailablerightnow', { value1: unavailablePreset.title }) : t('presets.thattemplateisnotavailablerightnow')}</Text> : null}
        {failed ? <View><Text tone="danger">{t('presets.couldnotloadtemplatesCheckyourconnection')}</Text><Button label={t('recovery.retry')} onPress={() => setAttempt(n => n + 1)} /></View>
            : presets === null ? <ActivityIndicator /> : <FlatList data={shown.slice(0, limit)} numColumns={2} keyExtractor={p => p.id} contentContainerStyle={styles.list}
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
const sheets = themedStyles(p => ({ screen: { flex: 1, backgroundColor: p.bg, padding: 16 }, list: { paddingBottom: 80 }, header: { gap: 12 }, chips: { gap: 8 } }));
