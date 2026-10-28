import { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, View } from 'react-native';
import { Image } from 'expo-image';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { Button, Card, Text, TextField, themedStyles, useThemedStyles } from '../../../components/ui';
import { InlineMedia } from '../../../components/InlineMedia';
import { fetchPresets, presetHref, themeTitle, type Preset } from '../../../lib/presets';
import { previewRatio, templatePrice } from '../../../lib/templateFilters';
import { copyText } from '../../../lib/clipboard';
import { t } from '../../../lib/i18n';

export default function TemplatePage() {
    const styles = useThemedStyles(sheets);
    const { id } = useLocalSearchParams<{ id: string }>();
    const router = useRouter();
    const [preset, setPreset] = useState<Preset | null>(null);
    const [loading, setLoading] = useState(true);
    const [failed, setFailed] = useState(false);
    const [attempt, setAttempt] = useState(0);
    const [prompt, setPrompt] = useState('');
    const [copied, setCopied] = useState<string | null>(null);
    useEffect(() => {
        let live = true; setLoading(true); setFailed(false); setCopied(null);
        fetchPresets().then(all => { if (live) { const found = all.find(p => p.id === id) ?? null; setPreset(found); setPrompt(found?.prompt.slice(0, 2000) ?? ''); } }).catch(() => { if (live) setFailed(true); }).finally(() => { if (live) setLoading(false); });
        return () => { live = false; };
    }, [id, attempt]);
    return <ScrollView contentContainerStyle={styles.screen}>
        <Stack.Screen options={{ title: t('presets.templates') }} />
        {loading ? <ActivityIndicator /> : failed ? <><Text tone="danger">{t('presets.couldnotloadtemplatesCheckyourconnection')}</Text><Button label={t('recovery.retry')} onPress={() => setAttempt(n => n + 1)} /></> : !preset ? <><Text>{t('presets.thattemplateisnotavailablerightnow')}</Text><Button label={t('presets.templates')} onPress={() => router.push('/create/presets')} /></> : <>
            <View style={styles.row}><Text variant="caption">{themeTitle(preset.category)}</Text>{preset.isNew ? <Text variant="caption">{t('explore.new')}</Text> : null}</View>
            <Text variant="title1" accessibilityRole="header">{preset.title}</Text>
            <Text>{t('libraryCreate.runsOn', { model: preset.modelName })}</Text>
            {preset.needs ? <Card><Text>{t('presets.needs', { value1: preset.needs })}</Text></Card> : null}
            {preset.previewUrl ? <InlineMedia url={preset.previewUrl} label={t('job.playVideo')} /> : preset.posterUrl ? <Image source={{ uri: preset.posterUrl }} cachePolicy="memory" contentFit="contain" style={{ width: '100%', aspectRatio: previewRatio(preset) }} accessibilityLabel={preset.title} /> : null}
            <TextField accessibilityLabel={t('mobile.prompt')} value={prompt} onChangeText={value => { setPrompt(value); setCopied(null); }} multiline maxLength={2000} />
            <Button label={t('editor.copy')} onPress={async () => setCopied(t(await copyText(prompt) ? 'libraryCreate.copied' : 'libraryCreate.copyFailed'))} />
            {copied ? <Text accessibilityLiveRegion="polite">{copied}</Text> : null}
            <Text tone="warning">{templatePrice(preset)}</Text>
            {preset.available ? <Button label={t('libraryCreate.useTemplate')} onPress={() => router.push(presetHref({ ...preset, prompt }))} /> : <Text>{t('presets.notavailablerightnow')}</Text>}
        </>}
    </ScrollView>;
}
const sheets = themedStyles(p => ({ screen: { padding: 16, paddingBottom: 80, gap: 12, backgroundColor: p.bg }, row: { flexDirection: 'row', gap: 8 } }));
