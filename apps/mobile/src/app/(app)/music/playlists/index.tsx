import { useAnnouncement } from '../../../../lib/useAnnouncement';
import { EmptyState } from '../../../../components/EmptyState';
import { useEffect, useState } from 'react';
import { Stack, useRouter } from 'expo-router';
import { RefreshControl } from 'react-native';
import { Button, ListRow, Text, TextField, themedStyles, useThemedStyles } from '../../../../components/ui';
import { MusicNotice } from '../../../../components/music/MusicNotice';
import { usePlaylists } from '../../../../lib/music/usePlaylists';
import { playlistMessage } from '../../../../lib/music/playlistMessages';
import { playlistTitle } from '../../../../lib/music/validatePlaylists';
import { t } from '../../../../lib/i18n';
import { ds } from '../../../../theme';
import { SafeKeyboardFormScrollView } from '../../../../components/SafeContentScrollView';
export default function Playlists() {
    const { flow, state } = usePlaylists(), router = useRouter(), s = useThemedStyles(sheets);
    const [title, setTitle] = useState(''), [invalid, setInvalid] = useState(false);
    useEffect(() => { setTitle(''); setInvalid(false); }, [flow]);
    useEffect(() => { if (state.notice === 'saved') setTitle(''); }, [state.notice]);
    const pending = flow.attempts.snapshot();
    const pendingTitle = pending?.write.kind === 'create' ? pending.write.title : undefined;
    useEffect(() => { if (pendingTitle !== undefined) setTitle(pendingTitle); }, [pendingTitle]);
    useAnnouncement(state.notice ? playlistMessage(state.notice) : state.busy ? t('musicPlaylists.working') : state.status === 'on' ? t('music.loaded', { count: state.playlists.length }) : null, { everywhere: true });
    return <SafeKeyboardFormScrollView style={s.screen} contentContainerStyle={s.content} gutter={ds.space.gutter}
        refreshControl={<RefreshControl refreshing={state.refreshing} onRefresh={() => { if (!state.busy) void flow.load(); }} />}>
        <Stack.Screen options={{ title: t('musicPlaylists.title') }} />
        {state.status === 'off' ? <><EmptyState title={t('music.off')} body={t('music.offBody')} /><Button variant="secondary" label={t('music.refresh')} onPress={() => void flow.load()} /></> : <>
            {state.status === 'loading' ? <Text accessibilityLiveRegion="polite">{t('music.loading')}</Text> : null}
            {state.error ? <MusicNotice message={playlistMessage(state.error)} retry={() => void flow.retry()} /> : null}
            {state.notice ? <Text accessibilityLiveRegion="polite">{playlistMessage(state.notice)}</Text> : null}
            {state.status === 'on' && !state.playlists.length ? <EmptyState title={t('musicPlaylists.empty')} body={t('musicPlaylists.emptyBody')} /> : null}
            {state.status === 'on' || pending ? <>
                <TextField label={t('musicPlaylists.name')} value={pendingTitle ?? title} error={invalid} maxLength={80} editable={!state.busy && !pending}
                    onChangeText={value => { setTitle(value); setInvalid(false); }} onBlur={() => setInvalid(!playlistTitle(title))} />
                {invalid ? <Text tone="danger" accessibilityRole="alert">{t('musicPlaylists.titleInvalid')}</Text> : null}
                <Button label={t(pending ? 'music.retry' : 'musicPlaylists.create')} disabled={state.busy || state.refreshing}
                    onPress={() => { if (pending) void flow.retry(); else if (!playlistTitle(title)) setInvalid(true); else void flow.create(title.trim()); }} />
            </> : null}
            {pending ? <Text>{t('musicPlaylists.pending')}</Text> : null}
            {state.playlists.map(p => <ListRow key={p.id} title={p.title} subtitle={p.pinned ? t('musicPlaylists.pinned') : undefined}
                accessibilityLabel={p.title} onPress={() => router.push({ pathname: '/music/playlists/[id]', params: { id: p.id } } as never)} />)}
        </>}
    </SafeKeyboardFormScrollView>;
}
const sheets = themedStyles(p => ({ screen: { flex: 1, backgroundColor: p.bg }, content: { gap: ds.space.md } }));
