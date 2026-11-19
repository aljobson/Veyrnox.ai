import { addSectionAction } from '../../lib/music/addSectionAction';
import { replaceAction } from '../../lib/music/replaceAction';
import { createReplaceTake } from '../../lib/music/replaceTake';
import { sectionParameters, replaceRange, knownSourceDuration } from '../../lib/music/sectionForm';
import { sectionActionMessage } from '../../lib/music/sectionActionMessages';
import { isMusicAddSectionQuote, isMusicReplaceQuote, validAddSection, validReplace } from '../../lib/music/validateSectionActions';
import { MusicSectionForm } from './MusicSectionForm';
import { MusicSectionQuoteDetails } from './MusicSectionQuoteDetails';
import { MusicReplaceTakeControls, MusicReplaceTakeNotices } from './MusicReplaceTakeControls';
import { useMemo, useState, useSyncExternalStore } from 'react';
import { Stack } from 'expo-router';
import { ScrollView, TextInput, View } from 'react-native';
import { Button, Card, Text, themedStyles, useThemedStyles } from '../ui';
import { MusicNotice } from './MusicNotice';
import { MusicActionQuoteCard } from './MusicActionQuoteCard';
import { MusicCandidateCard } from './MusicCandidateCard';
import { MusicPlayer } from './MusicPlayer';
import { useSongActionScreen } from './useSongActionScreen';
import { extendAction } from '../../lib/music/extendAction';
import { coverAction } from '../../lib/music/coverAction';
import { generationActionMessage } from '../../lib/music/generationActionMessages';
import { isMusicExtendQuote, isMusicCoverQuote, validActionPrompt } from '../../lib/music/validateGenerationActions';
import { MUSIC_COVER_PROMPT_MAX } from '../../lib/music/shared';
import type { AnyGenerationActionKind as GenerationActionKind } from '../../lib/music/sectionActionTypes';
import type { PlaybackInput } from '../../lib/music/player';
import { t } from '../../lib/i18n';
import { useAnnouncement } from '../../lib/useAnnouncement';
import { ds } from '../../theme';

export function MusicGenerationActionBody({ id, kind }: { id: string; kind: GenerationActionKind }) {
    const { api, flow, state, pending } = useSongActionScreen(id, kind === 'extend' ? extendAction : kind === 'cover' ? coverAction : kind === 'add_section' ? addSectionAction : replaceAction);
    const sectionKind = kind === 'add_section' || kind === 'replace_section' ? kind : null;
    const title = sectionKind ? t(`musicSectionActions.${sectionKind}.title`) : t(`musicGenerationActions.${kind}.title`);
    const keeper = useMemo(() => createReplaceTake(api, id, state.result?.generation_id ?? '', flow.isLive, flow.fail), [api, id, flow, state.result?.generation_id]);
    const keepState = useSyncExternalStore(keeper.subscribe, keeper.snapshot, keeper.snapshot);
    const s = useThemedStyles(sheets);
    const [selected, setSelected] = useState<{ flow: typeof flow; input: PlaybackInput; serial: number } | null>(null);
    const prompt = typeof state.input.parameters?.prompt === 'string' ? state.input.parameters.prompt : '';
    const influence = typeof state.input.parameters?.source_influence === 'number' ? state.input.parameters.source_influence : 50;
    const parameters = sectionKind ? sectionParameters(sectionKind, state.input.parameters) : { prompt, source_influence: influence };
    const edit = (patch: Record<string, unknown>) => flow.edit({ parameters: { ...parameters, ...patch } });
    const valid = kind === 'add_section' ? validAddSection(parameters) : kind === 'replace_section' ? validReplace({ ...parameters, ...replaceRange(parameters) }) : validActionPrompt(prompt);
    useAnnouncement(kind === 'cover' ? t('musicGenerationActions.influence', { value: influence }) : null, { everywhere: true });
    const locked = state.busy || pending?.phase === 'AMBIGUOUS';
    const quote = pending && (isMusicExtendQuote(pending.quote) || isMusicCoverQuote(pending.quote) || isMusicAddSectionQuote(pending.quote) || isMusicReplaceQuote(pending.quote)) ? pending.quote : null;
    const status = state.poll?.value?.state ?? state.result?.state;
    const statusKey = status && ['queued', 'running', 'succeeded', 'partial', 'failed', 'refunded'].includes(status) ? status : 'running';
    useAnnouncement(state.result ? t(`musicGenerationActions.state.${statusKey}`) : null, { everywhere: true });
    const candidates = state.poll?.value?.candidates ?? state.result?.candidates.map(c => ({ ...c, song_id: null, version_id: null, audio_url: null, error_code: null }));
    return <ScrollView style={s.screen} contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
        <Stack.Screen options={{ title }} />
        <Text variant="title1" accessibilityRole="header">{title}</Text>
        {state.status === 'off' ? <MusicNotice message={t('music.off')} />
            : state.status === 'loading' ? <Text>{t('music.loading')}</Text>
                : state.status === 'error' ? <MusicNotice message={t('music.loadError')} retry={() => void flow.load()} /> : <>
                    <Text>{state.song?.title}</Text><Text>{t('musicGenerationActions.session')}</Text>
                    {!state.result ? <>
                        {sectionKind ? <MusicSectionForm kind={sectionKind} parameters={parameters} edit={edit} locked={!!locked} duration={knownSourceDuration(state.song)} /> : <>
                        <Text>{t('musicGenerationActions.prompt')}</Text>
                        <TextInput accessibilityLabel={t('musicGenerationActions.prompt')} multiline maxLength={MUSIC_COVER_PROMPT_MAX}
                            editable={!locked} value={prompt} onChangeText={value => edit({ prompt: value })} style={s.input} />
                        {kind === 'cover' ? <View style={s.stepper}>
                            <Text accessibilityLiveRegion="polite">{t('musicGenerationActions.influence', { value: influence })}</Text>
                            <Button variant="secondary" label={t('musicGenerationActions.less')} disabled={locked || influence <= 10}
                                onPress={() => edit({ source_influence: Math.max(10, influence - 5) })} />
                            <Button variant="secondary" label={t('musicGenerationActions.more')} disabled={locked || influence >= 90}
                                onPress={() => edit({ source_influence: Math.min(90, influence + 5) })} />
                        </View> : null}
                        </>}
                        <Button variant="secondary" accessibilityRole="checkbox" accessibilityState={{ checked: state.input.rights_confirmed }}
                            label={t('musicGenerationActions.rights')} disabled={locked}
                            onPress={() => flow.edit({ rights_confirmed: !state.input.rights_confirmed, parameters })} />
                        <Button label={t('musicActions.action.review')} disabled={locked || !state.input.rights_confirmed || !valid}
                            onPress={() => void flow.review()} />
                        {quote && pending ? <MusicActionQuoteCard quote={quote} ambiguous={pending.phase === 'AMBIGUOUS'} busy={state.busy} onConfirm={() => void flow.confirm()}>
                            {isMusicAddSectionQuote(quote) || isMusicReplaceQuote(quote) ? <MusicSectionQuoteDetails quote={quote} /> : <>
                            <Text>{t('musicGenerationActions.duration', { seconds: quote.source_duration_seconds })}</Text>
                            <Text>{isMusicExtendQuote(quote)
                                ? t('musicGenerationActions.extend.pair', { seconds: quote.extend_seconds_after, total: quote.total_credits, each: quote.credits_per_candidate })
                                : t('musicGenerationActions.cover.pair', { total: quote.total_credits, each: quote.credits_per_candidate })}</Text>
                            {isMusicCoverQuote(quote) ? <Text>{t('musicGenerationActions.influence', { value: quote.source_influence })}</Text> : null}
                            <Text>{t('musicGenerationActions.charge')}</Text></>}
                        </MusicActionQuoteCard> : null}
                    </> : <>
                        <Card><Text accessibilityRole="header" variant="title3">{t(`musicGenerationActions.state.${statusKey}`)}</Text>
                            {state.balance !== null ? <Text>{t('musicActions.action.remaining', { balance: state.balance })}</Text> : null}
                            {state.poll?.state === 'waiting' ? <><MusicNotice message={t('musicActions.action.waiting')} />
                                <Button label={t('musicActions.action.refresh')} onPress={() => void flow.refresh()} /></> : null}
                        </Card>
                        {kind === 'replace_section' && keepState.phase !== 'committed' ? <Text>{t('musicSectionActions.keepBeforeLeaving')}</Text> : null}
                        {selected?.flow === flow ? <MusicPlayer key={`${selected.input.jobId}:${selected.serial}`} input={selected.input} autoPlay /> : null}
                        {candidates?.map(candidate => <MusicCandidateCard key={candidate.ordinal} candidate={candidate}
                            requireValidSongId openSongLabel={t('musicGenerationActions.openSong')}
                            onPlay={input => { if (flow.isLive()) setSelected(previous => ({ flow, input, serial: (previous?.serial ?? 0) + 1 })); }}>
                            {kind === 'replace_section' ? <MusicReplaceTakeControls keeper={keeper} state={keepState} candidate={candidate} songId={id} /> : null}
                        </MusicCandidateCard>)}
                        {kind === 'replace_section' ? <MusicReplaceTakeNotices state={keepState} songId={id} /> : null}
                    </>}
                    {state.error ? <MusicNotice message={sectionKind ? sectionActionMessage(state.error, sectionKind, state.errorMetadata) : generationActionMessage(state.error, kind === 'cover' ? 'cover' : 'extend')} /> : null}
                    {state.error === 'revision_conflict' || state.error === 'source_changed'
                        ? <Button label={t('musicActions.action.reload')} onPress={() => void flow.load()} /> : null}
                </>}
    </ScrollView>;
}
const sheets = themedStyles(p => ({ screen: { flex: 1, backgroundColor: p.bg }, content: { padding: ds.space.lg, gap: ds.space.md },
    input: { color: p.textPrimary, borderColor: p.borderSubtle, borderWidth: 1, borderRadius: 12, padding: ds.space.md, minHeight: 100, textAlignVertical: 'top' },
    stepper: { gap: ds.space.sm } }));
