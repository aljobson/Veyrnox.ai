import { MusicPublication } from '../../../components/music/MusicPublication';
import { MusicSongActions } from '../../../components/music/MusicSongActions';
import { subscribeSongChanges } from '../../../lib/music/songChanges';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, View } from 'react-native';
import { useAuth } from '../../../auth/AuthProvider';
import { Button, Text, themedStyles, useThemedStyles } from '../../../components/ui';
import { EmptyState } from '../../../components/EmptyState';
import { VeyLoader } from '../../../components/VeyLoader';
import { MusicNotice } from '../../../components/music/MusicNotice';
import { MusicPlayer } from '../../../components/music/MusicPlayer';
import { MusicShares } from '../../../components/music/MusicShares';
import { getSong } from '../../../lib/music/client';
import { probeMusic, type MusicProbe } from '../../../lib/music/probe';
import { changeLifecycle, findLifecycle, routeRevision, type LifecycleState } from '../../../lib/music/lifecycle';
import { songPlayback } from '../../../lib/music/player';
import type { MusicSongDetail } from '../../../lib/music/types';
import { t, rawText } from '../../../lib/i18n';
import { ds } from '../../../theme';
import { SafeContentScrollView } from '../../../components/SafeContentScrollView';
import { usePersistentAudioQueue } from '../../../components/music/PersistentAudioQueue';

export default function SongDetail() {
    const { id, revision } = useLocalSearchParams<{ id: string; revision?: string }>();
    const { api } = useAuth(); const s = useThemedStyles(sheets); const router = useRouter();
    const queue = usePersistentAudioQueue();
    const [result, setResult] = useState<MusicProbe<MusicSongDetail> | null>(null);
    const [previous, setPrevious] = useState<MusicSongDetail | null>(null);
    const [lifecycle, setLifecycle] = useState<LifecycleState | null>(() => routeRevision(revision));
    const [busy, setBusy] = useState(false); const lock = useRef(false);
    const [message, setMessage] = useState(''); const live = useRef(true); const generation = useRef(0);
    const load = useCallback(async () => {
        const ticket = ++generation.current;
        const value = await probeMusic(() => getSong(api, id));
        if (live.current && ticket === generation.current) { setResult(value); if (value.state === 'on') setPrevious(value.data); else if (value.state === 'off') setPrevious(null); }
    }, [api, id]);
    useEffect(() => {
        let current = true;
        live.current = true; setResult(null); setPrevious(null); setMessage('');
        const supplied = routeRevision(revision); setLifecycle(supplied);
        void load();
        if (!supplied) void probeMusic(() => findLifecycle(api, id)).then(r => { if (current && r.state === 'on') setLifecycle(r.data); });
        return () => { current = false; live.current = false; generation.current++; };
    }, [load, api, id, revision]);
    useEffect(() => subscribeSongChanges(() => { void load(); }), [load]);
    async function mutate(action: 'trash' | 'restore') {
        if (!lifecycle || lock.current) return;
        lock.current = true; setBusy(true); setMessage('');
        const outcome = await probeMusic(() => changeLifecycle(api, id, lifecycle, action));
        if (live.current) {
            if (outcome.state === 'on') {
                const next = outcome.data;
                if (next.state === 'saved') {
                    setLifecycle(next.value); setMessage(t(action === 'trash' ? 'music.trashed' : 'music.restored'));
                    // Trashed detail reads 404. Restore uses the retained PATCH revision; only then reload detail.
                    if (action === 'restore') await load();
                } else if (next.state === 'conflict') {
                    setLifecycle(next.value); setMessage(t(next.value ? 'music.conflict' : 'music.conflictMissing'));
                } else { setLifecycle(null); setMessage(t('music.trashOff')); }
            } else setMessage(t(outcome.state === 'error' && outcome.status === 0 ? 'music.offline' : 'music.writeError'));
            setBusy(false);
        }
        lock.current = false;
    }
    const song = result?.state === 'on' ? result.data : previous;
    const trashed = lifecycle?.lifecycle_status === 'trashed' || song?.lifecycle_status === 'trashed';
    const playback = useMemo(() => {
        if (!song || trashed) return null;
        try { return songPlayback(song); } catch { return null; }
    }, [song, trashed]);
    return <SafeContentScrollView style={s.screen} contentContainerStyle={s.content} gutter={ds.space.lg}>
        <Stack.Screen options={{ title: song?.title ?? t('music.title') }} />
        {!result ? <VeyLoader label={t('music.loading')} showLabel /> : null}
        {result?.state === 'off' ? <EmptyState title={t('music.off')} body={t('music.offBody')} actionLabel={t('music.back')} href="/music" /> : null}
        {result?.state === 'error' && !trashed ? <MusicNotice message={t(result.status === 0 ? 'music.offline' : result.code === 'not_found' ? 'music.missing' : 'music.loadError')} retry={() => void load()} /> : null}
        {message ? <MusicNotice message={message} /> : null}
        {busy ? <VeyLoader label={t('music.saving')} showLabel /> : null}
        {trashed ? <View style={s.group}>
            <Text variant="callout">{t('music.trashBanner')}</Text>
            {lifecycle ? <Button label={t('music.restore')} disabled={busy} onPress={() => void mutate('restore')} /> : null}
        </View> : song ? <>
            {!busy && playback ? <MusicPlayer input={playback} /> : !busy ? <MusicNotice message={t('music.player.error')} /> : null}
            {playback && queue?.ownedEnabled ? <Button variant="secondary" label={t('music.queue.add')}
                onPress={() => queue.addOwned({ jobId: song.job_id, songId: song.id, title: song.title, source: 'music' })} /> : null}
            <MusicSongActions song={song} />
            <Button variant="secondary" label={t('beatLabs.makeBeat')} onPress={() => router.push({ pathname: '/beats/new', params: { song: song.id } } as never)} />
            <MusicPublication song={song} />
            <Text variant="title3" accessibilityRole="header">{t('music.versions')}</Text>
            <Text variant="footnote" tone="secondary">{t('music.versionsBody')}</Text>
            {song.versions.map(v => <View key={v.id} style={s.group}>
                <Text variant="bodyStrong">{t(v.is_current ? 'music.currentVersion' : 'music.version', { number: v.version_number })}</Text>
                <Text variant="footnote" tone="secondary">{v.created_at}</Text>
            </View>)}
            {song.actions.includes('share_link') ? <MusicShares key={song.id} song={song} /> : null}
            {lifecycle ? <Button variant="tertiary" tone="danger" label={t('music.trash')} disabled={busy}
                onPress={() => Alert.alert(rawText(t('music.trash')), rawText(t('music.trashConfirm')), [
                    { text: rawText(t('music.cancel')), style: 'cancel' }, { text: rawText(t('music.trash')), style: 'destructive', onPress: () => void mutate('trash') },
                ])} /> : null}
        </> : null}
    </SafeContentScrollView>;
}
const sheets = themedStyles(p => ({ screen: { flex: 1, backgroundColor: p.bg }, content: { gap: ds.space.lg }, group: { gap: ds.space.sm } }));
