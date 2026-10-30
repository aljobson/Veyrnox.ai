import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { KeyboardScreen } from '../../components/KeyboardScreen';
import { KeyboardFormScrollView } from '../../components/KeyboardFormScrollView';
import { Text, TextField, Button, Card, Chip, Checkbox, ChoiceCard, themedStyles, useThemedStyles } from '../../components/ui';
import { fetchCatalogCached, textInput, type CatalogModel } from '../../lib/media';
import { stageCreativeSourceHandoff } from '../../lib/creativeSourceHandoff';
import { FACELESS_REEL_MODEL, FACELESS_REEL_PROMPT_MAX, FACELESS_REEL_FORMATS, FACELESS_REEL_PACING, FACELESS_REEL_PLATFORMS, briefLength, briefRoom, buildFacelessReelPrompt, facelessReelLaunch, facelessReelValidation, type FacelessReelValues } from '../../lib/facelessReel';
import { t } from '../../lib/i18n';
import { ds } from '../../theme';

const formatKey = (id: string) => id === 'micro-story' ? 'microStory' : id;
export default function FacelessReel() {
    const router = useRouter();
    const styles = useThemedStyles(sheets);
    const [model, setModel] = useState<CatalogModel | null>(null);
    const [loading, setLoading] = useState(true);
    const [values, setValues] = useState<FacelessReelValues>({ topic: '', hook: '', format: 'explainer', pacing: 'balanced', platform: 'reels', duration: 5, sound: false, originality: false, faceless: false });
    const [error, setError] = useState<string | null>(null);
    const [review, setReview] = useState(false);
    useEffect(() => {
        let active = true;
        fetchCatalogCached(list => {
            if (!active) return;
            setModel(list.find(m => m.id === FACELESS_REEL_MODEL && !m.gated) ?? null);
            setLoading(false);
        }).catch(() => { if (active) { setModel(null); setLoading(false); } });
        return () => { active = false; };
    }, []);
    const input = model ? textInput(model) : null;
    const promptMax = input?.max ?? FACELESS_REEL_PROMPT_MAX;
    const room = briefRoom(values, promptMax);
    const used = briefLength(values);
    const prompt = buildFacelessReelPrompt(values);
    const over = prompt.length > promptMax;
    const disabled = loading || !input || over;
    const platform = FACELESS_REEL_PLATFORMS.find(p => p.id === values.platform)!;
    function change(patch: Partial<FacelessReelValues>) { setValues(v => ({ ...v, ...patch })); setError(null); }
    function open() {
        if (loading || !input) return;
        const reason = facelessReelValidation({ ...values, promptMax });
        if (reason) { setError(reason); return; }
        const launch = facelessReelLaunch(values);
        const sourceHandoff = stageCreativeSourceHandoff({ recipe: 'faceless-reel', modelId: launch.modelId, aspect: launch.aspect, uploaded: {}, fromLibrary: {}, ...(launch.followup ? { followup: launch.followup } : {}) });
        router.push({ pathname: '/create/[modelId]', params: { modelId: launch.modelId, prompt: launch.prompt, duration: String(launch.durationSeconds), recipe: 'faceless-reel', sourceHandoff } });
    }
    return <KeyboardScreen style={styles.screen}>
        <Stack.Screen options={{ title: t('facelessReel.chip') }} />
        <KeyboardFormScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
            <View style={styles.row}><Chip label={t('facelessReel.chip')} /><Chip label={t('facelessReel.textToVideo')} /></View>
            <Text variant="title1" accessibilityRole="header">{t('facelessReel.title')}</Text>
            <Text>{t('facelessReel.intro')}</Text>
            <Card style={styles.section}><Text variant="title3" accessibilityRole="header">{t('facelessReel.contractTitle')}</Text><Text>{t('facelessReel.contract')}</Text></Card>
            <View style={styles.section} accessibilityLabel={t('facelessReel.workflowLabel')}>
                {['idea', 'rhythm', 'review'].map(key => <Text key={key}>{t(`facelessReel.workflow.${key}`)}</Text>)}
            </View>
            <Text variant="caption">{t('facelessReel.step1')}</Text>
            <Text variant="title2" accessibilityRole="header">{t('facelessReel.storyBrief')}</Text>
            <Text>{t('facelessReel.briefLabel')}</Text>
            <TextField multiline maxLength={800} value={values.topic} onChangeText={topic => change({ topic })} accessibilityLabel={t('facelessReel.briefLabel')} placeholder={t('facelessReel.briefPlaceholder')} style={styles.brief} />
            <Text tone={used > room ? 'danger' : 'secondary'} accessibilityLiveRegion="polite">{t('facelessReel.counter', { n: used, room })}{used > room ? ` · ${t('facelessReel.over', { over: used - room })}` : ''}</Text>
            <Text>{t('facelessReel.hookLabel')}</Text>
            <TextField maxLength={160} value={values.hook} onChangeText={hook => change({ hook })} accessibilityLabel={t('facelessReel.hookAria')} placeholder={t('facelessReel.hookPlaceholder')} />
            <Text tone="secondary">{t('facelessReel.hookHelp')}</Text>
            <Text variant="caption">{t('facelessReel.step2')}</Text>
            <Text variant="title2" accessibilityRole="header">{t('facelessReel.visualStructure')}</Text>
            <Text accessibilityRole="header">{t('facelessReel.formatLabel')}</Text>
            {FACELESS_REEL_FORMATS.map(id => <ChoiceCard key={id} icon="film" selected={values.format === id} title={t(`facelessReel.format.${formatKey(id)}.label`)} detail={t(`facelessReel.format.${formatKey(id)}.description`)} onPress={() => change({ format: id })} />)}
            <Text accessibilityRole="header">{t('facelessReel.pacingLabel')}</Text>
            {FACELESS_REEL_PACING.map(id => <ChoiceCard key={id} icon="film" selected={values.pacing === id} title={t(`facelessReel.pacing.${id}.label`)} onPress={() => change({ pacing: id })} />)}
            <Text variant="caption">{t('facelessReel.step3')}</Text>
            <Text variant="title2" accessibilityRole="header">{t('facelessReel.delivery')}</Text>
            <Text accessibilityRole="header">{t('facelessReel.platformLabel')}</Text>
            {FACELESS_REEL_PLATFORMS.map(p => <ChoiceCard key={p.id} icon="film" selected={values.platform === p.id} title={t(`facelessReel.platform.${p.id}`)} detail={p.aspect} onPress={() => change({ platform: p.id })} />)}
            <Text>{t('facelessReel.duration')}</Text>
            <View style={styles.row}>{[5, 10].map(duration => <Chip key={duration} label={t('facelessReel.seconds', { n: duration })} selected={values.duration === duration} accessibilityState={{ selected: values.duration === duration }} onPress={() => change({ duration, ...(duration === 10 ? { sound: false } : {}) })} />)}</View>
            <Checkbox checked={!!values.sound} disabled={values.duration === 10} accessibilityState={{ checked: !!values.sound, disabled: values.duration === 10 }} accessibilityLabel={t('facelessReel.soundTitle')} onChange={sound => change({ sound })}><Text>{t('facelessReel.soundTitle')}</Text></Checkbox>
            <Text tone="secondary">{t('facelessReel.soundHelp')}</Text>
            <Card style={styles.section}>
                <Text variant="caption">{t('facelessReel.plan')}</Text>
                <Text accessibilityRole="header">{t(`facelessReel.format.${formatKey(values.format!)}.label`)}</Text>
                <Text variant="title3">{values.hook?.trim() || values.topic.trim() || t('facelessReel.hookEmpty')}</Text>
                <Text>{t('facelessReel.badge', { n: values.duration })}</Text>
                <Text variant="caption">{t('facelessReel.captionSafe')}</Text>
                <View style={styles.row}>
                    <View><Text>{t('facelessReel.frame')}</Text><Text>{platform.aspect}</Text></View>
                    <View><Text>{t('facelessReel.output')}</Text><Text>{t('facelessReel.seconds', { n: values.duration })}</Text></View>
                    <View><Text>{t('facelessReel.audio')}</Text><Text>{t(values.sound ? 'facelessReel.soundPass' : 'facelessReel.separate')}</Text></View>
                </View>
            </Card>
            <Text accessibilityRole="header">{t('facelessReel.originalityTitle')}</Text>
            <Checkbox checked={!!values.originality} accessibilityLabel={t('facelessReel.originality')} onChange={originality => change({ originality })}><Text>{t('facelessReel.originality')}</Text></Checkbox>
            <Checkbox checked={!!values.faceless} accessibilityLabel={t('facelessReel.noImitation')} onChange={faceless => change({ faceless })}><Text>{t('facelessReel.noImitation')}</Text></Checkbox>
            {!loading && !input ? <Text tone="secondary">{t('facelessReel.unavailable')}</Text> : null}
            <Button label={t('facelessReel.openCreate')} disabled={disabled} accessibilityState={{ disabled }} onPress={open} />
            {over || error ? <Text tone="danger" accessibilityLiveRegion="polite">{t(`facelessReel.error.${over ? 'promptLong' : error}`, { max: promptMax })}</Text> : null}
            <Text tone="secondary">{t('facelessReel.noSpend')}</Text>
            <Text variant="title2" accessibilityRole="header">{t('facelessReel.transfers')}</Text>
            {['brief', 'duration', 'frame', 'direction', values.sound ? 'sound' : 'soundOptional', 'separate'].map(key => <Text key={key}>{t(`facelessReel.transfer.${key}`)}</Text>)}
            {values.topic.trim() ? <><Button variant="tertiary" label={t('facelessReel.reviewPrompt')} accessibilityState={{ expanded: review }} onPress={() => setReview(v => !v)} />{review ? <Text accessibilityLanguage="en">{prompt}</Text> : null}</> : null}
        </KeyboardFormScrollView>
    </KeyboardScreen>;
}
const sheets = themedStyles(p => ({
    screen: { flex: 1, backgroundColor: p.bg },
    body: { padding: ds.space.lg, gap: ds.space.md, paddingBottom: 48 },
    section: { gap: ds.space.sm },
    row: { flexDirection: 'row', flexWrap: 'wrap', gap: ds.space.md },
    brief: { minHeight: 120, textAlignVertical: 'top' },
}));
