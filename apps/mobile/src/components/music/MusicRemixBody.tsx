import { Stack } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { TextInput, View } from 'react-native';
import { listSongs } from '../../lib/music/client';
import { remixAction } from '../../lib/music/remixAction';
import { remixActionMessage } from '../../lib/music/remixActionMessages';
import type { MusicRemixQuote, RemixActionKind } from '../../lib/music/remixActionTypes';
import { MUSIC_REMIX_PROMPT_MAX } from '../../lib/music/shared';
import type { MusicSongRow } from '../../lib/music/types';
import type { PlaybackInput } from '../../lib/music/player';
import { t } from '../../lib/i18n';
import { useAnnouncement } from '../../lib/useAnnouncement';
import { ds } from '../../theme';
import { SafeKeyboardFormScrollView } from '../SafeContentScrollView';
import { Button, Card, Text, themedStyles, useThemedStyles } from '../ui';
import { MusicActionQuoteCard } from './MusicActionQuoteCard';
import { MusicCandidateCard } from './MusicCandidateCard';
import { MusicNotice } from './MusicNotice';
import { MusicPlayer } from './MusicPlayer';
import { useSongActionScreen } from './useSongActionScreen';

const makeMashup = (id: string) => remixAction('mashup', id);
const makeSample = (id: string) => remixAction('sample', id);

export function MusicRemixBody({ id, kind }: { id: string; kind: RemixActionKind }) {
    const { api, flow, state, pending } = useSongActionScreen(id, kind === 'mashup' ? makeMashup : makeSample);
    const s = useThemedStyles(sheets);
    const [songs, setSongs] = useState<readonly MusicSongRow[]>([]);
    const [songsState, setSongsState] = useState<'idle' | 'loading' | 'ready' | 'error'>(kind === 'mashup' ? 'loading' : 'idle');
    const [songQuery, setSongQuery] = useState('');
    const [activeSongQuery, setActiveSongQuery] = useState('');
    const [selected, setSelected] = useState<{ flow: typeof flow; input: PlaybackInput; serial: number } | null>(null);
    const raw = state.input.parameters ?? {};
    const prompt = typeof raw.prompt === 'string' ? raw.prompt : '';
    const influence = Number.isInteger(raw.source_influence) ? Number(raw.source_influence) : 50;
    const start = Number.isInteger(raw.start_seconds) && Number(raw.start_seconds) >= 0 ? Number(raw.start_seconds) : 0;
    const end = Number.isInteger(raw.end_seconds) && Number(raw.end_seconds) > start ? Number(raw.end_seconds) : start + 15;
    const length = end - start;
    const extend = Number.isInteger(raw.extend_seconds) ? Number(raw.extend_seconds) : 60;
    const secondId = typeof raw.second_song_id === 'string' ? raw.second_song_id : '';
    const title = t(`musicRemix.${kind}.title`);
    const locked = state.busy || pending?.phase === 'AMBIGUOUS';
    const quote = pending?.quote as MusicRemixQuote | undefined;
    const status = state.poll?.value?.state ?? state.result?.state;
    const statusKey = status && ['queued', 'running', 'succeeded', 'partial', 'failed', 'refunded'].includes(status) ? status : 'running';
    const rangeError = state.error === 'sample_range_invalid' || state.error === 'source_duration_invalid' ? state.error : null;
    const candidates = state.poll?.value?.candidates
        ?? state.result?.candidates.map(candidate => ({ ...candidate, song_id: null, version_id: null, audio_url: null, error_code: null }));
    const others = useMemo(() => songs.filter(song => song.id !== id && typeof song.version_id === 'string'), [songs, id]);

    useEffect(() => {
        if (kind !== 'mashup' || state.status !== 'on' || songsState !== 'loading') return;
        let live = true;
        void listSongs(api, { limit: 50, ...(activeSongQuery ? { q: activeSongQuery } : {}) }).then(value => {
            if (!live) return;
            setSongs(value);
            setSongsState('ready');
        }).catch(() => { if (live) setSongsState('error'); });
        return () => { live = false; };
    }, [activeSongQuery, api, kind, songsState, state.status]);

    useAnnouncement(state.result ? t(`musicGenerationActions.state.${statusKey}`) : null, { everywhere: true });

    const parameters = kind === 'mashup' ? {
        prompt, source_influence: influence,
        second_song_id: secondId,
        second_version_id: typeof raw.second_version_id === 'string' ? raw.second_version_id : '',
    } : { prompt, start_seconds: start, end_seconds: end, extend_seconds: extend };
    const edit = (patch: Record<string, unknown>) => flow.edit({ parameters: { ...parameters, ...patch } });
    const validPrompt = prompt.trim().length > 0 && prompt.trim().length <= MUSIC_REMIX_PROMPT_MAX;
    const valid = validPrompt && (kind === 'mashup'
        ? Boolean(secondId && parameters.second_version_id && Number.isInteger(influence) && influence >= 10 && influence <= 90)
        : Number.isInteger(start) && start >= 0 && Number.isInteger(length) && length >= 5 && length <= 30
            && Number.isInteger(extend) && extend >= 10 && extend <= 90);

    return <SafeKeyboardFormScrollView style={s.screen} contentContainerStyle={s.content} gutter={ds.space.lg}>
        <Stack.Screen options={{ title }} />
        <Text variant="title1" accessibilityRole="header">{title}</Text>
        {state.status === 'off' ? <MusicNotice message={t('music.off')} />
            : state.status === 'loading' ? <Text>{t('music.loading')}</Text>
                : state.status === 'error' ? <MusicNotice message={t('music.loadError')} retry={() => void flow.load()} /> : <>
                    <Text variant="bodyStrong">{state.song?.title}</Text>
                    <Text>{t(`musicRemix.${kind}.intro`)}</Text>
                    {!state.result ? <>
                        {kind === 'mashup' ? <View style={s.group}>
                            <Text variant="bodyStrong">{t('musicRemix.secondSong')}</Text>
                            <TextInput accessibilityLabel={t('music.search')} value={songQuery} editable={!locked}
                                onChangeText={setSongQuery} onSubmitEditing={() => {
                                    setActiveSongQuery(songQuery.trim()); setSongsState('loading');
                                }} style={s.searchInput} />
                            <View style={s.row}>
                                <Button variant="secondary" label={t('music.search')} disabled={!!locked || songsState === 'loading'}
                                    onPress={() => { setActiveSongQuery(songQuery.trim()); setSongsState('loading'); }} />
                                {activeSongQuery ? <Button variant="secondary" label={t('music.clear')} disabled={!!locked}
                                    onPress={() => { setSongQuery(''); setActiveSongQuery(''); setSongsState('loading'); }} /> : null}
                            </View>
                            {songsState === 'loading' ? <Text>{t('musicRemix.loadingSongs')}</Text> : null}
                            {songsState === 'error' ? <MusicNotice message={t('musicRemix.loadSongsError')}
                                retry={() => setSongsState('loading')} /> : null}
                            {songsState === 'ready' && !others.length ? <MusicNotice message={activeSongQuery
                                ? t('music.noResults', { query: activeSongQuery }) : t('musicRemix.noOtherSongs')} /> : null}
                            <View style={s.group} accessibilityRole="radiogroup" accessibilityLabel={t('musicRemix.secondSong')}>
                                {others.map((song, index) => <Button key={song.id} variant="secondary" accessibilityRole="radio"
                                    accessibilityState={{ checked: song.id === secondId }} accessibilityValue={{ text: `${index + 1}/${others.length}` }}
                                    label={song.title} disabled={!!locked}
                                    onPress={() => edit({ second_song_id: song.id, second_version_id: song.version_id })} />)}
                            </View>
                            <Text accessibilityLiveRegion="polite">{secondId
                                ? t('musicRemix.selectedSong', { title: others.find(song => song.id === secondId)?.title ?? '' })
                                : t('musicRemix.chooseSecondSong')}</Text>
                        </View> : <View style={s.group}>
                            <Text accessibilityLiveRegion="polite">{t('musicRemix.sample.start', { seconds: start })}</Text>
                            <View style={s.row}><Button variant="secondary" label={t('musicRemix.sample.startLess')} disabled={!!locked || start <= 0}
                                onPress={() => edit({ start_seconds: Math.max(0, start - 5), end_seconds: Math.max(0, start - 5) + length })} />
                            <Button variant="secondary" label={t('musicRemix.sample.startMore')} disabled={!!locked || start >= 1800}
                                onPress={() => edit({ start_seconds: Math.min(1800, start + 5), end_seconds: Math.min(1800, start + 5) + length })} /></View>
                            <Text accessibilityLiveRegion="polite">{t('musicRemix.sample.length', { seconds: length })}</Text>
                            <View style={s.row}><Button variant="secondary" label={t('musicRemix.sample.shorter')} disabled={!!locked || length <= 5}
                                onPress={() => edit({ end_seconds: start + Math.max(5, length - 1) })} />
                            <Button variant="secondary" label={t('musicRemix.sample.longer')} disabled={!!locked || length >= 30}
                                onPress={() => edit({ end_seconds: start + Math.min(30, length + 1) })} /></View>
                            <Text accessibilityLiveRegion="polite">{t('musicRemix.sample.extend', { seconds: extend })}</Text>
                            <View style={s.row}><Button variant="secondary" label={t('musicRemix.sample.extendLess')} disabled={!!locked || extend <= 10}
                                onPress={() => edit({ extend_seconds: Math.max(10, extend - 5) })} />
                            <Button variant="secondary" label={t('musicRemix.sample.extendMore')} disabled={!!locked || extend >= 90}
                                onPress={() => edit({ extend_seconds: Math.min(90, extend + 5) })} /></View>
                            {rangeError ? <MusicNotice message={remixActionMessage(rangeError, kind)} /> : null}
                        </View>}
                        <Text variant="bodyStrong">{t('musicRemix.prompt')}</Text>
                        <TextInput accessibilityLabel={t('musicRemix.prompt')} multiline maxLength={MUSIC_REMIX_PROMPT_MAX}
                            editable={!locked} value={prompt} onChangeText={value => edit({ prompt: value })} style={s.input} />
                        {kind === 'mashup' ? <View style={s.group}>
                            <Text accessibilityLiveRegion="polite">{t('musicRemix.influence', { value: influence })}</Text>
                            <View style={s.row}><Button variant="secondary" label={t('musicRemix.influenceLess')} disabled={!!locked || influence <= 10}
                                onPress={() => edit({ source_influence: Math.max(10, influence - 10) })} />
                            <Button variant="secondary" label={t('musicRemix.influenceMore')} disabled={!!locked || influence >= 90}
                                onPress={() => edit({ source_influence: Math.min(90, influence + 10) })} /></View>
                        </View> : null}
                        <Button variant="secondary" accessibilityRole="checkbox" accessibilityState={{ checked: state.input.rights_confirmed }}
                            label={t(`musicRemix.${kind}.rights`)} disabled={!!locked}
                            onPress={() => flow.edit({ rights_confirmed: !state.input.rights_confirmed, parameters })} />
                        <Button label={t('musicActions.action.review')} disabled={!!locked || !state.input.rights_confirmed || !valid}
                            onPress={() => void flow.review()} />
                        {quote && pending && quote.kind === kind ? <MusicActionQuoteCard quote={quote} ambiguous={pending.phase === 'AMBIGUOUS'}
                            busy={state.busy} onConfirm={() => void flow.confirm()}>
                            <Text>{t(`musicRemix.${kind}.pair`, { total: quote.total_credits, each: quote.credits_per_candidate })}</Text>
                            <Text>{t('musicRemix.sourceDuration', { seconds: quote.source_duration_seconds })}</Text>
                            <Text>{t('musicRemix.charge')}</Text>
                        </MusicActionQuoteCard> : null}
                    </> : <>
                        <Card><Text accessibilityRole="header" variant="title3">{t(`musicGenerationActions.state.${statusKey}`)}</Text>
                            {state.balance !== null ? <Text>{t('musicActions.action.remaining', { balance: state.balance })}</Text> : null}
                            {state.poll?.state === 'waiting' ? <><MusicNotice message={t('musicActions.action.waiting')} />
                                <Button label={t('musicActions.action.refresh')} onPress={() => void flow.refresh()} /></> : null}
                        </Card>
                        {selected?.flow === flow ? <MusicPlayer key={`${selected.input.jobId}:${selected.serial}`} input={selected.input} autoPlay /> : null}
                        {candidates?.map(candidate => <MusicCandidateCard key={candidate.ordinal} candidate={candidate}
                            requireValidSongId openSongLabel={t('musicGenerationActions.openSong')}
                            cancellation={{ api, refresh: flow.refresh, afterCancel: flow.refreshBalance }}
                            onPlay={input => { if (flow.isLive()) setSelected(previous => ({ flow, input, serial: (previous?.serial ?? 0) + 1 })); }} />)}
                    </>}
                    {state.error && !rangeError ? <MusicNotice message={remixActionMessage(state.error, kind)} /> : null}
                    {state.error === 'revision_conflict' || state.error === 'source_changed'
                        ? <Button label={t('musicActions.action.reload')} onPress={() => void flow.load()} /> : null}
                </>}
    </SafeKeyboardFormScrollView>;
}

const sheets = themedStyles(p => ({
    screen: { flex: 1, backgroundColor: p.bg },
    content: { gap: ds.space.md },
    group: { gap: ds.space.sm },
    row: { flexDirection: 'row', flexWrap: 'wrap', gap: ds.space.sm },
    searchInput: { color: p.textPrimary, borderColor: p.borderSubtle, borderWidth: 1, borderRadius: 12,
        paddingHorizontal: ds.space.md, minHeight: 48 },
    input: { color: p.textPrimary, borderColor: p.borderSubtle, borderWidth: 1, borderRadius: 12,
        padding: ds.space.md, minHeight: 100, textAlignVertical: 'top' },
}));
