import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { Alert, Modal, ScrollView, View } from 'react-native';
import { useAuth } from '../../auth/AuthProvider';
import { Button, Checkbox, Text, TextField, themedStyles, useThemedStyles } from '../ui';
import { createPublicationFlow } from '../../lib/music/publicationFlow';
import { publicationName } from '../../lib/music/validatePublication';
import { publicHandle } from '../../lib/music/validatePublic';
import type { MusicSongDetail } from '../../lib/music/types';
import { MusicLinkShare } from './MusicLinkShare';
import { t, rawText } from '../../lib/i18n';
import { ds } from '../../theme';
import { subscribeCacheUser } from '../../lib/appCache';
export function MusicPublication({ song }: { song: MusicSongDetail }) {
    const { generation } = useAuth();
    return <PublicationBody key={`${song.id}:${generation}`} song={song} />;
}
function PublicationBody({ song }: { song: MusicSongDetail }) {
    const { api } = useAuth(), s = useThemedStyles(sheets);
    const [round, setRound] = useState(0);
    const flow = useMemo(() => createPublicationFlow(api, song.id), [api, song.id, round]);
    const state = useSyncExternalStore(flow.subscribe, flow.snapshot, flow.snapshot);
    const [open, setOpen] = useState(false), [handle, setHandle] = useState(''), [name, setName] = useState('');
    const [comments, setComments] = useState(true), [remixes, setRemixes] = useState(false), [rights, setRights] = useState(false);
    useEffect(() => {
        if (!flow.isLive()) { setRound(n => n + 1); return; }
        void flow.load();
        const off = subscribeCacheUser(() => { flow.dispose(); setOpen(false); setRound(n => n + 1); });
        return () => { off(); flow.dispose(); };
    }, [flow]);
    const read = state.read, publication = read?.state === 'on' ? read.data : null;
    const published = publication?.status === 'published', locked = state.busy || !!state.pending;
    const message = state.issue === 'policy' ? t('musicPublication.policy') : state.issue === 'handleTaken' ? t('musicPublication.handleTaken')
        : state.issue === 'retryPublish' ? t('musicPublication.retryPublish') : state.issue === 'checkUnpublish' ? t('musicPublication.checkUnpublish')
        : state.issue === 'writeError' ? t('music.writeError') : '';
    if (read?.state === 'off') return null;
    function show() { setHandle(publication?.handle ?? ''); setName(publication?.display_name ?? ''); setRights(false); setOpen(true); }
    function unpublish() {
        Alert.alert(rawText(t('musicPublication.unpublish')), rawText(t('musicPublication.unpublishConfirm')), [
            { text: rawText(t('music.cancel')), style: 'cancel' },
            { text: rawText(t('musicPublication.unpublish')), style: 'destructive', onPress: () => void flow.unpublish(publication!.slug) },
        ]);
    }
    return <View style={s.group}>
        <Text variant="title3">{t('musicPublication.title')}</Text>
        {!read ? <Text>{t('music.loading')}</Text> : read.state === 'error' ? <Button label={t('music.retry')} onPress={() => void flow.load()} /> : <>
            <Text>{t(published ? 'musicPublication.published' : 'musicPublication.private')}</Text>
            {published ? <>
                <MusicLinkShare slug={publication.slug} /><MusicLinkShare handle={publication.handle} />
                <Text>{t(publication.commercial_status === 'plan_eligible_terms_apply' ? 'musicPublication.commercial' : 'musicPublication.personal')}</Text>
                <Button icon="broadcastOff" variant="tertiary" tone="danger" label={t('musicPublication.unpublish')} disabled={locked} onPress={unpublish} />
            </> : <Button icon="broadcast" label={t('musicPublication.publish')} disabled={state.busy} onPress={() => state.pending ? setOpen(true) : show()} />}
        </>}
        {message ? <Text accessibilityRole="alert">{message}</Text> : null}
        {state.pending ? <Button label={t('musicPublication.retry')} disabled={state.busy || read?.state !== 'on'} onPress={() => void flow.publish(state.pending!)} /> : null}
        <Modal visible={open} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setOpen(false)}>
            <ScrollView contentContainerStyle={s.dialog} keyboardShouldPersistTaps="handled">
                <Text variant="title2">{t('musicPublication.title')}</Text>
                <Text>{t('musicPublication.explanation')}</Text>
                <Text>{t('music.version', { number: song.versions.find(v => v.id === (state.pending?.version_id ?? song.version_id))?.version_number ?? 1 })}</Text>
                <TextField label={t('musicPublication.handle')} value={state.pending?.handle ?? handle} onChangeText={setHandle} editable={!locked} autoCapitalize="none" autoCorrect={false}
                    error={handle && !publicHandle(handle) ? t('musicPublication.handleInvalid') : undefined} />
                <TextField label={t('musicPublication.name')} value={state.pending?.display_name ?? name} onChangeText={setName} editable={!locked}
                    error={name && !publicationName(name) ? t('musicPublication.nameInvalid') : undefined} />
                <Text variant="bodyStrong">{t('musicPublication.permissions')}</Text>
                <Checkbox checked={state.pending?.allow_comments ?? comments} onChange={setComments} disabled={locked}><Text>{t('musicPublication.comments')}</Text></Checkbox>
                <Checkbox checked={state.pending?.allow_remixes ?? remixes} onChange={setRemixes} disabled={locked}><Text>{t('musicPublication.remixes')}</Text></Checkbox>
                <Checkbox checked={!!state.pending || rights} onChange={setRights} disabled={locked}><Text>{t('musicPublication.rights')}</Text></Checkbox>
                {message ? <Text accessibilityRole="alert">{message}</Text> : null}
                {read?.state === 'error' ? <Button label={t('music.retry')} onPress={() => void flow.load()} /> : null}
                {published && !state.pending ? <Text>{t('musicPublication.published')}</Text> : <Button label={t(state.pending ? 'musicPublication.retry' : 'musicPublication.confirm')}
                    disabled={state.busy || read?.state !== 'on' || (!state.pending && (!rights || !publicHandle(handle) || !publicationName(name)))}
                    onPress={() => void flow.publish(state.pending ?? { version_id: song.version_id, handle, display_name: name.trim(), allow_comments: comments, allow_remixes: remixes, rights_confirmed: true })} />}
                <Button variant="tertiary" label={t('music.cancel')} onPress={() => setOpen(false)} />
            </ScrollView>
        </Modal>
    </View>;
}
const sheets = themedStyles(p => ({ group: { gap: ds.space.md }, dialog: { flexGrow: 1, backgroundColor: p.bg, padding: ds.space.lg, gap: ds.space.md } }));
