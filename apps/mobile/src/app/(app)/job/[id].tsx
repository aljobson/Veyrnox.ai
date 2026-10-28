import { subscribeCacheUser } from '../../../lib/appCache';
import { GeneratedChip } from '../../../components/library/GeneratedChip';
import { ApiError } from '../../../lib/api';
import { FacelessSoundCard } from '../../../components/FacelessSoundCard';
import { Text, Button, themedStyles, useThemedStyles } from '../../../components/ui';
import { Image } from 'expo-image';
import { InlineMedia } from '../../../components/InlineMedia';
import { Link, Stack, useLocalSearchParams, useRouter, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, View } from 'react-native';
import { useAuth } from '../../../auth/AuthProvider';
import { JobProvenance } from '../../../components/JobProvenance';
import { StemList } from '../../../components/StemList';
import { CONFIRM_MESSAGE, CONFIRM_TITLE, deleteCreation, deleteMessage, isAlreadyGone } from '../../../lib/deleteCreation';
import { afterCelebration, celebrateOutput, type CelebrationResult } from '../../../lib/celebrate';
import { REVIEW_ASK_DELAY_MS, claimReviewAsk, shouldAskForReview } from '../../../lib/reviewAsk';
import { loadReviewAsk } from '../../../lib/storeReview';
import { mediaApi, waitForJob, type JobState } from '../../../lib/media';
import { askAboutHref, editHref, makeAnotherHref, nextStepsFor, publishHref } from '../../../lib/nextSteps';
import { creativeReuseHref, kindForMime } from '../../../lib/creativeReuse';
import { saveOutput, shareOutput } from '../../../lib/output';
import { ds } from '../../../theme';
import { plural, t, formatLocale } from '../../../lib/i18n';

import { cancelErrorKey, cancelJob, getCancelStatus, type CancelStatus } from '../../../lib/cancelJob';

// Embedded renderers without navigation focus support still clean up on unmount.
const useRatingFocusEffect = useFocusEffect ?? ((effect: () => void | (() => void)) => useEffect(effect, [effect]));

// Catalog keys, looked up when shown.
const LABEL: Record<JobState, string> = {
    queued: 'job.queued',
    running: 'job.running',
    succeeded: 'job.succeeded',
    failed: 'job.failed',
};

function elapsed(seconds: number): string {
    const m = Math.floor(seconds / 60);
    return m > 0 ? `${m}m ${seconds % 60}s` : `${seconds}s`;
}

export default function JobScreen() {
    const styles = useThemedStyles(sheets);
    const { id, followup } = useLocalSearchParams<{ id: string; followup?: string }>();
    const { api } = useAuth();
    const router = useRouter();
    // Read by the delayed rating ask; kept out of the effect's dependencies so a new router object cannot restart the poll.
    const routerRef = useRef(router);
    routerRef.current = router;
    const [state, setState] = useState<JobState>('queued');
    const [asset, setAsset] = useState<{ url: string; mime: string } | null>(null);
    // A stem-splitting job has six tracks instead of one file.
    const [stems, setStems] = useState<string[]>([]);
    const [modelId, setModelId] = useState<string | null>(null);
    const [held, setHeld] = useState(false);
    const [expiresAt, setExpiresAt] = useState<string | null>(null);
    const [error, setError] = useState(false);
    const [attempt, setAttempt] = useState(0);
    const [seconds, setSeconds] = useState(0);
    const [note, setNote] = useState<string | null>(null);
    const [acting, setActing] = useState<'save' | 'share' | null>(null);
    const [deleting, setDeleting] = useState(false);

    const [cancelStatus, setCancelStatus] = useState<CancelStatus | null>(null);
    const [cancelNote, setCancelNote] = useState<string | null>(null);
    const [cancelling, setCancelling] = useState(false);
    const [cancelledCredits, setCancelledCredits] = useState<number | null>(null);
    const cancelBusy = useRef(false);
    const statusVersion = useRef(0);
    const ratingAbort = useRef<AbortController | null>(null);
    const [resultReady, setResultReady] = useState(false);
    const [review, setReview] = useState<CelebrationResult | null>(null);
    const outputReady = useCallback(() => setResultReady(true), []);
    useEffect(() => {
        const signal = ratingAbort.current?.signal;
        if (!resultReady || !review || !signal || signal.aborted) return;
        return afterCelebration(review, REVIEW_ASK_DELAY_MS, signal, () => {
            if (claimReviewAsk()) routerRef.current.push('/rate');
        });
    }, [resultReady, review]);
    // Losing focus cancels only the rating continuation; polling keeps its original lifecycle.
    useRatingFocusEffect(useCallback(() => () => ratingAbort.current?.abort(), []));

    useEffect(() => {
        setError(false);
        setHeld(false); setAsset(null); setStems([]); setExpiresAt(null);
        setResultReady(false);
        setReview(null);
        setCancelStatus(null);
        const controller = new AbortController();
        const ratingController = new AbortController();
        ratingAbort.current = ratingController;
        const unsubscribe = subscribeCacheUser(() => {
            controller.abort(); ratingController.abort(); setAsset(null); setStems([]); setHeld(false); setExpiresAt(null);
            void Image.clearMemoryCache?.().catch(() => {});
        });
        const media = mediaApi(api);
        // Only a creation you waited for gets the buzz; opening a finished one from the library does not.
        let waited = false;
        waitForJob(media, id, (nextState) => {
            if (controller.signal.aborted) return;
            if (nextState === 'queued' || nextState === 'running') waited = true;
            setState(nextState);
            const version = ++statusVersion.current;
            if (nextState !== 'queued') { setCancelStatus(null); return; }
            if (cancelBusy.current) return;
            void getCancelStatus(api, id).then((status) => {
                if (!controller.signal.aborted && version === statusVersion.current) setCancelStatus(status);
            });
        }, controller.signal)
            .then(async (final) => {
                if (controller.signal.aborted) return;
                // The model lets a failed job offer "Try again" on the same model.
                const job = await media.getJob(id).catch(() => null);
                if (controller.signal.aborted) return;
                if (job) {
                    setModelId(job.model_id);
                    if (job.error_code === 'user_cancelled' && job.refunded === true) {
                        setCancelledCredits(job.credits);
                        setCancelNote(null);
                    }
                }
                if (final !== 'succeeded') return;
                const a = await media.getAsset(id);
                if (controller.signal.aborted) return;
                setAsset({ url: a.url, mime: a.mime_type });
                setExpiresAt(a.asset_expires_at ?? null);
                setStems(a.output_stems ?? []);
                const celebration = celebrateOutput(id, a.mime_type, waited);
                // Keep the original rating eligibility, and wait for the celebration to finish.
                const asked = await loadReviewAsk();
                if (controller.signal.aborted || ratingController.signal.aborted || !shouldAskForReview(asked, { waited, hasOutput: true })) return;
                setReview(celebration);
            })
            .catch(err => { if (!controller.signal.aborted) { if (err instanceof ApiError && err.code === 'held') setHeld(true); else setError(true); } });
        return () => { unsubscribe(); controller.abort(); ratingController.abort(); };
    }, [api, id, attempt]);

    const waiting = !asset && !error && (state === 'queued' || state === 'running');
    useEffect(() => {
        if (!waiting) return;
        const timer = setInterval(() => setSeconds((s) => s + 1), 1000);
        return () => clearInterval(timer);
    }, [waiting]);

    async function run(kind: 'save' | 'share') {
        if (!asset || acting) return;
        setActing(kind);
        setNote(null);
        try {
            if (kind === 'share') {
                await shareOutput(asset.url, id, asset.mime);
            } else {
                const saved = await saveOutput(asset.url, id, asset.mime);
                setNote(saved ? t('job.savedPhotos') : t('job.allowPhotos'));
            }
        } catch {
            // The link lasts 15 minutes; reopening the creation from the library fetches a new one.
            setNote(kind === 'save' ? t('job.saveFailed') : t('job.shareFailed'));
        } finally {
            setActing(null);
        }
    }

    async function doDelete() {
        setDeleting(true);
        setNote(null);
        try {
            await deleteCreation(api, id);
            router.replace('/library');
        } catch (err) {
            // Already gone is the same end state; any other refusal changed nothing and says why.
            if (isAlreadyGone(err)) router.replace('/library');
            else setNote(deleteMessage(err));
        } finally {
            setDeleting(false);
        }
    }

    function confirmDelete() {
        if (deleting) return;
        Alert.alert(CONFIRM_TITLE, CONFIRM_MESSAGE, [
            { text: t('cinema.creatorWorkspace.cancel'), style: 'cancel' },
            { text: t('job.delete'), style: 'destructive', onPress: doDelete },
        ]);
    }

    async function doCancel() {
        if (cancelBusy.current) return;
        cancelBusy.current = true;
        ++statusVersion.current;
        setCancelling(true);
        setCancelNote(null);
        try {
            await cancelJob(api, id);
            setCancelNote(t('jobCancel.done'));
            setCancelStatus(null);
            setAttempt((n) => n + 1);
        } catch (err) {
            const key = cancelErrorKey(err);
            setCancelNote(t(key));
            if (['jobCancel.started', 'jobCancel.finished', 'jobCancel.unavailable', 'jobCancel.unsure'].includes(key)) {
                setCancelStatus(null);
            }
            if (key === 'jobCancel.unsure') setAttempt((n) => n + 1);
        } finally {
            cancelBusy.current = false;
            setCancelling(false);
        }
    }

    function confirmCancel() {
        if (cancelBusy.current || !cancelStatus?.cancellable) return;
        Alert.alert(t('jobCancel.confirmTitle'), cancelStatus.credits > 0
            ? plural('jobCancel.confirmPaid', cancelStatus.credits) : t('jobCancel.confirmFree'), [
            { text: t('jobCancel.keep'), style: 'cancel' },
            { text: t('jobCancel.confirm'), style: 'destructive', onPress: doCancel },
        ]);
    }

    const canSave = !!asset && (asset.mime.startsWith('image/') || asset.mime.startsWith('video/'));

    const next = asset ? nextStepsFor(asset.mime, modelId) : { edit: false, publish: false, makeAnother: false, reuse: false };
    const reusableKind = asset ? kindForMime(asset.mime) : null;

    return (
        <View style={styles.screen}>
            <Stack.Screen options={{ title: t('job.title') }} />
            {held ? <View style={styles.center}><Text variant="title2" accessibilityRole="header">{t('library.status.held')}</Text><Text>{t('libraryCreate.heldBody')}</Text><Button label={t('label.Library')} onPress={() => router.replace('/library')} /></View> : error ? (
                <View style={styles.center}>
                    <Text variant="body" tone="danger" style={styles.error}>{t('job.checkError')}</Text>
                    <Button variant="secondary" accessibilityRole="button" onPress={() => setAttempt((n) => n + 1)} label={t('job.checkAgain')} />
                </View>
            ) : asset && stems.length > 0 ? (
                <ScrollView contentContainerStyle={styles.actionsBody}>
                    <GeneratedChip /><StemList onReady={outputReady} api={api} jobId={id} stems={stems} />
                </ScrollView>
            ) : asset ? (
                <View style={styles.output}>
                    {asset.mime.startsWith('image/') ? <Image onLoad={outputReady} source={{ uri: asset.url }} style={styles.image} contentFit="contain" cachePolicy="memory" accessibilityLabel={t('job.title')} accessibilityIgnoresInvertColors />
                        : <InlineMedia onReady={outputReady} key={asset.url} url={asset.url} audio={!asset.mime.startsWith('video/')} label={asset.mime.startsWith('video/') ? t('job.playVideo') : t('job.playAudio')} />}
                    <GeneratedChip />
                </View>
            ) : (
                <View style={styles.center}>
                    {waiting ? <ActivityIndicator color={styles.accentInk.color} /> : null}
                    <Text accessibilityLiveRegion="polite" variant="body" tone="danger" style={state === 'failed' ? styles.error : styles.status}>{cancelledCredits !== null
                        ? cancelledCredits > 0 ? plural('jobCancel.cancelled', cancelledCredits) : t('jobCancel.cancelledFree')
                        : t(LABEL[state])}</Text>
                    {cancelNote ? <Text variant="body" tone="secondary" style={styles.note} accessibilityLiveRegion="polite">{cancelNote}</Text> : null}
                    {waiting && state === 'queued' && cancelStatus?.cancellable ? (
                        <Button variant="secondary" accessibilityRole="button" accessibilityLabel={t(cancelling ? 'jobCancel.cancelling' : 'jobCancel.confirm')} accessibilityState={{ busy: cancelling, disabled: cancelling }} disabled={cancelling} onPress={confirmCancel} label={t(cancelling ? 'jobCancel.cancelling' : 'jobCancel.confirm')} />
                    ) : null}
                    {waiting ? (
                        <Text variant="body" tone="tertiary" style={styles.hint}>
                            {t('job.waiting', { elapsed: elapsed(seconds) })}
                        </Text>
                    ) : null}
                    {waiting ? (
                        <>
                            <Button variant="secondary" accessibilityRole="button" onPress={() => router.replace('/library')} label={t('job.stopWaiting')} />
                            <Text variant="body" tone="tertiary" style={styles.hint}>{t('job.keepsRunning')}</Text>
                        </>
                    ) : null}
                    {state === 'failed' && modelId ? (
                        <Button variant="secondary" accessibilityRole="button" onPress={() => router.replace({ pathname: '/create/[modelId]', params: { modelId } })} label={t('recovery.retry')} />
                    ) : null}
                </View>
            )}
            {asset && expiresAt && Number.isFinite(Date.parse(expiresAt)) ? <Text variant="caption">{Date.parse(expiresAt) <= Date.now() ? t('library.expired') : t('library.expires', { date: new Date(expiresAt).toLocaleDateString(formatLocale(), { day: 'numeric', month: 'short', year: 'numeric' }) })}</Text> : null}
            {asset && stems.length === 0 ? (
                <ScrollView style={styles.actions} contentContainerStyle={styles.actionsBody}>
                    {next.edit || next.publish || next.makeAnother || next.reuse ? (
                        <View style={styles.nextBlock}>
                            <Text variant="title3" tone="primary" style={styles.nextTitle} accessibilityRole="header">{t('job.next.title')}</Text>
                            <View style={styles.nextRow}>
                                {asset.mime.startsWith('image/') ? <Button variant="secondary" label={t('chatDepth.ask')} accessibilityLabel={t('chatDepth.ask')} onPress={() => router.push(askAboutHref(id))} /> : null}
                                {next.edit ? (
                                    <Button variant="secondary" accessibilityRole="button" onPress={() => router.push(editHref(id))} label={t('job.next.edit')} />
                                ) : null}
                                {next.publish ? (
                                    <Button variant="secondary" accessibilityRole="button" onPress={() => router.push(publishHref(id))} label={t('job.next.publish')} />
                                ) : null}
                                {next.makeAnother && modelId ? (
                                    <Button variant="secondary" accessibilityRole="button" onPress={() => router.push(makeAnotherHref(modelId))} label={t('job.next.makeAnother')} />
                                ) : null}
                                {next.reuse && reusableKind ? (
                                    <Button variant="secondary" accessibilityRole="button" onPress={() => router.push(creativeReuseHref(id, reusableKind))} label={t('job.next.reuse')} />
                                ) : null}
                            </View>
                        </View>
                    ) : null}
                    <View style={styles.row}>
                        {canSave ? (
                            <Button variant="secondary" containerStyle={styles.grow} accessibilityRole="button" disabled={!!acting} onPress={() => run('save')} label={acting === 'save' ? t('social.saving') : t('job.savePhotos')} />
                        ) : null}
                        <Button variant="secondary" containerStyle={styles.grow} accessibilityRole="button" disabled={!!acting} onPress={() => run('share')} label={acting === 'share' ? t('cinema.share.preparing') : t('cinema.share.share')} />
                    </View>
                    {note ? <Text variant="body" tone="secondary" style={styles.note} accessibilityLiveRegion="polite">{note}</Text> : null}
                    <FacelessSoundCard jobId={id} followup={followup} state={state} modelId={modelId} mime={asset?.mime} />
                    <JobProvenance api={api} jobId={id} />
                    <Link href={{ pathname: '/report', params: { kind: 'job', id } }} asChild>
                        <Button variant="tertiary" accessibilityRole="button" label={t('job.report')} />
                    </Link>
                    <Button variant="tertiary" accessibilityRole="button" disabled={deleting} onPress={confirmDelete} label={deleting ? t('job.deleting') : t('job.deleteThis')} textStyle={styles.deleteText} />
                </ScrollView>
            ) : null}
        </View>
    );
}

const sheets = themedStyles((p) => ({
    accentInk: { color: p.accent },

    screen: { flex: 1, backgroundColor: p.bg, padding: ds.space.lg, justifyContent: 'center' },
    center: { alignItems: 'center', gap: ds.space.md },
    status: { color: p.textSecondary, },
    hint: { color: p.textTertiary, textAlign: 'center' },
    error: { color: p.danger, textAlign: 'center' },
    output: { flex: 1, justifyContent: 'center' },
    image: { flex: 1, width: '100%' },
    actions: { flexGrow: 0, flexShrink: 1 },
    nextBlock: { gap: ds.space.sm },
    nextTitle: { color: p.textPrimary, },
    nextRow: { flexDirection: 'row', flexWrap: 'wrap', gap: ds.space.sm },
    actionsBody: { gap: ds.space.sm, paddingTop: ds.space.md },
    grow: { flex: 1 },
    row: { flexDirection: 'row', flexWrap: 'wrap', gap: ds.space.sm },
    note: { color: p.textSecondary, textAlign: 'center' },
    deleteText: { color: p.danger },
}));
