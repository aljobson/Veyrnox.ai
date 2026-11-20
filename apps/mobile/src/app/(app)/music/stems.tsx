import { useEffect, useRef, useState } from 'react';
import { Stack, useLocalSearchParams } from 'expo-router';
import { Linking, ScrollView } from 'react-native';
import { Button, Card, Text, themedStyles, useThemedStyles } from '../../../components/ui';
import { MusicNotice } from '../../../components/music/MusicNotice';
import { MusicActionQuoteCard } from '../../../components/music/MusicActionQuoteCard';
import { getCacheUser } from '../../../lib/appCache';
import { useSongActionScreen } from '../../../components/music/useSongActionScreen';
import { stemsAction } from '../../../lib/music/stemsAction';
import { getStemArchive } from '../../../lib/music/client';
import { actionMessage } from '../../../lib/music/actionMessages';
import { t } from '../../../lib/i18n';
import { useAnnouncement } from '../../../lib/useAnnouncement';
import { ds } from '../../../theme';
export default function Stems() {
    const { id } = useLocalSearchParams<{ id: string }>();
    const { api, user, flow, state, pending } = useSongActionScreen(id, stemsAction);
    const [opening, setOpening] = useState(false); const zipLock = useRef(false); const s = useThemedStyles(sheets);
    useEffect(() => {
        zipLock.current = false; setOpening(false);
    }, [flow, user]);
    const status = state.poll?.value?.state ?? (state.result ? 'queued' : null);
    useAnnouncement(status ? t(`musicActions.stems.${status}`) : null, { everywhere: true });
    async function openZip() {
        if (zipLock.current || !state.result || status !== 'ready' || !flow.isLive()) return;
        zipLock.current = true; setOpening(true);
        try {
            const archive = await getStemArchive(api, state.result.request_id);
            if (flow.isLive() && getCacheUser() === user) await Linking.openURL(archive.url);
        } catch (error) { flow.fail(error); }
        finally { if (flow.isLive()) { zipLock.current = false; setOpening(false); } }
    }
    return <ScrollView style={s.screen} contentContainerStyle={s.content}>
        <Stack.Screen options={{ title: t('musicActions.stems.title') }} />
        <Text variant="title1" accessibilityRole="header">{t('musicActions.stems.title')}</Text>
        {state.status === 'off' ? <MusicNotice message={t('music.off')} />
            : state.status === 'loading' ? <Text>{t('music.loading')}</Text>
                : state.status === 'error' ? <MusicNotice message={t('music.loadError')} retry={() => void flow.load()} /> : <>
                    <Text>{state.song?.title}</Text><Text>{t('musicActions.stems.body')}</Text>
                    <Text>{t('musicActions.stems.session')}</Text>
                    {!state.result ? <>
                        <Text>{t('musicActions.stems.charge')}</Text>
                        <Button variant="secondary" accessibilityRole="checkbox" accessibilityState={{ checked: state.input.rights_confirmed }}
                            label={t('musicActions.stems.rights')} disabled={state.busy || pending?.phase === 'AMBIGUOUS'}
                            onPress={() => flow.edit({ rights_confirmed: !state.input.rights_confirmed })} />
                        <Button label={t('musicActions.action.review')} disabled={state.busy || !state.input.rights_confirmed || pending?.phase === 'AMBIGUOUS'}
                            onPress={() => void flow.review()} />
                        {pending ? <MusicActionQuoteCard quote={pending.quote} ambiguous={pending.phase === 'AMBIGUOUS'} busy={state.busy} onConfirm={() => void flow.confirm()} /> : null}
                    </> : <Card>
                        <Text variant="title3" accessibilityRole="header">{t('musicActions.stems.status')}</Text>
                        {status ? <Text>{t(`musicActions.stems.${status}`)}</Text> : null}
                        {state.balance !== null ? <Text>{t('musicActions.action.remaining', { balance: state.balance })}</Text> : null}
                        {state.poll?.state === 'waiting' ? <MusicNotice message={t('musicActions.action.waiting')} /> : null}
                        {state.poll?.state === 'waiting' ? <Button label={t('musicActions.action.refresh')} onPress={() => void flow.refresh()} /> : null}
                        {status === 'ready' ? <><Text>{t('musicActions.stems.external')}</Text>
                            <Button label={t('musicActions.stems.zip')} disabled={opening} onPress={() => void openZip()} /></> : null}
                    </Card>}
                    {state.error ? <MusicNotice message={actionMessage(state.error)} /> : null}
                    {state.error === 'revision_conflict' ? <Button label={t('musicActions.action.reload')} onPress={() => void flow.load()} /> : null}
                </>}
    </ScrollView>;
}
const sheets = themedStyles(p => ({ screen: { flex: 1, backgroundColor: p.bg }, content: { padding: ds.space.lg, gap: ds.space.md } }));
