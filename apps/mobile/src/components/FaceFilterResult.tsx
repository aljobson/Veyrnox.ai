import { Image } from 'expo-image';
import { Stack, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { ApiError, type ApiClient } from '../lib/api';
import { getCacheUser, subscribeCacheUser } from '../lib/appCache';
import { comparisonUri, faceFilterMessage } from '../lib/faceFilters';
import { mediaApi, waitForJob, type JobState } from '../lib/media';
import { saveOutput, shareOutput } from '../lib/output';
import { t } from '../lib/i18n';
import { colors } from '../theme';

export function FaceFilterResult({ api, owner, id, original, onAnother }: { api: ApiClient; owner: string; id: string; original: string; onAnother: () => void }) {
    const router = useRouter();
    const [state, setState] = useState<JobState>('queued');
    const [asset, setAsset] = useState<{ url: string; mime_type: string } | null>(null);
    const [view, setView] = useState<'before' | 'after'>('after');
    const [error, setError] = useState<string | null>(null);
    const [attempt, setAttempt] = useState(0);
    const [settled, setSettled] = useState(false);
    const [acting, setActing] = useState(false);
    const [note, setNote] = useState<string | null>(null);
    const working = useRef(false);
    const live = useRef(true);
    useEffect(() => {
        live.current = true;
        const off = subscribeCacheUser(() => { if (getCacheUser() !== owner) live.current = false; });
        return () => { live.current = false; off(); };
    }, [owner]);
    useEffect(() => {
        const controller = new AbortController();
        const media = mediaApi(api);
        const current = () => !controller.signal.aborted && live.current && getCacheUser() === owner;
        const off = subscribeCacheUser(() => { if (getCacheUser() !== owner) controller.abort(); });
        setError(null); setSettled(false);
        waitForJob(media, id, next => { if (current()) setState(next); }, controller.signal)
            .then(async final => {
                if (!current()) return;
                if (final === 'succeeded') {
                    const result = await media.getAsset(id);
                    if (current()) setAsset(result);
                } else if (final === 'failed') {
                    const failed = await media.getJob(id);
                    if (current()) setError(failed.error_code ? `${faceFilterMessage(new ApiError(422, failed.error_code))} ${t('job.failed')}` : t('job.failed'));
                }
            })
            .catch(() => { if (current()) setError(t('job.checkError')); })
            .finally(() => { if (current()) setSettled(true); });
        return () => { off(); controller.abort(); };
    }, [api, owner, id, attempt]);
    async function output(kind: 'save' | 'share') {
        if (!asset || working.current || !live.current || getCacheUser() !== owner) return;
        working.current = true; setActing(true); setNote(null);
        try {
            // Refresh the short-lived result link before either export.
            const fresh = await mediaApi(api).getAsset(id);
            if (!live.current || getCacheUser() !== owner) return;
            if (kind === 'share') await shareOutput(fresh.url, id, fresh.mime_type);
            else {
                const saved = await saveOutput(fresh.url, id, fresh.mime_type);
                if (live.current) setNote(t(saved ? 'job.savedPhotos' : 'job.allowPhotos'));
            }
        } catch { if (live.current) setNote(t(kind === 'share' ? 'job.shareFailed' : 'job.saveFailed')); }
        finally { working.current = false; if (live.current) setActing(false); }
    }
    return <ScrollView style={styles.screen} contentContainerStyle={styles.body}>
        <Stack.Screen options={{ title: t('faceFilters.title') }} />
        <Text style={styles.heading} accessibilityRole="header">{t(`job.${state}`)}</Text>
        {!settled && !asset ? <ActivityIndicator /> : null}
        {asset ? <>
            <View style={styles.toggle}>{(['before', 'after'] as const).map(choice => <Pressable key={choice} accessibilityRole="button" accessibilityLabel={t(`faceFilters.${choice}`)} accessibilityState={{ selected: view === choice }} style={[styles.button, view === choice && styles.selected]} onPress={() => setView(choice)}><Text style={styles.text}>{t(`faceFilters.${choice}`)}</Text></Pressable>)}</View>
            <Image source={{ uri: comparisonUri(view, original, asset.url) }} accessibilityLabel={t(`faceFilters.${view}`)} cachePolicy="none" transition={0} contentFit="contain" style={styles.photo} />
            <Text style={styles.text}>{t('faceFilters.saved')}</Text>
            <Pressable accessibilityRole="button" accessibilityLabel={t('faceFilters.openLibrary')} style={styles.button} onPress={() => router.push('/library')}><Text style={styles.text}>{t('faceFilters.openLibrary')}</Text></Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel={t('job.savePhotos')} accessibilityState={{ disabled: acting }} disabled={acting} style={styles.button} onPress={() => output('save')}><Text style={styles.text}>{t('job.savePhotos')}</Text></Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel={t('cinema.share.share')} accessibilityState={{ disabled: acting }} disabled={acting} style={styles.button} onPress={() => output('share')}><Text style={styles.text}>{t('cinema.share.share')}</Text></Pressable>
        </> : <>
            <Text style={styles.text}>{t('job.keepsRunning')}</Text>
            {settled && state !== 'failed' ? <Pressable accessibilityRole="button" accessibilityLabel={t('job.checkAgain')} style={styles.button} onPress={() => setAttempt(n => n + 1)}><Text style={styles.text}>{t('job.checkAgain')}</Text></Pressable> : null}
        </>}
        {error ? <Text style={styles.error} accessibilityLiveRegion="polite">{error}</Text> : null}
        {note ? <Text style={styles.text} accessibilityLiveRegion="polite">{note}</Text> : null}
        <Pressable accessibilityRole="button" accessibilityLabel={t('faceFilters.another')} disabled={acting} style={styles.button} onPress={onAnother}><Text style={styles.text}>{t('faceFilters.another')}</Text></Pressable>
    </ScrollView>;
}
const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background }, body: { padding: 16, gap: 14, paddingBottom: 100 },
    heading: { color: colors.text, fontSize: 20, fontWeight: '700' }, text: { color: colors.text, fontSize: 16 },
    photo: { width: '100%', height: 360 }, toggle: { flexDirection: 'row', gap: 12 },
    button: { minHeight: 44, padding: 14, borderRadius: 12, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
    selected: { borderColor: colors.accent }, error: { color: colors.danger },
});
