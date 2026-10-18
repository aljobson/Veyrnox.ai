import { Image } from 'expo-image';
import * as WebBrowser from 'expo-web-browser';
import { Link, Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useAuth } from '../../../auth/AuthProvider';
import { CONFIRM_MESSAGE, CONFIRM_TITLE, deleteCreation, deleteMessage, isAlreadyGone } from '../../../lib/deleteCreation';
import { mediaApi, waitForJob, type JobState } from '../../../lib/media';
import { saveOutput, shareOutput } from '../../../lib/output';
import { colors } from '../../../theme';

const LABEL: Record<JobState, string> = {
    queued: 'In the queue…',
    running: 'Creating…',
    succeeded: 'Done',
    failed: 'This did not finish. Your credits were refunded.',
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
                setNote(saved ? 'Saved to your photos.' : 'Allow adding to Photos in Settings to save.');
            }
        } catch {
            // The link lasts 15 minutes; reopening the creation from the library fetches a new one.
            setNote(kind === 'save' ? 'Could not save. Try again.' : 'Could not share. Try again.');
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
            { text: 'Cancel', style: 'cancel' },
            { text: 'Delete', style: 'destructive', onPress: doDelete },
        ]);
    }

    const canSave = !!asset && (asset.mime.startsWith('image/') || asset.mime.startsWith('video/'));

    return (
        <View style={styles.screen}>
            <Stack.Screen options={{ title: 'Your creation' }} />
            {error ? (
                <View style={styles.center}>
                    <Text style={styles.error}>Could not check this job. It is safe to leave; it will appear in your library.</Text>
                    <Pressable accessibilityRole="button" style={styles.secondary} onPress={() => setAttempt((n) => n + 1)}>
                        <Text style={styles.secondaryText}>Check again</Text>
                    </Pressable>
                </View>
            ) : asset ? (
                asset.mime.startsWith('image/') ? (
                    <Image source={{ uri: asset.url }} style={styles.image} contentFit="contain" />
                ) : (
                    <Pressable accessibilityRole="button" style={styles.button} onPress={() => WebBrowser.openBrowserAsync(asset.url)}>
                        <Text style={styles.buttonText}>{asset.mime.startsWith('video/') ? 'Play video' : 'Play audio'}</Text>
                    </Pressable>
                )
            ) : (
                <View style={styles.center}>
                    {waiting ? <ActivityIndicator color={colors.accent} /> : null}
                    <Text style={state === 'failed' ? styles.error : styles.status}>{LABEL[state]}</Text>
                    {waiting ? (
                        <Text style={styles.hint}>
                            {elapsed(seconds)} so far. You can leave this screen; it will appear in your library when it is done.
                        </Text>
                    ) : null}
                    {waiting ? (
                        <>
                            <Pressable accessibilityRole="button" style={styles.secondary} onPress={() => router.replace('/library')}>
                                <Text style={styles.secondaryText}>Stop waiting</Text>
                            </Pressable>
                            <Text style={styles.hint}>Your creation keeps running and will appear in your Library. Credits are not refunded.</Text>
                        </>
                    ) : null}
                    {state === 'failed' && modelId ? (
                        <Pressable accessibilityRole="button" style={styles.secondary} onPress={() => router.replace({ pathname: '/create/[modelId]', params: { modelId } })}>
                            <Text style={styles.secondaryText}>Try again</Text>
                        </Pressable>
                    ) : null}
                </View>
            )}
            {asset ? (
                <ScrollView style={styles.actions} contentContainerStyle={styles.actionsBody} scrollEnabled={false}>
                    <View style={styles.row}>
                        {canSave ? (
                            <Pressable accessibilityRole="button" disabled={!!acting} style={[styles.action, !!acting && styles.off]} onPress={() => run('save')}>
                                <Text style={styles.actionText}>{acting === 'save' ? 'Saving…' : 'Save to photos'}</Text>
                            </Pressable>
                        ) : null}
                        <Pressable accessibilityRole="button" disabled={!!acting} style={[styles.action, !!acting && styles.off]} onPress={() => run('share')}>
                            <Text style={styles.actionText}>{acting === 'share' ? 'Preparing…' : 'Share'}</Text>
                        </Pressable>
                    </View>
                    {note ? <Text style={styles.note}>{note}</Text> : null}
                    <Link href={{ pathname: '/report', params: { kind: 'job', id } }} asChild>
                        <Pressable accessibilityRole="button" style={styles.report}>
                            <Text style={styles.reportText}>Report this creation</Text>
                        </Pressable>
                    </Link>
                    <Pressable accessibilityRole="button" disabled={deleting} style={[styles.delete, deleting && styles.off]} onPress={confirmDelete}>
                        <Text style={styles.deleteText}>{deleting ? 'Deleting…' : 'Delete this creation'}</Text>
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
    actions: { flexGrow: 0 },
    actionsBody: { gap: 10, paddingTop: 12 },
    row: { flexDirection: 'row', gap: 10 },
    action: { flex: 1, backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
    actionText: { color: colors.text, fontWeight: '600' },
    off: { opacity: 0.4 },
    note: { color: colors.body, textAlign: 'center' },
    report: { paddingVertical: 10, alignItems: 'center' },
    reportText: { color: colors.muted },
    delete: { paddingVertical: 10, alignItems: 'center' },
    deleteText: { color: colors.danger },
});
