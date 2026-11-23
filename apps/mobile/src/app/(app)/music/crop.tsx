import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { Stack, useLocalSearchParams } from 'expo-router';
import { Alert } from 'react-native';
import { useAuth } from '../../../auth/AuthProvider';
import { Button, Text, TextField, themedStyles, useThemedStyles } from '../../../components/ui';
import { MusicNotice } from '../../../components/music/MusicNotice';
import { MusicPlayer } from '../../../components/music/MusicPlayer';
import { getCacheUser, subscribeCacheUser } from '../../../lib/appCache';
import { createCropAction, cropRangeError, normalizeSeconds } from '../../../lib/music/cropAction';
import { songPlayback } from '../../../lib/music/player';
import { actionMessage } from '../../../lib/music/actionMessages';
import { t, rawText } from '../../../lib/i18n';
import { ds } from '../../../theme';
import { SafeKeyboardFormScrollView } from '../../../components/SafeContentScrollView';
export default function Crop() {
    const { id } = useLocalSearchParams<{ id: string }>(); const { api } = useAuth();
    const user = useSyncExternalStore(subscribeCacheUser, getCacheUser, getCacheUser);
    // A disposed flow never revives, so every effect cleanup asks for a fresh one (StrictMode, Fast Refresh).
    const [generation, setGeneration] = useState(0);
    const flow = useMemo(() => createCropAction(api, id), [api, id, user, generation]);
    const state = useSyncExternalStore(flow.subscribe, flow.snapshot, flow.snapshot); const s = useThemedStyles(sheets);
    useEffect(() => { if (!flow.isLive()) { setGeneration(g => g + 1); return; } if (user) void flow.load(); return flow.dispose; }, [flow, user]);
    const version = state.song?.version_id;
    const duration = useCallback((seconds: number) => { if (version) flow.setDuration(seconds, version); }, [flow, version]);
    // The server crops the underlying recording in absolute seconds, so even a preview-only version is
    // played unbounded here: the heard timeline, the measured duration and the entered range stay one timeline.
    const playback = useMemo(() => {
        try { if (!state.song) return null; const { songId, jobId } = songPlayback(state.song); return { songId, jobId, start: 0 }; } catch { return null; }
    }, [state.song]);
    const invalid = cropRangeError(state.start, state.end, state.duration);
    function confirm() {
        Alert.alert(rawText(t('musicActions.crop.save')), rawText(t('musicActions.crop.confirm', { start: normalizeSeconds(state.start), end: normalizeSeconds(state.end) })), [
            { text: rawText(t('music.cancel')), style: 'cancel' },
            { text: rawText(t('musicActions.crop.save')), onPress: () => void flow.confirm() },
        ]);
    }
    return <SafeKeyboardFormScrollView style={s.screen} contentContainerStyle={s.content} gutter={ds.space.lg}>
        <Stack.Screen options={{ title: t('musicActions.crop.title') }} />
        <Text variant="title1" accessibilityRole="header">{t('musicActions.crop.title')}</Text>
        {state.status === 'off' ? <MusicNotice message={t('music.off')} />
            : state.status === 'loading' ? <Text>{t('music.loading')}</Text>
                : state.status === 'error' ? <MusicNotice message={t('music.loadError')} retry={() => void flow.load()} /> : <>
                    <Text>{state.song?.title}</Text><Text>{t('musicActions.crop.body')}</Text>
                    {playback ? <MusicPlayer key={version} input={playback} onDuration={duration} /> : null}
                    <Text>{state.duration === null ? t('musicActions.crop.unknown') : t('musicActions.crop.duration', { seconds: state.duration })}</Text>
                    <Text>{t('musicActions.crop.precision')}</Text>
                    <TextField label={t('musicActions.crop.start')} keyboardType="decimal-pad" value={state.start} editable={!state.busy}
                        onChangeText={start => flow.edit({ start })} />
                    <TextField label={t('musicActions.crop.end')} keyboardType="decimal-pad" value={state.end} editable={!state.busy}
                        onChangeText={end => flow.edit({ end })} />
                    {state.start && state.end && invalid ? <MusicNotice message={actionMessage(invalid)} /> : null}
                    {state.ambiguous ? <MusicNotice message={t('musicActions.crop.recovery')} /> : null}
                    {state.error ? <MusicNotice message={actionMessage(state.error)} /> : null}
                    {state.result ? <><MusicNotice message={t('musicActions.crop.saved', { number: state.result.version_number })} />
                        {state.result.render_state === 'preview_only' ? <Text>{t('musicActions.crop.preview')}</Text> : null}</> : null}
                    <Button label={t('musicActions.crop.save')} disabled={state.busy || !!state.result || (!state.ambiguous && !!invalid)} onPress={confirm} />
                    {['revision_conflict', 'source_changed'].includes(state.error ?? '') || (state.result && state.error)
                        ? <Button label={t('musicActions.action.reload')} disabled={state.busy} onPress={() => void flow.load()} /> : null}
                </>}
    </SafeKeyboardFormScrollView>;
}
const sheets = themedStyles(p => ({ screen: { flex: 1, backgroundColor: p.bg }, content: { gap: ds.space.md } }));
