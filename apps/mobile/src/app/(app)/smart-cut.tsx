import { BestCutEntry } from '../../components/editor/BestCutEntry';
import { useBestCutAvailability } from '../../components/editor/useBestCutAvailability';
import { rawText } from '../../lib/i18n/translate';
import { randomUUID } from 'expo-crypto';
import { Stack, useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Switch, TextInput, View } from 'react-native';
import { useAuth } from '../../auth/AuthProvider';
import { SmartCutPreview } from '../../components/smart-cut/SmartCutPreview';
import { JobThumb, useAssetLinks } from '../../components/JobThumb';
import { Button, Card, Chip, SegmentedControl, Text, themedStyles, useThemedStyles } from '../../components/ui';
import { aiConsent } from '../../lib/aiConsentStore';
import {
    CAPTION_PRESETS,
    DEFAULT_CAPTION_PRESET,
    MAX_CLIPS,
    MAX_OUTPUT_S,
    STEP_S,
    clipSeconds,
    editErrorKey,
    moveClip,
    priceChanged,
    quoteEdit,
    stepEnd,
    stepStart,
    submitEdit,
    totalSeconds,
    validateEdit,
    type Clip,
} from '../../lib/clipEdit';
import { libraryMedia } from '../../lib/editorLibraryLength';
import { formatLocale, plural, t } from '../../lib/i18n';
import { libraryChoices } from '../../lib/librarySource';
import { fetchCatalog, mediaApi, type CatalogModel, type Job, type JobPage } from '../../lib/media';
import {
    SMART_CUT_PACING,
    buildSmartCutPlan,
    smartCutPlanUsesAvailableTakes,
    smartCutPlanWithinLimits,
    swapSmartCutTake,
    type SmartCutPacing,
    type SmartCutPlan,
    type SmartCutSource,
} from '../../lib/smartCut';
import { ds, LIST_END_PADDING } from '../../theme';

type Stage = 'plan' | 'edit' | 'quote';
type CompareView = 'raw' | 'cut';
type Preview = { readonly url: string; readonly label: string; readonly start: number; readonly end: number };
const seconds = (value: number) => (Math.round(value * 10) / 10).toFixed(1);

export default function SmartCutRoute() {
    const styles = useThemedStyles(sheets);
    const { api, beginSessionTask } = useAuth();
    const links = useAssetLinks(api);
    const bestCutQuote = useBestCutAvailability(api).quote;
    const router = useRouter();
    const alive = useRef(true);
    const [jobs, setJobs] = useState<Job[] | null>(null);
    const [next, setNext] = useState<JobPage['next']>(null);
    const [models, setModels] = useState<CatalogModel[]>([]);
    const [clips, setClips] = useState<Clip[]>([]);
    const [pendingIds, setPendingIds] = useState<string[]>([]);
    const [loadingMore, setLoadingMore] = useState(false);
    const [script, setScript] = useState('');
    const [notes, setNotes] = useState('');
    const [pacing, setPacing] = useState<SmartCutPacing>('balanced');
    const [plan, setPlan] = useState<SmartCutPlan | null>(null);
    const [compare, setCompare] = useState<CompareView>('cut');
    const [stage, setStage] = useState<Stage>('plan');
    const [snapshot, setSnapshot] = useState<Clip[] | null>(null);
    const [captionsOn, setCaptionsOn] = useState(false);
    const [captionPreset, setCaptionPreset] = useState<string>(DEFAULT_CAPTION_PRESET);
    const [credits, setCredits] = useState<number | null>(null);
    const [busy, setBusy] = useState(false);
    const [problem, setProblem] = useState<string | null>(null);
    const [previewBusy, setPreviewBusy] = useState<string | null>(null);
    const [preview, setPreview] = useState<Preview | null>(null);
    const keyRef = useRef<{ signature: string; key: string } | null>(null);

    useEffect(() => {
        alive.current = true;
        const task = beginSessionTask();
        Promise.all([mediaApi(api).listJobs(), fetchCatalog()]).then(([page, catalog]) => {
            if (!alive.current || !task.current()) return;
            setJobs(page.jobs);
            setNext(page.next);
            setModels(catalog);
        }).catch(() => { if (alive.current && task.current()) setProblem(t('common.error')); });
        return () => { alive.current = false; };
    }, [api, beginSessionTask]);

    const videos = useMemo(() => libraryChoices(jobs ?? [], models, 'video'), [jobs, models]);
    const sources = useMemo<SmartCutSource[]>(() => clips.map((clip) => ({
        id: clip.jobId,
        assetId: clip.jobId,
        name: clip.label,
        duration: clip.length ?? 0,
        rangeStart: clip.start,
        rangeEnd: clip.end,
    })), [clips]);
    const captions = captionsOn ? captionPreset : null;
    const total = totalSeconds(clips);
    const selectedCount = clips.length + pendingIds.length;

    async function addTake(jobId: string, name: string) {
        if (selectedCount >= MAX_CLIPS || pendingIds.includes(jobId) || clips.some((clip) => clip.jobId === jobId)) return;
        const task = beginSessionTask();
        setProblem(null);
        setPendingIds((ids) => [...ids, jobId]);
        try {
            const media = await libraryMedia(api, { jobId, name }, 'video');
            if (!alive.current || !task.current()) return;
            if (!media?.frames) { setProblem(t('edit.unreadable')); return; }
            const length = Math.floor((media.frames / 30) * 100) / 100;
            setClips((current) => [...current, { jobId, label: name, length, start: 0, end: length }]);
            setPlan(null);
            setSnapshot(null);
        } catch {
            if (alive.current && task.current()) setProblem(t('edit.unreadable'));
        } finally {
            if (alive.current && task.current()) setPendingIds((ids) => ids.filter((id) => id !== jobId));
        }
    }

    function removeTake(jobId: string) {
        setClips((current) => current.filter((clip) => clip.jobId !== jobId));
        setPlan(null);
        setSnapshot(null);
    }

    async function loadOlder() {
        if (!next || loadingMore) return;
        const task = beginSessionTask();
        setLoadingMore(true);
        try {
            const page = await mediaApi(api).listJobs(next);
            if (!alive.current || !task.current()) return;
            setJobs((current) => [...(current ?? []), ...page.jobs.filter((job) => !(current ?? []).some((item) => item.job_id === job.job_id))]);
            setNext(page.next);
        } catch { if (alive.current && task.current()) setProblem(t('common.error')); }
        finally { if (alive.current && task.current()) setLoadingMore(false); }
    }

    function createPlan() {
        setProblem(null);
        try {
            setPlan(buildSmartCutPlan({ clips: sources, script, notes, pacing }));
            setCompare('cut');
        } catch (error) {
            setPlan(null);
            setProblem(error instanceof Error ? error.message : t('app.smartCut.notice.failed'));
        }
    }

    function applyPlan() {
        if (!smartCutPlanWithinLimits(plan) || !smartCutPlanUsesAvailableTakes(plan, sources) || !plan) {
            setProblem(t('app.smartCut.notice.clipsChanged'));
            return;
        }
        const sourceById = new Map(clips.map((clip) => [clip.jobId, clip]));
        setSnapshot(clips);
        setClips(plan.segments.map((segment) => {
            const source = sourceById.get(segment.takeId)!;
            return { ...source, start: segment.start, end: segment.end };
        }));
        setPlan(null);
        setStage('edit');
        setProblem(null);
    }

    function undoPlan() {
        if (!snapshot) return;
        setClips(snapshot);
        setSnapshot(null);
        setStage('plan');
        setProblem(null);
    }

    async function openPreview(jobId: string, label: string, start: number, end: number) {
        const task = beginSessionTask();
        setPreviewBusy(`${jobId}:${start}`);
        setProblem(null);
        try {
            const asset = await mediaApi(api).getAsset(jobId);
            if (!alive.current || !task.current()) return;
            if (!asset.mime_type.startsWith('video/')) throw new Error('not_video');
            setPreview({ url: asset.url, label, start, end });
        } catch { if (alive.current && task.current()) setProblem(t('edit.unreadable')); }
        finally { if (alive.current && task.current()) setPreviewBusy(null); }
    }

    async function reviewPrice() {
        const check = validateEdit(clips, captions);
        if (check) { setProblem(t(`edit.problem.${check}`)); return; }
        setBusy(true);
        setProblem(null);
        try {
            await aiConsent.ensure('/api/v1/generations', 'POST');
            const signature = JSON.stringify([clips.map((clip) => [clip.jobId, clip.start, clip.end]), captions]);
            const key = keyRef.current?.signature === signature ? keyRef.current.key : randomUUID();
            keyRef.current = { signature, key };
            const quote = await quoteEdit(api, clips, captions, key);
            if (quote.kind === 'created') { router.replace({ pathname: '/job/[id]', params: { id: quote.jobId } }); return; }
            setCredits(quote.credits);
            setStage('quote');
        } catch (error) { setProblem(t(editErrorKey(error))); }
        finally { if (alive.current) setBusy(false); }
    }

    async function confirmCreate() {
        if (credits === null || !keyRef.current) return;
        setBusy(true);
        setProblem(null);
        try {
            const result = await submitEdit(api, clips, captions, credits, keyRef.current.key);
            keyRef.current = null;
            router.replace({ pathname: '/job/[id]', params: { id: result.jobId } });
        } catch (error) {
            const nextPrice = priceChanged(error);
            if (nextPrice !== null) { setCredits(nextPrice); setProblem(t('edit.priceChanged', { credits: nextPrice })); }
            else setProblem(t(editErrorKey(error)));
        } finally { if (alive.current) setBusy(false); }
    }

    if (stage === 'quote' && credits !== null) {
        return (
            <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
                <Stack.Screen options={{ title: t('edit.reviewTitle') }} />
                <Text variant="display" accessibilityRole="header">{t('edit.reviewTitle')}</Text>
                <Card style={styles.stack}>
                    {clips.map((clip, index) => <Text key={`${clip.jobId}-${index}`} tone="secondary">{t('edit.stos', { value1: index + 1, value2: clip.label, value3: seconds(clip.start), value4: seconds(clip.end) })}</Text>)}
                    <Text variant="bodyStrong">{t('edit.total', { seconds: seconds(total), max: MAX_OUTPUT_S })}</Text>
                    {captions ? <Text tone="accent">{t('edit.captionsWith', { preset: captions })}</Text> : null}
                </Card>
                <Text variant="title2" tone="accent">{plural('edit.costs', credits)}</Text>
                {problem ? <Text tone="danger" accessibilityRole="alert">{problem}</Text> : null}
                <Button label={t('edit.confirm')} loading={busy} disabled={busy} onPress={() => void confirmCreate()} />
                <Button label={t('edit.backToEditing')} variant="tertiary" disabled={busy} onPress={() => { setStage('edit'); setCredits(null); setProblem(null); }} />
            </ScrollView>
        );
    }

    return (
        <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <Stack.Screen options={{ title: t('app.smartCut.name') }} />
            <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
                <BestCutEntry />{bestCutQuote ? <Text variant="title2">{t('bestCut.quickPacing')}</Text> : null}
                <View style={styles.hero}>
                    <Text variant="caption" tone="accent">{t('app.smartCut.name')}</Text>
                    <Text variant="display" accessibilityRole="header">{t('app.smartCut.entry.title')}</Text>
                    <Text tone="secondary">{t('app.smartCut.entry.intro')}</Text>
                </View>

                {stage === 'plan' ? <>
                    <SectionHeading title={t('app.smartCut.entry.step.pick.title')} detail={t('chatDepth.selected', { count: selectedCount, max: MAX_CLIPS })} />
                    {jobs === null ? <Text tone="secondary">{t('common.loading')}</Text> : videos.length === 0 ? <Text tone="secondary">{t('edit.none')}</Text> : videos.map((video) => {
                        const selected = clips.some((clip) => clip.jobId === video.jobId);
                        const pending = pendingIds.includes(video.jobId);
                        return <Card key={video.jobId} style={styles.libraryRow}>
                            <JobThumb links={links} jobId={video.jobId} size={64} />
                            <View style={styles.rowCopy}>
                                <Text variant="bodyStrong" numberOfLines={1}>{video.name}</Text>
                                <Text variant="footnote" tone="secondary">{new Date(video.createdAt).toLocaleDateString(formatLocale())}</Text>
                            </View>
                            <Button label={selected ? t('edit.remove') : pending ? t('edit.reading') : t('edit.add')} size="md" variant={selected ? 'tertiary' : 'secondary'} loading={pending} disabled={pending || (!selected && selectedCount >= MAX_CLIPS)} onPress={() => selected ? removeTake(video.jobId) : void addTake(video.jobId, video.name)} />
                        </Card>;
                    })}
                    {next ? <Button label={t('library.older')} variant="tertiary" loading={loadingMore} onPress={() => void loadOlder()} /> : null}

                    <SectionHeading title={t('app.smartCut.shape.title')} detail={t('app.smartCut.action.createPreview')} />
                    <Field label={t('app.smartCut.script')} value={script} placeholder={t('app.smartCut.scriptPlaceholder')} multiline onChange={setScript} />
                    <Field label={t('app.smartCut.notes')} value={notes} placeholder={t('app.smartCut.notesPlaceholder')} multiline onChange={setNotes} />
                    <Text variant="footnote" tone="secondary">{t('app.smartCut.pacing')}</Text>
                    <View style={styles.chips}>{(Object.keys(SMART_CUT_PACING) as SmartCutPacing[]).map((value) => <Chip key={value} selected={pacing === value} label={t(`app.smartCut.pacing.${value}`)} onPress={() => setPacing(value)} />)}</View>
                    <Button label={t('app.smartCut.action.createPreview')} disabled={!clips.length || pendingIds.length > 0} onPress={createPlan} />

                    {plan ? <Card style={styles.planCard}>
                        <Text variant="bodyStrong">{t('app.smartCut.notice.localCreated')}</Text>
                        <SegmentedControl options={[{ value: 'raw', label: t('app.smartCut.view.raw') }, { value: 'cut', label: t('app.smartCut.view.cut') }]} value={compare} onChange={setCompare} />
                        <Text variant="footnote" tone="secondary">{t('app.smartCut.planSummary', { duration: seconds(plan.totalDuration), count: plan.segments.length, pacing: t(plan.pacingLabel) })}</Text>
                        {compare === 'raw' ? plan.takes.map((take) => <Card key={take.id} style={styles.segment}>
                            <View style={styles.segmentTop}><View style={styles.rowCopy}><Text variant="bodyStrong">{take.name}</Text><Text variant="footnote" tone="secondary">{t('app.smartCut.sourceDuration', { duration: seconds(take.duration) })}</Text></View><Button label={t('app.smartCut.preview', { name: take.name })} size="sm" variant="tertiary" loading={previewBusy === `${take.assetId}:${take.rangeStart}`} onPress={() => void openPreview(take.assetId, take.name, take.rangeStart, take.rangeEnd)} /></View>
                        </Card>) : plan.segments.map((segment, index) => {
                            const take = plan.takes.find((item) => item.id === segment.takeId)!;
                            return <Card key={segment.id} style={styles.segment}>
                                <View style={styles.segmentTop}><View style={styles.rowCopy}><Text variant="caption" tone="accent">{t('app.smartCut.section', { count: index + 1 })}</Text><Text variant="bodyStrong">{segment.label}</Text></View><Text variant="footnote" tone="secondary">{t('app.smartCut.range', { start: seconds(segment.start), end: seconds(segment.end) })}</Text></View>
                                <Text variant="footnote" tone="secondary">{t('app.smartCut.take')}</Text>
                                <View style={styles.chips}>{plan.takes.map((option) => <Chip key={option.id} selected={option.id === segment.takeId} label={option.name} onPress={() => setPlan((current) => current ? swapSmartCutTake(current, segment.id, option.id) : current)} />)}</View>
                                <Button label={t('app.smartCut.preview', { name: take.name })} variant="secondary" size="md" loading={previewBusy === `${take.assetId}:${segment.start}`} onPress={() => void openPreview(take.assetId, take.name, segment.start, segment.end)} />
                                <Text variant="footnote" tone="danger">{segment.matchStatus}</Text>
                                <Text variant="footnote" tone="secondary">{t('app.smartCut.why')} {segment.reason}</Text>
                            </Card>;
                        })}
                        <Card style={styles.warning}>
                            <Text variant="footnote" tone="secondary">{t('app.smartCut.warnings')}</Text>
                            {plan.warnings.map((warning) => <Text key={warning} variant="footnote" tone="secondary">• {warning}</Text>)}
                        </Card>
                        <View style={styles.actions}>
                            <Button label={t('app.smartCut.action.apply')} onPress={applyPlan} />
                            <Button label={t('app.smartCut.action.restart')} variant="tertiary" onPress={() => setPlan(null)} />
                        </View>
                    </Card> : null}
                </> : <>
                    <SectionHeading title={t('app.smartCut.review.title')} detail={t('app.smartCut.notice.applied')} />
                    {snapshot ? <Button label={t('app.smartCut.action.undo')} variant="secondary" onPress={undoPlan} /> : null}
                    <Text variant="title2">{t('app.smartCut.summary.title')}</Text>
                    {clips.map((clip, index) => <Card key={`${clip.jobId}-${index}`} style={styles.stack}>
                        <View style={styles.segmentTop}><View style={styles.rowCopy}><Text variant="bodyStrong">{clip.label}</Text><Text variant="footnote" tone="secondary">{t('app.smartCut.sourceDuration', { duration: seconds(clip.length ?? 0) })} · {t('edit.uses', { seconds: seconds(clipSeconds(clip)) })}</Text></View><Button label={t('app.smartCut.preview', { name: clip.label })} size="sm" variant="tertiary" loading={previewBusy === `${clip.jobId}:${clip.start}`} onPress={() => void openPreview(clip.jobId, clip.label, clip.start, clip.end)} /></View>
                        <RangeStepper label={t('edit.start')} value={clip.start} lessLabel={t('edit.startEarlier')} moreLabel={t('edit.startLater')} onLess={() => setClips((current) => current.map((item, itemIndex) => itemIndex === index ? stepStart(item, -STEP_S) : item))} onMore={() => setClips((current) => current.map((item, itemIndex) => itemIndex === index ? stepStart(item, STEP_S) : item))} />
                        <RangeStepper label={t('edit.end')} value={clip.end} lessLabel={t('edit.endEarlier')} moreLabel={t('edit.endLater')} onLess={() => setClips((current) => current.map((item, itemIndex) => itemIndex === index ? stepEnd(item, -STEP_S) : item))} onMore={() => setClips((current) => current.map((item, itemIndex) => itemIndex === index ? stepEnd(item, STEP_S) : item))} />
                        <View style={styles.actions}><Button label={t('edit.up')} accessibilityLabel={t('edit.up')} size="sm" variant="tertiary" disabled={index === 0} onPress={() => setClips((current) => moveClip(current, index, -1))} /><Button label={t('edit.down')} accessibilityLabel={t('edit.down')} size="sm" variant="tertiary" disabled={index === clips.length - 1} onPress={() => setClips((current) => moveClip(current, index, 1))} /><Button label={t('edit.remove')} size="sm" variant="tertiary" tone="danger" onPress={() => setClips((current) => current.filter((_, itemIndex) => itemIndex !== index))} /></View>
                    </Card>)}
                    <View style={styles.switchRow}><Text variant="bodyStrong">{t('edit.captionsOn')}</Text><Switch accessibilityLabel={rawText(t('edit.captionsOn'))} value={captionsOn} onValueChange={setCaptionsOn} /></View>
                    {captionsOn ? <><Text variant="footnote" tone="secondary">{t('app.editor.sheet.style')}</Text><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>{CAPTION_PRESETS.map((preset) => <Chip key={preset} selected={captionPreset === preset} label={preset} onPress={() => setCaptionPreset(preset)} />)}</ScrollView></> : null}
                    <Text tone={total > MAX_OUTPUT_S ? 'danger' : 'secondary'}>{t('edit.total', { seconds: seconds(total), max: MAX_OUTPUT_S })}</Text>
                    <Button label={t('edit.review')} loading={busy} disabled={busy} onPress={() => void reviewPrice()} />
                </>}
                {problem ? <Text tone="danger" accessibilityRole="alert">{problem}</Text> : null}
            </ScrollView>
            {preview ? <SmartCutPreview {...preview} onClose={() => setPreview(null)} /> : null}
        </KeyboardAvoidingView>
    );
}

function SectionHeading({ title, detail }: { readonly title: string; readonly detail: string }) {
    const styles = useThemedStyles(sheets);
    return <View style={styles.sectionHeading}><Text variant="title2" accessibilityRole="header">{title}</Text><Text variant="footnote" tone="secondary">{detail}</Text></View>;
}

function Field({ label, value, placeholder, multiline, onChange }: { readonly label: string; readonly value: string; readonly placeholder: string; readonly multiline?: boolean; readonly onChange: (value: string) => void }) {
    const styles = useThemedStyles(sheets);
    return <View style={styles.field}><Text variant="footnote" tone="secondary">{label}</Text><TextInput accessibilityLabel={rawText(label)} value={value} placeholder={placeholder} placeholderTextColor={styles.placeholder.color} multiline={multiline} maxLength={6000} style={[styles.input, multiline && styles.multiline]} onChangeText={onChange} /></View>;
}

function RangeStepper({ label, value, lessLabel, moreLabel, onLess, onMore }: { readonly label: string; readonly value: number; readonly lessLabel: string; readonly moreLabel: string; readonly onLess: () => void; readonly onMore: () => void }) {
    const styles = useThemedStyles(sheets);
    const formatted = t('edit.s', { value1: seconds(value) });
    return <View style={styles.stepper}><Text variant="footnote" tone="secondary" style={styles.stepLabel}>{label}</Text><Button label={lessLabel} accessibilityLabel={lessLabel} size="sm" variant="tertiary" onPress={onLess}><Text variant="title2">−</Text></Button><Text variant="bodyStrong" accessibilityLabel={rawText(`${label} ${formatted}`)}>{formatted}</Text><Button label={moreLabel} accessibilityLabel={moreLabel} size="sm" variant="tertiary" onPress={onMore}><Text variant="title2">+</Text></Button></View>;
}

const sheets = themedStyles((p) => ({
    placeholder: { color: p.textTertiary },
    screen: { flex: 1, backgroundColor: p.bg },
    content: { padding: ds.space.lg, paddingBottom: LIST_END_PADDING, gap: ds.space.md },
    hero: { gap: ds.space.sm, paddingBottom: ds.space.sm },
    sectionHeading: { gap: ds.space.xs, paddingTop: ds.space.md },
    libraryRow: { minHeight: 72, padding: ds.space.md, flexDirection: 'row', alignItems: 'center', gap: ds.space.md },
    rowCopy: { flex: 1, gap: ds.space.xs },
    field: { gap: ds.space.xs },
    input: { minHeight: 48, paddingHorizontal: ds.space.md, paddingVertical: ds.space.sm, color: p.textPrimary, backgroundColor: p.bgElevated1, borderColor: p.borderStrong, borderWidth: 1, borderRadius: ds.radius.md, textAlignVertical: 'top' },
    multiline: { minHeight: 96 },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: ds.space.sm },
    planCard: { padding: ds.space.md, gap: ds.space.md, backgroundColor: p.accentSubtle, borderColor: p.accent },
    segment: { padding: ds.space.md, gap: ds.space.sm, backgroundColor: p.bgElevated1 },
    segmentTop: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: ds.space.sm },
    warning: { padding: ds.space.md, gap: ds.space.xs, backgroundColor: p.bg },
    stack: { padding: ds.space.md, gap: ds.space.sm },
    actions: { flexDirection: 'row', flexWrap: 'wrap', gap: ds.space.sm },
    switchRow: { minHeight: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: ds.space.md },
    stepper: { minHeight: 44, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: ds.space.sm },
    stepLabel: { minWidth: 36 },
}));
