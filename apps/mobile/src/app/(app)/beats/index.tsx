import { BeatTemplatePicker } from '../../../components/beats/BeatTemplatePicker';
import { createTemplateBeat } from '../../../lib/beatNative/templates';
import { Stack, useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState, useSyncExternalStore } from 'react';
import { ScrollView, View } from 'react-native';
import { useAuth } from '../../../auth/AuthProvider';
import { Button, ListRow, Text, themedStyles, useThemedStyles } from '../../../components/ui';
import { EmptyState } from '../../../components/EmptyState';
import { VeyLoader } from '../../../components/VeyLoader';
import { MusicNotice } from '../../../components/music/MusicNotice';
import { beatStore, hydrateBeats, dropBeat, listBeats, subscribeBeats } from '../../../lib/beatNative/store';
import { useLocalBeatLifecycle } from '../../../lib/beatNative/useLocalBeatLifecycle';
import { userIdFromToken } from '../../../lib/appCache';
import { isRemoved } from '../../../lib/beatNative/rules';
import { probeBeats } from '../../../lib/beatNative/probe';
import { t } from '../../../lib/i18n';
import { useAnnouncement } from '../../../lib/useAnnouncement';
import { ds } from '../../../theme';

type State = 'checking' | 'on' | 'off' | 'offline' | 'error' | 'signed_out';

// Local beats remain available regardless of the account route’s availability.
export default function BeatsHome() {
    const { api, getAccessToken, generation } = useAuth(); const router = useRouter(); const s = useThemedStyles(sheets);
    const beats = useSyncExternalStore(subscribeBeats, listBeats, listBeats);
    const [account, setAccount] = useState<{ generation: number; userId: string | null } | null>(null);
    const userId = account?.generation === generation ? account.userId : null;
    const linked = (id: string) => {
        const link = beatStore.getRecord(id)?.cloud;
        return !!(userId && link?.projectId && !isRemoved(link) && link.userId === userId);
    };
    const [state, setState] = useState<State>('checking');
    useLocalBeatLifecycle();
    useFocusEffect(useCallback(() => {
        let live = true;
        void (async () => {
            const token = await getAccessToken?.().catch(() => null);
            if (!live) return;
            const id = token ? userIdFromToken(token) : null;
            setAccount({ generation, userId: id });
            if (!id) { setState('signed_out'); return; }
            const result = await probeBeats(api);
            if (live) setState(result.state);
        })();
        return () => { live = false; };
    }, [api, getAccessToken, generation]));
    useAnnouncement(state !== 'checking' && state !== 'off' ? t('beat.home.loaded', { count: beats.length }) : null, { everywhere: true });
    const open = (id: string) => router.push({ pathname: '/beats/[id]', params: { id } } as never);
    const [picker, setPicker] = useState(false), [creationFailed, setCreationFailed] = useState(false);
    return (
        <ScrollView style={s.screen} contentContainerStyle={s.content}>
            <Stack.Screen options={{ title: t('beat.title') }} />
            {picker ? <BeatTemplatePicker onClose={() => setPicker(false)} onPick={async template => {
                setCreationFailed(false);
                try {
                    const doc = await createTemplateBeat(beatStore, template, t('beat.home.untitled', { n: beats.length + 1 }));
                    setPicker(false); open(doc.id);
                } catch { setPicker(false); setCreationFailed(true); }
            }} /> : null}
            {creationFailed ? <MusicNotice message={t('beatLabs.createFailed')} /> : null}
            {state === 'checking' ? <VeyLoader label={t('beat.home.checking')} showLabel /> : null}
            {state === 'signed_out' ? <MusicNotice message={t('beat.cloud.signed_out')} /> : null}
            {state === 'off' ? <MusicNotice message={t('beat.cloud.off')} /> : null}
            {state === 'error' ? <><MusicNotice message={t('beat.cloud.error')} /><Button label={t('beat.retry')} onPress={() => void probeBeats(api).then(result => setState(result.state))} /></> : null}
            {beatStore.hydrationState() === 'error' ? <><MusicNotice message={t('beat.local.loadError')} /><Button label={t('beat.retry')} onPress={() => void hydrateBeats().catch(() => undefined)} /></> : null}
                {state === 'offline' ? <MusicNotice message={t('beat.offline')} /> : null}
                <Button label={t('beat.home.new')} onPress={() => setPicker(true)} />
                {beats.length === 0 ? <EmptyState title={t('beat.home.empty')} body={t('beat.home.emptyBody')} /> : beats.map(beat => (
                    <View key={beat.id} style={s.row}>
                        <View style={s.grow}>
                            <ListRow title={beat.title} subtitle={t('beat.tempoValue', { bpm: beat.tempo.bpm })} accessibilityLabel={t('beat.home.openNamed', { title: beat.title })} onPress={() => open(beat.id)} />
                        </View>
                        {state === 'on' && linked(beat.id) ? <Text variant="caption">{t('beat.cloud.linked')}</Text> : null}
                        <Button size="sm" variant="tertiary" label={t('beat.home.delete', { title: beat.title })} iconOnly icon="close" onPress={() => dropBeat(beat.id)} />
                    </View>
                ))}
        </ScrollView>
    );
}
const sheets = themedStyles(p => ({
    screen: { flex: 1, backgroundColor: p.bg },
    content: { padding: ds.space.gutter, gap: ds.space.lg },
    row: { flexDirection: 'row', alignItems: 'center', gap: ds.space.sm },
    grow: { flex: 1 },
}));
