import { useEffect, useRef, useState } from 'react';
import { Stack, useLocalSearchParams } from 'expo-router';
import { View } from 'react-native';
import { Button, Card, Text, themedStyles, useThemedStyles } from '../../../components/ui';
import { MusicNotice } from '../../../components/music/MusicNotice';
import { MusicActionQuoteCard } from '../../../components/music/MusicActionQuoteCard';
import { useSongActionScreen } from '../../../components/music/useSongActionScreen';
import { shareStemFile, sweepStemFiles } from '../../../lib/music/stemFiles';
import { getCacheUser } from '../../../lib/appCache';
import { targetStemsAction } from '../../../lib/music/targetStemsAction';
import { getTargetStemAsset } from '../../../lib/music/client';
import { targetStemMessage } from '../../../lib/music/targetStemMessages';
import { MUSIC_TARGET_STEM_INSTRUMENTS } from '../../../lib/music/shared';
import { isMusicTargetStemQuote, isTargetStemInstrument } from '../../../lib/music/validateTargetStems';
import type { TargetStemKind } from '../../../lib/music/targetStemTypes';
import { t } from '../../../lib/i18n';
import { useAnnouncement } from '../../../lib/useAnnouncement';
import { ds } from '../../../theme';
import { SafeContentScrollView } from '../../../components/SafeContentScrollView';

export default function TargetStems() {
    const { id } = useLocalSearchParams<{ id: string }>();
    const { api, user, flow, state, pending } = useSongActionScreen(id, targetStemsAction);
    const [opening, setOpening] = useState(false); const assetLock = useRef(false); const s = useThemedStyles(sheets);
    useEffect(() => { assetLock.current = false; setOpening(false); }, [flow]);
    useEffect(() => { sweepStemFiles(); }, []);
    const status = state.poll?.value?.state ?? (state.result ? 'queued' : null);
    useAnnouncement(status ? t(`musicTargetStems.state.${status}`) : null, { everywhere: true });
    const selected = state.input.parameters?.instrument;
    const instrument = state.poll?.value?.instrument ?? selected;
    const label = isTargetStemInstrument(instrument) ? t(`musicTargetStems.instrument.${instrument}`) : '';
    const quote = pending && isMusicTargetStemQuote(pending.quote) ? pending.quote : null;
    const locked = state.busy || pending?.phase === 'AMBIGUOUS';
    async function openAsset(kind: TargetStemKind) {
        if (assetLock.current || !state.result || status !== 'ready' || !flow.isLive()) return;
        assetLock.current = true; setOpening(true);
        try {
            const asset = await getTargetStemAsset(api, state.result.request_id, kind);
            if (flow.isLive() && getCacheUser() === user) await shareStemFile({
                url: asset.url, mimeType: asset.mime_type, sizeBytes: asset.size_bytes,
                requestId: state.result.request_id, kind,
                isCurrent: () => flow.isLive() && getCacheUser() === user,
            });
        } catch (error) { flow.fail(error); }
        finally { if (flow.isLive()) { assetLock.current = false; setOpening(false); } }
    }
    return <SafeContentScrollView style={s.screen} contentContainerStyle={s.content} gutter={ds.space.lg}>
        <Stack.Screen options={{ title: t('musicTargetStems.title') }} />
        <Text variant="title1" accessibilityRole="header">{t('musicTargetStems.title')}</Text>
        {state.status === 'off' ? <MusicNotice message={t('music.off')} />
            : state.status === 'loading' ? <Text>{t('music.loading')}</Text>
                : state.status === 'error' ? <MusicNotice message={t('music.loadError')} retry={() => void flow.load()} /> : <>
                    <Text>{state.song?.title}</Text><Text>{t('musicTargetStems.body')}</Text>
                    <Text>{t('musicActions.stems.session')}</Text>
                    {!state.result ? <>
                        <Text>{t('musicTargetStems.charge')}</Text>
                        <Text variant="title3" accessibilityRole="header">{t('musicTargetStems.choose')}</Text>
                        <View accessibilityRole="radiogroup" accessibilityLabel={t('musicTargetStems.choose')} style={s.instruments}>
                            {MUSIC_TARGET_STEM_INSTRUMENTS.map(value => <Button key={value} size="md"
                                label={t(`musicTargetStems.instrument.${value}`)} variant={selected === value ? 'primary' : 'secondary'}
                                accessibilityRole="radio" accessibilityState={{ selected: selected === value, checked: selected === value }} disabled={locked}
                                onPress={() => flow.edit({ parameters: { instrument: value } })} />)}
                        </View>
                        <Button variant="secondary" accessibilityRole="checkbox" accessibilityState={{ checked: state.input.rights_confirmed }}
                            label={t('musicActions.stems.rights')} disabled={locked}
                            onPress={() => flow.edit({ rights_confirmed: !state.input.rights_confirmed })} />
                        <Button label={t('musicActions.action.review')} disabled={locked || !state.input.rights_confirmed || !isTargetStemInstrument(selected)}
                            onPress={() => void flow.review()} />
                        {quote && pending ? <MusicActionQuoteCard quote={quote} ambiguous={pending.phase === 'AMBIGUOUS'} busy={state.busy} onConfirm={() => void flow.confirm()}>
                            <Text>{t('musicTargetStems.quoteInstrument', { instrument: t(`musicTargetStems.instrument.${quote.instrument}`) })}</Text>
                            <Text>{t('musicTargetStems.duration', { seconds: quote.source_duration_seconds })}</Text>
                        </MusicActionQuoteCard> : null}
                    </> : <Card>
                        <Text variant="title3" accessibilityRole="header">{t('musicTargetStems.status')}</Text>
                        {status ? <Text>{t(`musicTargetStems.state.${status}`)}</Text> : null}
                        {state.balance !== null ? <Text>{t('musicActions.action.remaining', { balance: state.balance })}</Text> : null}
                        {state.poll?.state === 'waiting' ? <><MusicNotice message={t('musicActions.action.waiting')} />
                            <Button label={t('musicActions.action.refresh')} onPress={() => void flow.refresh()} /></> : null}
                        {status === 'ready' ? <><Text>{t('musicActions.stems.external')}</Text>
                            <Button label={t('musicTargetStems.target', { instrument: label })} disabled={opening} onPress={() => void openAsset('target')} />
                            <Button label={t('musicTargetStems.residual', { instrument: label })} disabled={opening} onPress={() => void openAsset('residual')} /></> : null}
                    </Card>}
                    {state.error ? <MusicNotice message={targetStemMessage(state.error)} /> : null}
                    {state.error === 'revision_conflict' ? <Button label={t('musicActions.action.reload')} onPress={() => void flow.load()} /> : null}
                </>}
    </SafeContentScrollView>;
}
const sheets = themedStyles(p => ({ screen: { flex: 1, backgroundColor: p.bg }, content: { gap: ds.space.md },
    instruments: { gap: ds.space.sm } }));
