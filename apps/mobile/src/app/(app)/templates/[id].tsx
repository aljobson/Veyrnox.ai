import { rawText } from '../../../lib/i18n/translate';
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
import { GENERATION_PROMPT_MAX } from '../../../lib/promptLimits';

// The longest prompt the generations route accepts.
const TEMPLATE_PROMPT_MAX = GENERATION_PROMPT_MAX;

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
    const hasExactSourcePrompt = preset?.sourcePromptOrigin === 'community-source-exact' && typeof preset.sourcePrompt === 'string';
    const sourcePromptUnavailable = preset?.sourcePromptStatus === 'unavailable';
    const sourcePromptNotRecorded = preset?.sourcePromptStatus === 'adaptation-only';
    const sourcePromptTruncated = preset?.sourcePromptStatus === 'exact-truncated';
    const sourcePromptDuplicate = typeof preset?.sourcePromptDuplicateOf === 'string';
    const sourcePromptBlocked = hasExactSourcePrompt && preset?.sourcePromptRunnable === false;
    const hasRunnableAdaptation = sourcePromptBlocked
        && preset?.promptOrigin === 'veyrnox-adaptation'
        && preset.prompt !== preset.sourcePrompt;
    const sourcePromptModelLimitOnly = preset?.sourcePromptIssues?.includes('model-prompt-limit-exceeded')
        && preset.sourcePromptIssues.every(issue => ['model-prompt-limit-exceeded', 'source-input-contract-not-wired'].includes(issue));
    // Exact source text is always shown and copied unchanged. A separate
    // Veyrnox adaptation remains editable when the exact source contract is
    // not wired, so users are never charged for a missing reference.
    const promptLabel = t(hasExactSourcePrompt ? 'public.TemplateRecipe.exactCommunityPrompt' : preset?.promptOrigin === 'veyrnox-adaptation' ? 'public.TemplateRecipe.generationPrompt' : 'mobile.prompt');
    const tooLong = prompt.length > TEMPLATE_PROMPT_MAX;
    useEffect(() => {
        let live = true; setLoading(true); setFailed(false); setCopied(null);
        fetchPresets().then(all => { if (live) { const found = all.find(p => p.id === id) ?? null; const useAdaptation = found?.sourcePromptOrigin === 'community-source-exact' && found.sourcePromptRunnable === false && found.promptOrigin === 'veyrnox-adaptation' && found.prompt !== found.sourcePrompt; setPreset(found); setPrompt(found ? (useAdaptation ? found.prompt : found.sourcePromptOrigin === 'community-source-exact' && found.sourcePrompt ? found.sourcePrompt : found.prompt) : ''); } }).catch(() => { if (live) setFailed(true); }).finally(() => { if (live) setLoading(false); });
        return () => { live = false; };
    }, [id, attempt]);
    return <ScrollView contentContainerStyle={styles.screen}>
        <Stack.Screen options={{ title: t('presets.templates') }} />
        {loading ? <ActivityIndicator /> : failed ? <><Text tone="danger">{t('presets.couldnotloadtemplatesCheckyourconnection')}</Text><Button label={t('recovery.retry')} onPress={() => setAttempt(n => n + 1)} /></> : !preset ? <><Text>{t('presets.thattemplateisnotavailablerightnow')}</Text><Button label={t('presets.templates')} onPress={() => router.push('/create/presets')} /></> : <>
            <View style={styles.row}><Text variant="caption">{themeTitle(preset.category)}</Text>{preset.isNew ? <Text variant="caption">{t('explore.new')}</Text> : null}</View>
            <Text variant="title1" accessibilityRole="header">{preset.title}</Text>
            <Text>{t('libraryCreate.runsOn', { model: preset.modelName })}</Text>
            {preset.sourceModel ? <Text variant="caption">{preset.sourcePlatform} · {preset.sourceModel}</Text> : null}
            {preset.needs ? <Card><Text>{t('presets.needs', { value1: preset.needs })}</Text>{preset.sourceAspect ? <Text>{t('presets.detail.sourceAspect', { aspect: preset.sourceAspect })}</Text> : null}</Card> : null}
            {preset.previewUrl ? <InlineMedia url={preset.previewUrl} label={t('job.playVideo')} /> : preset.posterUrl ? <Image source={{ uri: preset.posterUrl }} cachePolicy="memory" contentFit="contain" style={{ width: '100%', aspectRatio: previewRatio(preset) }} accessibilityLabel={rawText(preset.title)} /> : null}
            {sourcePromptUnavailable ? <Card><Text>{t('public.TemplateRecipe.sourcePromptUnavailable')}</Text></Card> : null}
            {sourcePromptNotRecorded ? <Card><Text>{t('public.TemplateRecipe.sourcePromptNotRecorded')}</Text></Card> : null}
            <TextField label={promptLabel} accessibilityLabel={promptLabel} value={hasRunnableAdaptation ? preset.sourcePrompt ?? '' : prompt} editable={!sourcePromptBlocked} onChangeText={value => { if (!sourcePromptBlocked) { setPrompt(value); setCopied(null); } }} multiline style={hasExactSourcePrompt ? { writingDirection: 'auto', textAlign: 'auto' } : undefined} />
            <Button label={t(hasExactSourcePrompt ? 'public.TemplateRecipe.copyExactCommunityPrompt' : 'editor.copy')} onPress={async () => setCopied(t(await copyText(hasRunnableAdaptation ? preset.sourcePrompt ?? '' : prompt) ? 'libraryCreate.copied' : 'libraryCreate.copyFailed'))} />
            {copied ? <Text accessibilityLiveRegion="polite">{copied}</Text> : null}
            {tooLong ? <Text tone="danger" accessibilityLiveRegion="polite">{t('public.TemplateRecipe.productPromptTooLong', { count: prompt.length, max: TEMPLATE_PROMPT_MAX })}</Text> : null}
            {hasExactSourcePrompt && !sourcePromptBlocked ? <Text>{t('public.TemplateRecipe.exactCommunityPromptHelp')}</Text> : null}
            {hasExactSourcePrompt && sourcePromptTruncated ? <Card><Text>{t('public.TemplateRecipe.sourcePromptTruncated')}</Text></Card> : null}
            {hasExactSourcePrompt && sourcePromptDuplicate ? <Card><Text>{t('public.TemplateRecipe.sourcePromptDuplicate')}</Text></Card> : null}
            {sourcePromptBlocked ? <Card><Text>{sourcePromptModelLimitOnly && preset.sourcePromptModelPromptMax ? t('public.TemplateRecipe.sourcePromptModelLimitCopyOnly', { max: preset.sourcePromptModelPromptMax }) : t('public.TemplateRecipe.sourcePromptCopyOnly')}</Text></Card> : null}
            {hasRunnableAdaptation ? <Card>
                <TextField label={t('public.TemplateRecipe.generationPrompt')} accessibilityLabel={t('public.TemplateRecipe.generationPrompt')} value={prompt} onChangeText={value => { setPrompt(value); setCopied(null); }} multiline />
                <Button label={t('editor.copy')} onPress={async () => setCopied(t(await copyText(prompt) ? 'libraryCreate.copied' : 'libraryCreate.copyFailed'))} />
                <Text>{t('public.TemplateRecipe.adaptedForTheModelBelowTo')}</Text>
            </Card> : null}
            <Text tone="warning">{templatePrice(preset)}</Text>
            {preset.available ? <Button label={t('libraryCreate.useTemplate')} disabled={(sourcePromptBlocked && !hasRunnableAdaptation) || tooLong || !prompt.trim()} onPress={() => router.push(presetHref({ ...preset, prompt }))} /> : <Text>{t('presets.notavailablerightnow')}</Text>}
        </>}
    </ScrollView>;
}
const sheets = themedStyles(p => ({ screen: { padding: 16, paddingBottom: 80, gap: 12, backgroundColor: p.bg }, row: { flexDirection: 'row', gap: 8 } }));
