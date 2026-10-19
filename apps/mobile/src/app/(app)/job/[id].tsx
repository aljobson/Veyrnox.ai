import { Image } from 'expo-image';
import * as WebBrowser from 'expo-web-browser';
import { Link, Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useAuth } from '../../../auth/AuthProvider';
import { CONFIRM_MESSAGE, CONFIRM_TITLE, deleteCreation, deleteMessage, isAlreadyGone } from '../../../lib/deleteCreation';
import { mediaApi, waitForJob, type JobState } from '../../../lib/media';
import { editHref, makeAnotherHref, nextStepsFor, publishHref } from '../../../lib/nextSteps';
import { saveOutput, shareOutput } from '../../../lib/output';
import { colors } from '../../../theme';
import { t } from '../../../lib/i18n';

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
    const { id } = useLocalSearchParams<{ id: string }>();
    const { api } = useAuth();
    const router = useRouter();
    const [state, setState] = useState<JobState>('queued');
    const [asset, setAsset] = useState<{ url: string; mime: string } | null>(null);
    const [modelId, setModelId] = useState<string | null>(null);
    const [error, setError] = useState(false);
    const [attempt, setAttempt] = useState(0);
    const [seconds, setSeconds] = useState(0);
    const [note, setNote] = useState<string | null>(null);
    const [acting, setActing] = useState<'save' | 'share' | null>(null);
    const [deleting, setDeleting] = useState(false);

    useEffect(() => {
        setError(false);
        const controller = new AbortController();
        const media = mediaApi(api);
        waitForJob(media, id, setState, controller.signal)
            .then(async (final) => {
                if (controller.signal.aborted) return;
                // The model lets a failed job offer "Try again" on the same model.
                const job = await media.getJob(id).catch(() => null);
                if (job) setModelId(job.model_id);
                if (final !== 'succeeded') return;
                const a = await media.getAsset(id);
                setAsset({ url: a.url, mime: a.mime_type });
            })
            .catch(() => !controller.signal.aborted && setError(true));
        return () => controller.abort();
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

    const canSave = !!asset && (asset.mime.startsWith('image/') || asset.mime.startsWith('video/'));

    const next = asset ? nextStepsFor(asset.mime, modelId) : { edit: false, publish: false, makeAnother: false };

    return (
        <View style={styles.screen}>
            <Stack.Screen options={{ title: t('job.title') }} />
            {error ? (
                <View style={styles.center}>
                    <Text style={styles.error}>{t('job.checkError')}</Text>
                    <Pressable accessibilityRole="button" style={styles.secondary} onPress={() => setAttempt((n) => n + 1)}>
                        <Text style={styles.secondaryText}>{t('job.checkAgain')}</Text>
                    </Pressable>
                </View>
            ) : asset ? (
                asset.mime.startsWith('image/') ? (
                    <Image source={{ uri: asset.url }} style={styles.image} contentFit="contain" accessibilityLabel={t('job.title')} accessibilityIgnoresInvertColors />
                ) : (
                    <Pressable accessibilityRole="button" style={styles.button} onPress={() => WebBrowser.openBrowserAsync(asset.url)}>
                        <Text style={styles.buttonText}>{asset.mime.startsWith('video/') ? t('job.playVideo') : t('job.playAudio')}</Text>
                    </Pressable>
                )
            ) : (
                <View style={styles.center}>
                    {waiting ? <ActivityIndicator color={colors.accent} /> : null}
                    <Text style={state === 'failed' ? styles.error : styles.status}>{t(LABEL[state])}</Text>
                    {waiting ? (
                        <Text style={styles.hint}>
                            {t('job.waiting', { elapsed: elapsed(seconds) })}
                        </Text>
                    ) : null}
                    {waiting ? (
                        <>
                            <Pressable accessibilityRole="button" style={styles.secondary} onPress={() => router.replace('/library')}>
                                <Text style={styles.secondaryText}>{t('job.stopWaiting')}</Text>
                            </Pressable>
                            <Text style={styles.hint}>{t('job.keepsRunning')}</Text>
                        </>
                    ) : null}
                    {state === 'failed' && modelId ? (
                        <Pressable accessibilityRole="button" style={styles.secondary} onPress={() => router.replace({ pathname: '/create/[modelId]', params: { modelId } })}>
                            <Text style={styles.secondaryText}>{t('recovery.retry')}</Text>
                        </Pressable>
                    ) : null}
                </View>
            )}
            {asset ? (
                <ScrollView style={styles.actions} contentContainerStyle={styles.actionsBody}>
                    {next.edit || next.publish || next.makeAnother ? (
                        <View style={styles.nextBlock}>
                            <Text style={styles.nextTitle} accessibilityRole="header">{t('job.next.title')}</Text>
                            <View style={styles.nextRow}>
                                {next.edit ? (
                                    <Pressable accessibilityRole="button" style={styles.nextButton} onPress={() => router.push(editHref(id))}>
                                        <Text style={styles.nextText}>{t('job.next.edit')}</Text>
                                    </Pressable>
                                ) : null}
                                {next.publish ? (
                                    <Pressable accessibilityRole="button" style={styles.nextButton} onPress={() => router.push(publishHref(id))}>
                                        <Text style={styles.nextText}>{t('job.next.publish')}</Text>
                                    </Pressable>
                                ) : null}
                                {next.makeAnother && modelId ? (
                                    <Pressable accessibilityRole="button" style={styles.nextButton} onPress={() => router.push(makeAnotherHref(modelId))}>
                                        <Text style={styles.nextText}>{t('job.next.makeAnother')}</Text>
                                    </Pressable>
                                ) : null}
                            </View>
                        </View>
                    ) : null}
                    <View style={styles.row}>
                        {canSave ? (
                            <Pressable accessibilityRole="button" disabled={!!acting} style={[styles.action, !!acting && styles.off]} onPress={() => run('save')}>
                                <Text style={styles.actionText}>{acting === 'save' ? t('social.saving') : t('job.savePhotos')}</Text>
                            </Pressable>
                        ) : null}
                        <Pressable accessibilityRole="button" disabled={!!acting} style={[styles.action, !!acting && styles.off]} onPress={() => run('share')}>
                            <Text style={styles.actionText}>{acting === 'share' ? t('cinema.share.preparing') : t('cinema.share.share')}</Text>
                        </Pressable>
                    </View>
                    {note ? <Text style={styles.note} accessibilityLiveRegion="polite">{note}</Text> : null}
                    <Link href={{ pathname: '/report', params: { kind: 'job', id } }} asChild>
                        <Pressable accessibilityRole="button" style={styles.report}>
                            <Text style={styles.reportText}>{t('job.report')}</Text>
                        </Pressable>
                    </Link>
                    <Pressable accessibilityRole="button" disabled={deleting} style={[styles.delete, deleting && styles.off]} onPress={confirmDelete}>
                        <Text style={styles.deleteText}>{deleting ? t('job.deleting') : t('job.deleteThis')}</Text>
                    </Pressable>
                </ScrollView>
            ) : null}
        </View>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background, padding: 16, justifyContent: 'center' },
    center: { alignItems: 'center', gap: 12 },
    status: { color: colors.body, fontSize: 16 },
    hint: { color: colors.muted, textAlign: 'center' },
    error: { color: colors.danger, textAlign: 'center' },
    image: { flex: 1, width: '100%' },
    button: { backgroundColor: colors.accent, borderRadius: 12, paddingVertical: 16, alignItems: 'center' },
    buttonText: { color: colors.accentInk, fontWeight: '700', fontSize: 16 },
    secondary: { borderColor: colors.border, borderWidth: 1, borderRadius: 12, paddingVertical: 12, paddingHorizontal: 22 },
    secondaryText: { color: colors.text, fontWeight: '600' },
    actions: { flexGrow: 0, flexShrink: 1 },
    nextBlock: { gap: 8 },
    nextTitle: { color: colors.text, fontSize: 16, fontWeight: '700' },
    nextRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
    nextButton: { flexGrow: 1, minHeight: 44, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.accent, borderRadius: 12, paddingVertical: 12, paddingHorizontal: 16 },
    nextText: { color: colors.accentInk, fontWeight: '700' },
    actionsBody: { gap: 10, paddingTop: 12 },
    row: { flexDirection: 'row', gap: 10 },
    action: { flex: 1, backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
    actionText: { color: colors.text, fontWeight: '600' },
    off: { opacity: 0.4 },
    note: { color: colors.body, textAlign: 'center' },
    report: { minHeight: 44, justifyContent: 'center', paddingVertical: 10, alignItems: 'center' },
    reportText: { color: colors.muted },
    delete: { minHeight: 44, justifyContent: 'center', paddingVertical: 10, alignItems: 'center' },
    deleteText: { color: colors.danger },
});
