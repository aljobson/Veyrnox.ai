import { Stack, useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState, useSyncExternalStore } from 'react';
import { ScrollView, View } from 'react-native';
import { useAuth } from '../../../auth/AuthProvider';
import { Button, ListRow, Text, themedStyles, useThemedStyles } from '../../../components/ui';
import { EmptyState } from '../../../components/EmptyState';
import { VeyLoader } from '../../../components/VeyLoader';
import { MusicNotice } from '../../../components/music/MusicNotice';
import { dropBeat, listBeats, newBeat, subscribeBeats } from '../../../lib/beatNative/store';
import { probeBeats } from '../../../lib/beatNative/probe';
import { t } from '../../../lib/i18n';
import { useAnnouncement } from '../../../lib/useAnnouncement';
import { ds } from '../../../theme';

type State = 'checking' | 'on' | 'off' | 'offline';

// Beats home: new beat, the beats open in this session, open one. Availability is probed by calling the beat route.
export default function BeatsHome() {
    const { api } = useAuth(); const router = useRouter(); const s = useThemedStyles(sheets);
    const beats = useSyncExternalStore(subscribeBeats, listBeats, listBeats);
    const [state, setState] = useState<State>('checking');
    useFocusEffect(useCallback(() => {
        let live = true;
        void probeBeats(api).then(r => { if (live) setState(r.state === 'off' ? 'off' : r.state === 'error' && r.status === 0 ? 'offline' : 'on'); });
        return () => { live = false; };
    }, [api]));
    useAnnouncement(state !== 'checking' && state !== 'off' ? t('beat.home.loaded', { count: beats.length }) : null, { everywhere: true });
    const open = (id: string) => router.push({ pathname: '/beats/[id]', params: { id } } as never);
    const create = () => open(newBeat(t('beat.home.untitled', { n: beats.length + 1 })).id);
    return (
        <ScrollView style={s.screen} contentContainerStyle={s.content}>
            <Stack.Screen options={{ title: t('beat.title') }} />
            {state === 'checking' ? <VeyLoader label={t('beat.home.checking')} showLabel /> : null}
            {state === 'off' ? <EmptyState title={t('beat.off')} body={t('beat.offBody')} actionLabel={t('beat.back')} href="/audio" /> : null}
            {state === 'on' || state === 'offline' ? <>
                {state === 'offline' ? <MusicNotice message={t('beat.offline')} /> : null}
                <Button label={t('beat.home.new')} onPress={create} />
                {beats.length === 0 ? <EmptyState title={t('beat.home.empty')} body={t('beat.home.emptyBody')} /> : beats.map(beat => (
                    <View key={beat.id} style={s.row}>
                        <View style={s.grow}>
                            <ListRow title={beat.title} subtitle={t('beat.tempoValue', { bpm: beat.tempo.bpm })} accessibilityLabel={t('beat.home.openNamed', { title: beat.title })} onPress={() => open(beat.id)} />
                        </View>
                        <Button size="sm" variant="tertiary" label={t('beat.home.delete', { title: beat.title })} iconOnly icon="close" onPress={() => dropBeat(beat.id)} />
                    </View>
                ))}
                {beats.length ? <Text variant="footnote" tone="secondary">{t('beat.saveNote')}</Text> : null}
            </> : null}
        </ScrollView>
    );
}
const sheets = themedStyles(p => ({
    screen: { flex: 1, backgroundColor: p.bg },
    content: { padding: ds.space.gutter, gap: ds.space.lg },
    row: { flexDirection: 'row', alignItems: 'center', gap: ds.space.sm },
    grow: { flex: 1 },
}));
