import { rawText } from '../../../lib/i18n/translate';
import { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, View } from 'react-native';
import { Image } from 'expo-image';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { Button, Card, Chip, Text, TextField, themedStyles, useThemedStyles } from '../../../components/ui';
import { InlineMedia } from '../../../components/InlineMedia';
import { fetchPresets, presetHref, themeTitle, type Preset } from '../../../lib/presets';
import { previewRatio, templatePrice } from '../../../lib/templateFilters';
import { copyText } from '../../../lib/clipboard';
import { t } from '../../../lib/i18n';
import { estimateCredits, fetchCatalog, kindOf, type CatalogModel } from '../../../lib/media';
import { CreateResult } from '../../../components/create/CreateResult';
import { inlineBlockReason, templateRequest } from '../../../lib/templateGenerate';
import { useTemplateGenerate } from '../../../lib/useTemplateGenerate';
import { templateModelEligible, templateOptions, type TemplateChoices } from '../../../lib/templateChoices';
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
    const [catalog, setCatalog] = useState<CatalogModel[] | undefined>();
    const [choices, setChoices] = useState<TemplateChoices>({});
    const original = catalog?.find(model => model.id === preset?.modelId);
    const models = preset && original && templateModelEligible(original, original)
        ? [original, ...(catalog ?? []).filter(model => model.id !== original.id && templateModelEligible(original, model))] : [];
    const model = models.find(model => model.id === choices.modelId) ?? models[0];
    const options = preset && model ? templateOptions(preset, model, choices) : null;
    const available = preset?.available && (catalog === undefined || !!model);
    // The exact community prompt is the only prompt; edits travel with the choices.
    const promptLabel = t(hasExactSourcePrompt ? 'public.TemplateRecipe.exactCommunityPrompt' : 'mobile.prompt');
    const tooLong = prompt.length > TEMPLATE_PROMPT_MAX;
    // A template that needs no media generates right here; one that does opens Create (inlineBlockReason).
    const inline = !!preset && !!model && inlineBlockReason(preset, model) === null;
    const request = inline && preset && model && options && !tooLong && prompt.trim() ? templateRequest(preset, model, { prompt, aspect: options.aspect, duration: options.duration }) : null;
    const generation = useTemplateGenerate(request, model && options ? estimateCredits(model, options.duration) : 0);
    useEffect(() => {
        let live = true; setLoading(true); setFailed(false); setCopied(null); setChoices({});
        fetchPresets().then(all => { if (live) { const found = all.find(p => p.id === id) ?? null; setPreset(found); setPrompt(found ? (found.sourcePromptOrigin === 'community-source-exact' && found.sourcePrompt ? found.sourcePrompt : found.prompt) : ''); } }).catch(() => { if (live) setFailed(true); }).finally(() => { if (live) setLoading(false); });
        return () => { live = false; };
    }, [id, attempt]);
    useEffect(() => {
        let live = true;
        fetchCatalog().then(models => { if (live) setCatalog(models); }).catch(() => { if (live) setCatalog(undefined); });
        return () => { live = false; };
    }, []);
    return <ScrollView contentContainerStyle={styles.screen}>
        <Stack.Screen options={{ title: t('presets.templates') }} />
        {loading ? <ActivityIndicator /> : failed ? <><Text tone="danger">{t('presets.couldnotloadtemplatesCheckyourconnection')}</Text><Button label={t('recovery.retry')} onPress={() => setAttempt(n => n + 1)} /></> : !preset ? <><Text>{t('presets.thattemplateisnotavailablerightnow')}</Text><Button label={t('presets.templates')} onPress={() => router.push('/create/presets')} /></> : <>
            <View style={styles.row}><Text variant="caption">{themeTitle(preset.category)}</Text>{preset.isNew ? <Text variant="caption">{t('explore.new')}</Text> : null}</View>
            <Text variant="title1" accessibilityRole="header">{preset.title}</Text>
            <Text>{t('libraryCreate.runsOn', { model: model?.name ?? preset.modelName })}</Text>
            {preset.needs ? <Card><Text>{t('presets.needs', { value1: preset.needs })}</Text>{preset.sourceAspect ? <Text>{t('presets.detail.sourceAspect', { aspect: preset.sourceAspect })}</Text> : null}</Card> : null}
            {preset.previewUrl ? <InlineMedia url={preset.previewUrl} label={t('job.playVideo')} /> : preset.posterUrl ? <Image source={{ uri: preset.posterUrl }} cachePolicy="memory" contentFit="contain" style={{ width: '100%', aspectRatio: previewRatio(preset) }} accessibilityLabel={rawText(preset.title)} /> : null}
            {sourcePromptUnavailable ? <Card><Text>{t('public.TemplateRecipe.sourcePromptUnavailable')}</Text></Card> : null}
            {sourcePromptNotRecorded ? <Card><Text>{t('public.TemplateRecipe.sourcePromptNotRecorded')}</Text></Card> : null}
            <TextField label={promptLabel} accessibilityLabel={promptLabel} value={prompt} onChangeText={value => { setPrompt(value); setCopied(null); }} multiline style={hasExactSourcePrompt ? { writingDirection: 'auto', textAlign: 'auto' } : undefined} />
            <Button label={t(hasExactSourcePrompt ? 'public.TemplateRecipe.copyExactCommunityPrompt' : 'editor.copy')} onPress={async () => setCopied(t(await copyText(prompt) ? 'libraryCreate.copied' : 'libraryCreate.copyFailed'))} />
            {copied ? <Text accessibilityLiveRegion="polite">{copied}</Text> : null}
            {tooLong ? <Text tone="danger" accessibilityLiveRegion="polite">{t('public.TemplateRecipe.productPromptTooLong', { count: prompt.length, max: TEMPLATE_PROMPT_MAX })}</Text> : null}
            {hasExactSourcePrompt ? <Text>{t('public.TemplateRecipe.exactCommunityPromptHelp')}</Text> : null}
            {hasExactSourcePrompt && sourcePromptTruncated ? <Card><Text>{t('public.TemplateRecipe.sourcePromptTruncated')}</Text></Card> : null}
            {hasExactSourcePrompt && sourcePromptDuplicate ? <Card><Text>{t('public.TemplateRecipe.sourcePromptDuplicate')}</Text></Card> : null}
            {models.length > 1 ? <><Text>{t('create.model')}</Text><View style={styles.choices}>
                {models.map(option => <Chip key={option.id} label={option.name} accessibilityLabel={rawText(option.name)} selected={model?.id === option.id} onPress={() => setChoices({ modelId: option.id })} />)}
            </View></> : null}
            {options && options.aspects.length > 0 ? <><Text>{t('opt.aspect')}</Text><View style={styles.choices}>
                {options.aspects.map(aspect => <Chip key={aspect} label={aspect} accessibilityLabel={rawText(aspect)} selected={options.aspect === aspect} onPress={() => setChoices(previous => ({ ...previous, aspect }))} />)}
            </View></> : null}
            {model && options && options.durations.length > 0 ? <><Text>{t('chat.make.length')}</Text><View style={styles.choices}>
                {options.durations.map(duration => <Chip key={duration} label={t('create.lengthCost', { value1: duration, credits: String(estimateCredits(model, duration)) })} accessibilityLabel={t('create.lengthCost', { value1: duration, credits: String(estimateCredits(model, duration)) })} selected={options.duration === duration} onPress={() => setChoices(previous => ({ ...previous, duration }))} />)}
            </View></> : null}
            <Text tone="warning">{templatePrice(model && options ? { ...preset, credits: estimateCredits(model, options.duration), durationSeconds: options.duration } : preset)}</Text>
            {available && inline ? <>
                {generation.run && model ? <CreateResult api={generation.api} batch={{ ids: [...generation.run.ids], modelId: generation.run.modelId, kind: kindOf(model.modality), aspect: options?.aspect ?? null, duration: options?.duration ?? null, count: 1 }} catalog={catalog ?? []} onTerminal={generation.settled} /> : null}
                {generation.error ? <Text tone="danger" accessibilityLiveRegion="polite">{generation.error}</Text> : null}
                {generation.run
                    ? <Button label={t('libraryCreate.newGeneration')} disabled={generation.busy} onPress={generation.reset} />
                    : <Button label={generation.confirming ? t('app.create.confirmPrice', { credits: String(generation.price) }) : t('slip.generate')} disabled={!generation.ready} onPress={() => void generation.generate()} />}
                {generation.missing > 0 && !generation.run ? <Text accessibilityLiveRegion="polite">{t('form.err.insufficient')}</Text> : null}
                <Button variant="secondary" label={t('libraryCreate.editBeforeGenerating')} disabled={generation.busy || tooLong || !prompt.trim()} onPress={() => router.push(presetHref(preset, { ...choices, modelId: model?.id, prompt }, catalog))} />
            </> : available ? <>
                <Button label={t('libraryCreate.useTemplate')} disabled={tooLong || !prompt.trim()} onPress={() => router.push(presetHref(preset, { ...choices, modelId: model?.id, prompt }, catalog))} />
            </> : <Text>{t('presets.notavailablerightnow')}</Text>}
        </>}
    </ScrollView>;
}
const sheets = themedStyles(p => ({ screen: { padding: 16, paddingBottom: 80, gap: 12, backgroundColor: p.bg }, row: { flexDirection: 'row', gap: 8 }, choices: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 } }));
