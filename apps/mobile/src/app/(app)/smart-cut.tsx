import { VideoShapeBadge } from '../../components/VideoShapeBadge';
import { shapeMismatch, shapeValue } from '../../lib/videoShape';
import { rawText } from '../../lib/i18n/translate';
import { randomUUID } from 'expo-crypto';
import { Stack, useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Switch, TextInput, View } from 'react-native';
import { useAuth } from '../../auth/AuthProvider';
import { SmartCutPreview } from '../../components/smart-cut/SmartCutPreview';
import { SmartCutAnalysisCard } from '../../components/smart-cut/SmartCutAnalysisCard';
import { SmartCutFeedback } from '../../components/smart-cut/SmartCutFeedback';
import { JobThumb, useAssetLinks } from '../../components/JobThumb';
import { Button, Card, Chip, SegmentedControl, Text, themedStyles, useThemedStyles } from '../../components/ui';
import { aiConsent } from '../../lib/aiConsentStore';
import { getCacheUser, subscribeCacheUser } from '../../lib/appCache';
import {
    CAPTION_PRESETS,
    DEFAULT_CAPTION_PRESET,
    MAX_CLIPS,
    MAX_OUTPUT_S,
    STEP_S,
    clipSeconds,
    editErrorKey,
    fetchClipDimensions,
    mixedShapes,
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
import { FULL_EDITOR_ENABLED } from '../../lib/editorFlag';
import { encodeCuts } from '../../lib/smartCutHandoff';
import { formatLocale, plural, t } from '../../lib/i18n';
import { libraryChoices } from '../../lib/librarySource';
import { BEST_CUT_LANGUAGES } from '../../lib/bestCutPlan';
import { fetchCatalog, mediaApi, type CatalogModel, type Job, type JobPage } from '../../lib/media';
import {
    SMART_CUT_PACING,
    buildSpeechAwareCutPlan,
    buildSmartCutPlan,
    SmartCutPlanError,
    smartCutPlanUsesAvailableTakes,
    smartCutPlanWithinLimits,
    swapSmartCutTake,
    validSmartCutAnalysis,
    type SmartCutPacing,
    type SmartCutPlan,
    type SmartCutSource,
    type SmartCutWarning,
} from '../../lib/smartCut';
import { fillerRanges } from '../../lib/speechFillers';
import type { SpeechAnalysis } from '../../lib/speechCut';
import { ds, LIST_END_PADDING } from '../../theme';
import { useOptionalSafeAreaInsets } from '../../lib/safeArea';
import { readSmartCutSetupDraft, removeSmartCutSetupDraft, writeSmartCutSetupDraft, type SmartCutSetupDraft } from '../../lib/smartCutSetupDrafts';
import type { SmartCutFeedbackMode } from '../../lib/smartCutFeedback';

type Stage = 'plan' | 'edit' | 'quote';
type CompareView = 'raw' | 'cut';
type Preview = { readonly url: string; readonly label: string; readonly start: number; readonly end: number };
const seconds = (value: number) => (Math.round(value * 10) / 10).toFixed(1);
const SMART_CUT_WARNING_KEYS: Record<SmartCutWarning['code'], string> = {
    review_boundaries: 'app.smartCut.warning.reviewBoundaries',
    trim_intersects_unit: 'app.smartCut.warning.trimIntersectsUnit',
    phrase_timing: 'app.smartCut.warning.phraseTiming',
    removal_retained: 'app.smartCut.warning.removalRetained',
    segment_limit_reached: 'app.smartCut.warning.segmentLimitReached',
    output_limit_reached: 'app.smartCut.warning.outputLimitReached',
    script_not_aligned: 'app.smartCut.warning.scriptNotAligned',
    script_incomplete: 'app.smartCut.warning.scriptIncomplete',
    extra_speech_omitted: 'app.smartCut.warning.extraSpeechOmitted',
    false_start_omitted: 'app.smartCut.warning.falseStartOmitted',
    retake_omitted: 'app.smartCut.warning.retakeOmitted',
    join_review: 'app.smartCut.warning.joinReview',
    language_unknown: 'app.smartCut.warning.languageUnknown',
    language_mixed: 'app.smartCut.warning.languageMixed',
    language_override_invalid: 'app.smartCut.notice.failed',
    script_match_missing: 'app.smartCut.notice.failed',
    alignment_budget_exceeded: 'app.smartCut.notice.failed',
    source_clip_limit_reached: 'app.smartCut.notice.failed',
    unit_exceeds_budget: 'app.smartCut.notice.failed',
    unsafe_timed_boundary: 'app.smartCut.notice.failed',
};
const messageParameters = (parameters: Readonly<Record<string, unknown>>): Record<string, string | number> => {
    const values: Record<string, string | number> = {};
    for (const [key, value] of Object.entries(parameters)) if (typeof value === 'string' || typeof value === 'number') values[key] = value;
    return values;
};
const warningText = (warning: SmartCutWarning) => t(SMART_CUT_WARNING_KEYS[warning.code], messageParameters(warning.parameters));
const SMART_CUT_ERROR_KEYS: Partial<Record<SmartCutWarning['code'], string>> = {
    source_clip_limit_reached: 'app.smartCut.error.sourceClipLimit',
    unit_exceeds_budget: 'app.smartCut.error.unitExceedsBudget',
    trim_intersects_unit: 'app.smartCut.error.trimIntersectsAllUnits',
    script_match_missing: 'app.smartCut.error.scriptMatchMissing',
    alignment_budget_exceeded: 'app.smartCut.error.alignmentBudgetExceeded',
    language_override_invalid: 'app.smartCut.error.languageOverrideInvalid',
    unsafe_timed_boundary: 'app.smartCut.error.unsafeTimedBoundary',
};
const planErrorText = (error: SmartCutPlanError) => t(SMART_CUT_ERROR_KEYS[error.code] || 'app.smartCut.notice.failed', messageParameters(error.parameters));
const segmentMatchText = (segment: SmartCutPlan['segments'][number]) => segment.matchCode === 'script_line_matched'
    ? t('app.smartCut.match.scriptLine', { line: Number(segment.matchParameters?.line || 0), confidence: Math.round(Number(segment.matchParameters?.confidence || 0) * 100) })
    : segment.matchCode === 'transcript_section_kept' ? t('app.smartCut.match.transcript') : segment.matchStatus;
const segmentReasonText = (segment: SmartCutPlan['segments'][number], takeName: string) => segment.reasonCode === 'best_take_score'
    ? t('app.smartCut.reason.bestTake', { take: takeName })
    : segment.reasonCode === 'manual_take' ? t('app.smartCut.reason.manualTake', { take: takeName })
        : segment.reasonCode === 'transcript_continuity' ? t('app.smartCut.reason.transcript', { take: takeName, minimumSilenceSeconds: Number(segment.reasonParameters?.minimumSilenceSeconds || 0).toFixed(2) })
            : segment.reason;

export default function SmartCutRoute() {
    const styles = useThemedStyles(sheets);
    const insets = useOptionalSafeAreaInsets();
    const { api, beginSessionTask } = useAuth();
    const links = useAssetLinks(api);
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
    const [languageOverride, setLanguageOverride] = useState('auto');
    const [analyses, setAnalyses] = useState<ReadonlyMap<string, SpeechAnalysis>>(() => new Map());
    const [analysisBusy, setAnalysisBusy] = useState(false);
    const [removeFillers, setRemoveFillers] = useState(false);
    const [skippedFillers, setSkippedFillers] = useState<readonly string[]>([]);
    const [plan, setPlan] = useState<SmartCutPlan | null>(null);
    const [feedbackTarget, setFeedbackTarget] = useState<{ readonly responseId: string; readonly planMode: SmartCutFeedbackMode } | null>(null);
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
    const [setupDraft, setSetupDraft] = useState<SmartCutSetupDraft | null | undefined>(undefined);
    const setupDraftTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const setupDraftRead = useRef(0);
    const suppressedSetupDraft = useRef('');
    const keyRef = useRef<{ signature: string; key: string } | null>(null);
    const owner = useSyncExternalStore(subscribeCacheUser, getCacheUser, getCacheUser);

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
    }, [api, beginSessionTask, owner]);

    useEffect(() => {
        if (setupDraftTimer.current) clearTimeout(setupDraftTimer.current);
        suppressedSetupDraft.current = '';
        setJobs(null);
        setNext(null);
        setClips([]);
        setPendingIds([]);
        setLoadingMore(false);
        setScript('');
        setNotes('');
        setPacing('balanced');
        setLanguageOverride('auto');
        setAnalyses(new Map());
        setAnalysisBusy(false);
        setRemoveFillers(false);
        setSkippedFillers([]);
        setPlan(null);
        setFeedbackTarget(null);
        setSnapshot(null);
        setStage('plan');
        setCaptionsOn(false);
        setCaptionPreset(DEFAULT_CAPTION_PRESET);
        setCredits(null);
        setBusy(false);
        setProblem(null);
        setPreviewBusy(null);
        setPreview(null);
        setSetupDraft(undefined);
        keyRef.current = null;
    }, [owner]);

    useEffect(() => {
        const ticket = ++setupDraftRead.current;
        if (setupDraftTimer.current) clearTimeout(setupDraftTimer.current);
        if (!owner) { setSetupDraft(null); return; }
        setSetupDraft(undefined);
        void readSmartCutSetupDraft(owner).then((saved) => {
            if (ticket === setupDraftRead.current && alive.current && owner === getCacheUser()) setSetupDraft(saved);
        });
        return () => { setupDraftRead.current++; };
    }, [owner]);

    const videos = useMemo(() => libraryChoices(jobs ?? [], models, 'video'), [jobs, models]);
    const sources = useMemo<SmartCutSource[]>(() => clips.map((clip) => ({
        id: clip.jobId,
        assetId: clip.jobId,
        name: clip.label,
        duration: clip.length ?? 0,
        rangeStart: clip.start,
        rangeEnd: clip.end,
    })), [clips]);
    const analysisReady = sources.length > 0 && sources.every((source) => {
        const analysis = analyses.get(source.assetId);
        return validSmartCutAnalysis(analysis, source.assetId, source.duration);
    });
    const phraseTimingNames = sources.filter((source) => {
        const analysis = analyses.get(source.assetId);
        return validSmartCutAnalysis(analysis, source.assetId, source.duration) && analysis.timingQuality === 'phrase';
    }).map((source) => source.name);
    const detectedLanguages = [...new Set(sources.map((source) => analyses.get(source.assetId)?.language || 'und'))];
    const analysisClips = useMemo(() => {
        const selected = stage !== 'plan' && snapshot ? snapshot : clips;
        return [...new Map(selected.map((clip) => [clip.jobId, { jobId: clip.jobId, label: clip.label, duration: clip.length ?? 0 }])).values()];
    }, [clips, snapshot, stage]);
    const fillerRows = useMemo(() => sources.flatMap((source) => {
        const analysis = analyses.get(source.assetId);
        if (!analysis || analysis.timingQuality !== 'word') return [];
        const rangeStart = source.rangeStart ?? 0, rangeEnd = source.rangeEnd ?? source.duration;
        const effectiveAnalysis = languageOverride === 'auto' ? analysis : { ...analysis, language: languageOverride };
        return fillerRanges(effectiveAnalysis, { start: rangeStart, end: rangeEnd }).map((range) => {
            const start = Math.max(rangeStart, range.start), end = Math.min(rangeEnd, range.end);
            return { ...range, start, end, takeId: source.id, key: `${source.id}:${start}:${end}` };
        });
    }), [analyses, languageOverride, sources]);
    const captions = captionsOn ? captionPreset : null;
    const total = totalSeconds(clips);
    const selectedCount = clips.length + pendingIds.length;
    const draftValue = useMemo<SmartCutSetupDraft | null>(() => owner && clips.length ? ({
        owner, updatedAt: Date.now(), clips, script, notes, pacing, language: languageOverride,
        removeFillers, skippedFillers, captionsOn, captionPreset,
    }) : null, [captionPreset, captionsOn, clips, languageOverride, notes, owner, pacing, removeFillers, script, skippedFillers]);

    useEffect(() => {
        if (setupDraft !== null || !owner) return;
        if (setupDraftTimer.current) clearTimeout(setupDraftTimer.current);
        if (suppressedSetupDraft.current === JSON.stringify(draftValue)) return;
        if (!draftValue) {
            void removeSmartCutSetupDraft(owner).catch(() => undefined);
            return;
        }
        setupDraftTimer.current = setTimeout(() => { void writeSmartCutSetupDraft({ ...draftValue, updatedAt: Date.now() }); }, 500);
        return () => { if (setupDraftTimer.current) clearTimeout(setupDraftTimer.current); };
    }, [draftValue, owner, setupDraft]);

    function recoverSetupDraft() {
        if (!setupDraft) return;
        setClips(setupDraft.clips.map((clip) => ({ ...clip })));
        setScript(setupDraft.script); setNotes(setupDraft.notes); setPacing(setupDraft.pacing); setLanguageOverride(setupDraft.language);
        setRemoveFillers(setupDraft.removeFillers); setSkippedFillers([...setupDraft.skippedFillers]);
        setCaptionsOn(setupDraft.captionsOn); setCaptionPreset(setupDraft.captionPreset);
        suppressedSetupDraft.current = '';
        setPlan(null); setFeedbackTarget(null); setSnapshot(null); setStage('plan'); setProblem(null); setSetupDraft(null);
    }

    function discardSetupDraft() {
        suppressedSetupDraft.current = JSON.stringify(draftValue);
        if (owner) void removeSmartCutSetupDraft(owner).catch(() => undefined);
        setSetupDraft(null);
    }

    function clearSetupDraft() {
        if (setupDraftTimer.current) clearTimeout(setupDraftTimer.current);
        suppressedSetupDraft.current = JSON.stringify(draftValue);
        if (owner) void removeSmartCutSetupDraft(owner).catch(() => undefined);
        setSetupDraft(null);
    }

    function recordAnalysis(jobId: string, analysis: SpeechAnalysis) {
        setAnalyses((current) => {
            const next = new Map(current);
            next.set(jobId, analysis);
            return next;
        });
        setPlan(null);
        setFeedbackTarget(null);
        setSnapshot(null);
    }

    function invalidatePlan() {
        setPlan(null);
        setFeedbackTarget(null);
        setSnapshot(null);
    }

    function discardAnalysisResult() {
        // Discard only the settled transcript-backed result. The source clips,
        // script, notes and setup draft stay in place so manual editing remains
        // available and a new analysis is always an explicit user action.
        setAnalyses(new Map());
        setRemoveFillers(false);
        setSkippedFillers([]);
        invalidatePlan();
        setProblem(null);
    }

    function changePacing(value: SmartCutPacing) {
        setPacing(value);
        invalidatePlan();
    }

    function changeScript(value: string) {
        setScript(value);
        invalidatePlan();
    }

    function changeNotes(value: string) {
        setNotes(value);
        invalidatePlan();
    }

    function changeLanguage(value: string) {
        setLanguageOverride(value);
        setSkippedFillers([]);
        invalidatePlan();
    }

    function changeRemoveFillers(value: boolean) {
        setRemoveFillers(value);
        invalidatePlan();
    }

    function toggleFiller(key: string) {
        setSkippedFillers((current) => current.includes(key) ? current.filter((value) => value !== key) : [...current, key]);
        invalidatePlan();
    }

    async function addTake(jobId: string, name: string) {
        if (selectedCount >= MAX_CLIPS || pendingIds.includes(jobId) || clips.some((clip) => clip.jobId === jobId)) return;
        const task = beginSessionTask();
        setProblem(null);
        setPendingIds((ids) => [...ids, jobId]);
        try {
            const stored = jobs?.find(job => job.job_id === jobId);
            const info = stored?.shape_ambiguous || shapeValue(stored?.video_width, stored?.video_height)
                ? Promise.resolve(null) : fetchClipDimensions(api, jobId);
            const [media, measured] = await Promise.all([libraryMedia(api, { jobId, name }, 'video'), info]);
            const video_width = stored?.video_width ?? measured?.width, video_height = stored?.video_height ?? measured?.height;
            const aspect = stored?.shape_ambiguous ? null : Number(shapeValue(video_width, video_height)) || null;
            if (!alive.current || !task.current()) return;
            if (!media?.frames) { setProblem(t('edit.unreadable')); return; }
            const length = media.frames / 30;
            const added: Clip = { jobId, label: name, length, start: 0, end: Math.floor(length * 100) / 100, aspect, video_width, video_height, shape_ambiguous: stored?.shape_ambiguous };
            setClips((current) => [...current, added]);
            setPlan(null);
            setFeedbackTarget(null);
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
        setFeedbackTarget(null);
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
        if (mixedShapes(clips)) { setProblem(t('edit.problem.mixed_shape')); return; }
        setProblem(null);
        try {
            const nextPlan = analysisReady ? buildSpeechAwareCutPlan({
                clips: sources,
                analyses,
                script,
                notes,
                languageOverride: languageOverride === 'auto' ? '' : languageOverride,
                pacing,
                removals: removeFillers ? fillerRows.filter((row) => !skippedFillers.includes(row.key)).map(({ takeId, start, end }) => ({ takeId, start, end })) : [],
            }) : buildSmartCutPlan({ clips: sources, script, notes, pacing });
            setPlan(nextPlan);
            setFeedbackTarget({ responseId: randomUUID(), planMode: nextPlan.mode === 'local-demo' ? 'local-preview' : 'transcript-silence' });
            setCompare('cut');
        } catch (error) {
            setPlan(null);
            setFeedbackTarget(null);
            setProblem(error instanceof SmartCutPlanError ? planErrorText(error) : error instanceof Error ? error.message : t('app.smartCut.notice.failed'));
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
        setFeedbackTarget(null);
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
            if (quote.kind === 'created') { clearSetupDraft(); router.replace({ pathname: '/job/[id]', params: { id: quote.jobId } }); return; }
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
            clearSetupDraft();
            router.replace({ pathname: '/job/[id]', params: { id: result.jobId } });
        } catch (error) {
            const nextPrice = priceChanged(error);
            if (nextPrice !== null) { setCredits(nextPrice); setProblem(t('edit.priceChanged', { credits: nextPrice })); }
            else setProblem(t(editErrorKey(error)));
        } finally { if (alive.current) setBusy(false); }
    }

    const quoteOpen = stage === 'quote' && credits !== null;

    const safeContent = [styles.content, {
        width: '100%' as const, maxWidth: 960, alignSelf: 'center' as const,
        paddingLeft: insets.left + ds.space.lg, paddingRight: insets.right + ds.space.lg,
        paddingBottom: insets.bottom + LIST_END_PADDING,
    }];
    const quoteView = quoteOpen ? (
            <ScrollView style={styles.screen} contentContainerStyle={safeContent}>
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
        ) : null;

    return (
        <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <Stack.Screen options={{ title: t(quoteOpen ? 'edit.reviewTitle' : 'app.smartCut.name') }} />
            <View style={quoteOpen ? styles.hidden : styles.routeBody} accessibilityElementsHidden={quoteOpen} importantForAccessibility={quoteOpen ? 'no-hide-descendants' : 'auto'}>
            <ScrollView contentContainerStyle={safeContent} keyboardShouldPersistTaps="handled">
                <View style={styles.hero}>
                    <Text variant="caption" tone="accent">{t('app.smartCut.name')}</Text>
                    <Text variant="display" accessibilityRole="header">{t('app.smartCut.entry.title')}</Text>
                    <Text tone="secondary">{t('app.smartCut.entry.intro')}</Text>
                </View>

                {setupDraft ? <Card style={styles.stack}>
                    <Text variant="bodyStrong">{t('app.smartCut.draft.title')}</Text>
                    <Text variant="footnote" tone="secondary">{t('app.smartCut.draft.body')}</Text>
                    <View style={styles.actions}>
                        <Button label={t('app.smartCut.draft.restore')} onPress={recoverSetupDraft} />
                        <Button label={t('app.smartCut.draft.discard')} variant="tertiary" onPress={discardSetupDraft} />
                    </View>
                </Card> : null}

                {stage === 'plan' ? <>
                    <SectionHeading title={t('app.smartCut.entry.step.pick.title')} detail={t('chatDepth.selected', { count: selectedCount, max: MAX_CLIPS })} />
                    {/* QA F12: warn as soon as clips of different shapes are picked, not after planning and pricing. */}
                    {mixedShapes(clips) ? <Text tone="danger" accessibilityRole="alert">{t('edit.problem.mixed_shape')}</Text> : null}
                    {jobs === null ? <Text tone="secondary">{t('common.loading')}</Text> : videos.length === 0 ? <Text tone="secondary">{t('edit.none')}</Text> : videos.map((video) => {
                        const selected = clips.some((clip) => clip.jobId === video.jobId);
                        const pending = pendingIds.includes(video.jobId);
                        const shape = clips.find(clip => clip.jobId === video.jobId) ?? jobs?.find(job => job.job_id === video.jobId);
                        return <Card key={video.jobId} style={styles.libraryRow}>
                            <JobThumb links={links} jobId={video.jobId} size={64} />
                            <View style={styles.rowCopy}>
                                <Text variant="bodyStrong" numberOfLines={1}>{video.name}</Text>
                                <VideoShapeBadge item={shape ?? {}} mismatch={shapeMismatch(shape, clips[0])} />
                                <Text variant="footnote" tone="secondary">{new Date(video.createdAt).toLocaleDateString(formatLocale())}</Text>
                            </View>
                            <Button label={selected ? t('edit.remove') : pending ? t('edit.reading') : t('editorSimple.add')} accessibilityLabel={selected || pending ? undefined : t('edit.add')} size="md" variant={selected ? 'tertiary' : 'secondary'} loading={pending} disabled={analysisBusy || pending || (!selected && selectedCount >= MAX_CLIPS)} onPress={() => selected ? removeTake(video.jobId) : void addTake(video.jobId, video.name)} />
                        </Card>;
                    })}
                    {next ? <Button label={t('library.older')} variant="tertiary" loading={loadingMore} disabled={analysisBusy} onPress={() => void loadOlder()} /> : null}

                </> : null}

                <View style={stage === 'plan' ? undefined : styles.hidden} accessibilityElementsHidden={stage !== 'plan'} importantForAccessibility={stage === 'plan' ? 'auto' : 'no-hide-descendants'}>
                    <SmartCutAnalysisCard clips={analysisClips} disabled={mixedShapes(clips)}
                        analyses={analyses} onAnalysed={recordAnalysis} onBusyChange={setAnalysisBusy} />
                </View>

                {stage === 'plan' ? <>
                    <SectionHeading title={t('app.smartCut.shape.title')} detail={t('app.smartCut.action.createPreview')} />
                    {analysisReady ? <>
                        <Text variant="caption" tone="accent">{t('app.smartCut.mode.speechReady')}</Text>
                        <Text tone="secondary">{t('app.smartCut.speechReady')}</Text>
                        <Text variant="footnote" tone="secondary">{t('app.smartCut.language.label')}</Text>
                        <ScrollView horizontal contentContainerStyle={styles.chips} showsHorizontalScrollIndicator={false}>
                            {['auto', ...BEST_CUT_LANGUAGES].map((value) => <Chip key={value} selected={languageOverride === value}
                                label={value === 'auto' ? t('app.smartCut.language.auto') : t(`bestCut.language.${value}`)} onPress={() => changeLanguage(value)} />)}
                        </ScrollView>
                        <Text variant="footnote" tone="secondary">{languageOverride === 'auto'
                            ? detectedLanguages.includes('und') ? t('app.smartCut.language.autoUnknown')
                                : detectedLanguages.length > 1 ? t('app.smartCut.language.autoMixed')
                                    : t('app.smartCut.language.autoDetected', { language: detectedLanguages[0] ? t(`bestCut.language.${detectedLanguages[0]}`) : t('app.smartCut.language.auto') })
                            : t('app.smartCut.language.help')}</Text>
                        <View style={styles.switchRow}><Text variant="bodyStrong">{t('app.smartCut.fillers.toggle', { count: fillerRows.length })}</Text><Switch accessibilityLabel={rawText(t('app.smartCut.fillers.toggle', { count: fillerRows.length }))} disabled={!fillerRows.length} value={removeFillers} onValueChange={changeRemoveFillers} /></View>
                        {removeFillers ? fillerRows.map((row) => <Chip key={row.key} selected={!skippedFillers.includes(row.key)} label={t('app.smartCut.fillers.row', { label: row.label, start: seconds(row.start), end: seconds(row.end) })} onPress={() => toggleFiller(row.key)} />) : null}
                        {phraseTimingNames.length ? <Text variant="footnote" tone="secondary">{t('app.smartCut.native.fillers.wordTimingRequired', { names: phraseTimingNames.join(', ') })}</Text>
                            : !fillerRows.length ? <Text variant="footnote" tone="secondary">{t('app.smartCut.fillers.none')}</Text> : null}
                    </> : <>
                        <Field label={t('app.smartCut.notes')} value={notes} placeholder={t('app.smartCut.notesPlaceholder')} multiline onChange={changeNotes} />
                    </>}
                    <Field label={t('app.smartCut.script')} value={script} placeholder={t('app.smartCut.scriptPlaceholder')} multiline onChange={changeScript} />
                    <Text variant="footnote" tone="secondary">{t('app.smartCut.pacing')}</Text>
                    <View style={styles.chips}>{(Object.keys(SMART_CUT_PACING) as SmartCutPacing[]).map((value) => <Chip key={value} selected={pacing === value} label={t(`app.smartCut.pacing.${value}`)} onPress={() => changePacing(value)} />)}</View>
                    <Button label={t(analysisReady ? 'app.smartCut.action.removePauses' : 'app.smartCut.action.createPreview')} disabled={!clips.length || pendingIds.length > 0 || analysisBusy || mixedShapes(clips)} onPress={createPlan} />

                    {plan ? <Card style={styles.planCard}>
                        <Text variant="caption" tone="accent">{t(plan.mode === 'transcript-silence' ? 'app.smartCut.mode.speechAware' : 'app.smartCut.mode.localPreview')}</Text>
                        <Text variant="bodyStrong">{t(plan.mode === 'transcript-silence' ? 'app.smartCut.notice.speechCreated' : 'app.smartCut.notice.localCreated')}</Text>
                        <SegmentedControl options={[{ value: 'raw', label: t('app.smartCut.view.raw') }, { value: 'cut', label: t('app.smartCut.view.cut') }]} value={compare} onChange={setCompare} />
                        <Text variant="footnote" tone="secondary">{t('app.smartCut.planSummary', { duration: seconds(plan.totalDuration), count: plan.segments.length, pacing: t(`app.smartCut.pacing.${pacing}`) })}{plan.silenceRemoved != null ? t('app.smartCut.removed', { duration: seconds(plan.silenceRemoved) }) : ''}</Text>
                        {compare === 'raw' ? plan.takes.map((take) => <Card key={take.id} style={styles.segment}>
                            <View style={styles.segmentTop}><View style={styles.rowCopy}><Text variant="bodyStrong">{take.name}</Text><Text variant="footnote" tone="secondary">{t('app.smartCut.sourceDuration', { duration: seconds(take.duration) })}</Text></View><Button label={t('app.smartCut.preview', { name: take.name })} size="sm" variant="tertiary" loading={previewBusy === `${take.assetId}:${take.rangeStart}`} onPress={() => void openPreview(take.assetId, take.name, take.rangeStart, take.rangeEnd)} /></View>
                        </Card>) : plan.segments.map((segment, index) => {
                            const take = plan.takes.find((item) => item.id === segment.takeId)!;
                            const eligibleTakes = plan.mode === 'transcript-silence'
                                ? plan.takes.filter((item) => item.id === segment.takeId || segment.alternates?.includes(item.id))
                                : plan.takes;
                            return <Card key={segment.id} style={styles.segment}>
                                <View style={styles.segmentTop}><View style={styles.rowCopy}><Text variant="caption" tone="accent">{t('app.smartCut.section', { count: index + 1 })}</Text><Text variant="bodyStrong">{segment.label}</Text></View><Text variant="footnote" tone="secondary">{t('app.smartCut.range', { start: seconds(segment.start), end: seconds(segment.end) })}</Text></View>
                                <Text variant="footnote" tone="secondary">{t('app.smartCut.take')}</Text>
                                {eligibleTakes.length < 2 ? <Text variant="bodyStrong">{take.name}</Text> : <View style={styles.chips}>{eligibleTakes.map((option) => <Chip key={option.id} selected={option.id === segment.takeId} label={option.name} onPress={() => setPlan((current) => current ? swapSmartCutTake(current, segment.id, option.id) : current)} />)}</View>}
                                <Button label={t('app.smartCut.preview', { name: take.name })} variant="secondary" size="md" loading={previewBusy === `${take.assetId}:${segment.start}`} onPress={() => void openPreview(take.assetId, take.name, segment.start, segment.end)} />
                                <Text variant="footnote" tone={plan.mode === 'transcript-silence' ? 'accent' : 'danger'}>{segmentMatchText(segment)}</Text>
                                <Text variant="footnote" tone="secondary">{t('app.smartCut.why')} {segmentReasonText(segment, take.name)}</Text>
                            </Card>;
                        })}
                        <Card style={styles.warning}>
                            <Text variant="footnote" tone="secondary">{t('app.smartCut.warnings')}</Text>
                            {(plan.warningDetails?.length ? [...new Set(plan.warningDetails.map(warningText))] : plan.warnings).map((warning) => <Text key={warning} variant="footnote" tone="secondary">• {warning}</Text>)}
                        </Card>
                        {feedbackTarget ? <SmartCutFeedback key={feedbackTarget.responseId} api={api} responseId={feedbackTarget.responseId} planMode={feedbackTarget.planMode} /> : null}
                        <View style={styles.actions}>
                            <Button label={t('app.smartCut.action.apply')} disabled={analysisBusy} onPress={applyPlan} />
                            <Button label={t('app.smartCut.action.restart')} variant="tertiary" onPress={() => { setPlan(null); setFeedbackTarget(null); }} />
                            {plan.mode === 'transcript-silence' ? <Button label={t('app.smartCut.action.discard')} variant="tertiary" tone="danger" disabled={analysisBusy} onPress={discardAnalysisResult} /> : null}
                        </View>
                    </Card> : null}
                </> : <>
                    <SectionHeading title={t('app.smartCut.review.title')} detail={t('app.smartCut.notice.applied')} />
                    {snapshot ? <Button label={t('app.smartCut.action.undo')} variant="secondary" onPress={undoPlan} /> : null}
                    <Text variant="title2">{t('app.smartCut.summary.title')}</Text>
                    {clips.map((clip, index) => <Card key={`${clip.jobId}-${index}`} style={styles.stack}>
                        <VideoShapeBadge item={clip} mismatch={shapeMismatch(clip, clips[0])} />
                        <View style={styles.segmentTop}><View style={styles.rowCopy}><Text variant="bodyStrong">{clip.label}</Text><Text variant="footnote" tone="secondary">{t('app.smartCut.sourceDuration', { duration: seconds(clip.length ?? 0) })} · {t('edit.uses', { seconds: seconds(clipSeconds(clip)) })}</Text></View><Button label={t('app.smartCut.preview', { name: clip.label })} size="sm" variant="tertiary" loading={previewBusy === `${clip.jobId}:${clip.start}`} onPress={() => void openPreview(clip.jobId, clip.label, clip.start, clip.end)} /></View>
                        <RangeStepper label={t('edit.start')} value={clip.start} lessLabel={t('edit.startEarlier')} moreLabel={t('edit.startLater')} onLess={() => setClips((current) => current.map((item, itemIndex) => itemIndex === index ? stepStart(item, -STEP_S) : item))} onMore={() => setClips((current) => current.map((item, itemIndex) => itemIndex === index ? stepStart(item, STEP_S) : item))} />
                        <RangeStepper label={t('edit.end')} value={clip.end} lessLabel={t('edit.endEarlier')} moreLabel={t('edit.endLater')} onLess={() => setClips((current) => current.map((item, itemIndex) => itemIndex === index ? stepEnd(item, -STEP_S) : item))} onMore={() => setClips((current) => current.map((item, itemIndex) => itemIndex === index ? stepEnd(item, STEP_S) : item))} />
                        <View style={styles.actions}><Button label={t('edit.up')} accessibilityLabel={t('edit.up')} size="sm" variant="tertiary" disabled={index === 0} onPress={() => setClips((current) => moveClip(current, index, -1))} /><Button label={t('edit.down')} accessibilityLabel={t('edit.down')} size="sm" variant="tertiary" disabled={index === clips.length - 1} onPress={() => setClips((current) => moveClip(current, index, 1))} /><Button label={t('edit.remove')} size="sm" variant="tertiary" tone="danger" onPress={() => setClips((current) => current.filter((_, itemIndex) => itemIndex !== index))} /></View>
                    </Card>)}
                    <View style={styles.switchRow}><Text variant="bodyStrong">{t('edit.captionsOn')}</Text><Switch accessibilityLabel={rawText(t('edit.captionsOn'))} value={captionsOn} onValueChange={setCaptionsOn} /></View>
                    {captionsOn ? <><Text variant="footnote" tone="secondary">{t('app.editor.sheet.style')}</Text><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>{CAPTION_PRESETS.map((preset) => <Chip key={preset} selected={captionPreset === preset} label={preset} onPress={() => setCaptionPreset(preset)} />)}</ScrollView></> : null}
                    <Text tone={total > MAX_OUTPUT_S ? 'danger' : 'secondary'}>{t('edit.total', { seconds: seconds(total), max: MAX_OUTPUT_S })}</Text>
                    {FULL_EDITOR_ENABLED && clips.length > 0 && clips.length <= MAX_CLIPS ? <Button label={t('edit.openLocal')} onPress={() => { clearSetupDraft(); router.push({ pathname: '/editor/new', params: { cuts: encodeCuts(clips.map((clip) => ({ jobId: clip.jobId, start: clip.start, end: clip.end }))) } }); }} /> : null}
                    <Button variant={FULL_EDITOR_ENABLED ? 'secondary' : 'primary'} label={t('edit.review')} loading={busy} disabled={busy} onPress={() => void reviewPrice()} />
                </>}
                {problem ? <Text tone="danger" accessibilityRole="alert">{problem}</Text> : null}
            </ScrollView>
            </View>
            {quoteView}
            {!quoteOpen && preview ? <SmartCutPreview {...preview} onClose={() => setPreview(null)} /> : null}
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
    routeBody: { flex: 1 },
    hidden: { display: 'none' },
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
