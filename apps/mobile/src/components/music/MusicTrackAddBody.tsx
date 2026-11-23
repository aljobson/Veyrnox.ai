import { useMemo } from 'react';
import { Stack } from 'expo-router';
import { TextInput, View } from 'react-native';
import { Button, Card, Text, themedStyles, useThemedStyles } from '../ui';
import { MusicNotice } from './MusicNotice';
import { MusicActionQuoteCard } from './MusicActionQuoteCard';
import { MusicPlayer } from './MusicPlayer';
import { useSongActionScreen } from './useSongActionScreen';
import { trackAddAction } from '../../lib/music/trackAddAction';
import { initialTrackAddParameters, switchTrackAddMode } from '../../lib/music/trackAddForm';
import { trackAddMessage, trackAddStatusMessage } from '../../lib/music/trackAddMessages';
import { validTrackAdd } from '../../lib/music/validateTrackAdd';
import { MUSIC_PROMPT_MAX, MUSIC_LYRICS_MAX } from '../../lib/music/shared';
import type { TrackAddParameters } from '../../lib/music/trackAddTypes';
import { t } from '../../lib/i18n';
import { useAnnouncement } from '../../lib/useAnnouncement';
import { ds } from '../../theme';
import { SafeKeyboardFormScrollView } from '../SafeContentScrollView';
export function MusicTrackAddBody({ id }: { id: string }) {
    const { flow, state, pending } = useSongActionScreen(id, trackAddAction);
    const s = useThemedStyles(sheets);
    const parameters = (state.input.parameters ?? initialTrackAddParameters) as TrackAddParameters;
    const edit = (patch: Partial<TrackAddParameters>) => flow.edit({ parameters: { ...parameters, ...patch } });
    const locked = state.busy || pending?.phase === 'AMBIGUOUS';
    const waiting = state.poll?.state === 'waiting';
    const status = state.poll?.value;
    const message = trackAddStatusMessage(status, waiting);
    useAnnouncement(state.result ? message : null, { everywhere: true });
    const playback = useMemo(() => state.result ? {
        songId: id, jobId: state.result.track_job_id, trackAddRequestId: state.result.request_id, start: 0,
    } : null, [id, state.result]);
    return <SafeKeyboardFormScrollView style={s.screen} contentContainerStyle={s.content} gutter={ds.space.lg}>
        <Stack.Screen options={{ title: t('musicTrackAdd.title') }} />
        <Text variant="title1" accessibilityRole="header">{t('musicTrackAdd.title')}</Text>
        {state.status === 'off' ? <MusicNotice message={t('music.off')} />
            : state.status === 'loading' ? <Text>{t('music.loading')}</Text>
                : state.status === 'error' ? <MusicNotice message={t('music.loadError')} retry={() => void flow.load()} /> : <>
                    <Text>{state.song?.title}</Text><Text>{t('musicTrackAdd.session')}</Text>
                    {!state.result ? <>
                        <Text>{t('musicTrackAdd.mode')}</Text>
                        <View accessibilityRole="radiogroup" accessibilityLabel={t('musicTrackAdd.mode')} style={s.choices}>
                            {([{ mode: 'vocals', label: t('musicTrackAdd.mode.vocals') }, { mode: 'instrumental', label: t('musicTrackAdd.mode.instrumental') }] as const).map(({ mode, label }) => <Button key={mode} variant="secondary" accessibilityRole="radio"
                                accessibilityState={{ checked: parameters.mode === mode }} disabled={locked} label={label}
                                onPress={() => flow.edit({ parameters: switchTrackAddMode(parameters, mode) })} />)}
                        </View>
                        <Text>{t('musicGenerationActions.prompt')}</Text>
                        <TextInput accessibilityLabel={t('musicGenerationActions.prompt')} multiline maxLength={MUSIC_PROMPT_MAX}
                            editable={!locked} value={parameters.prompt} onChangeText={prompt => edit({ prompt })} style={s.input} />
                        {parameters.mode === 'vocals' ? <>
                            <Text>{t('musicTrackAdd.lyrics')}</Text>
                            <TextInput accessibilityLabel={t('musicTrackAdd.lyrics')} multiline maxLength={MUSIC_LYRICS_MAX}
                                editable={!locked} value={parameters.lyrics} onChangeText={lyrics => edit({ lyrics })} style={s.input} />
                            <Text>{t('musicTrackAdd.gender')}</Text>
                            <View accessibilityRole="radiogroup" accessibilityLabel={t('musicTrackAdd.gender')} style={s.choices}>
                                {([{ vocal_gender: 'auto', label: t('musicTrackAdd.gender.auto') }, { vocal_gender: 'female', label: t('musicTrackAdd.gender.female') },
                                    { vocal_gender: 'male', label: t('musicTrackAdd.gender.male') }] as const).map(({ vocal_gender, label }) => <Button key={vocal_gender} variant="secondary" accessibilityRole="radio"
                                    accessibilityState={{ checked: (parameters.vocal_gender ?? 'auto') === vocal_gender }} disabled={locked}
                                    label={label} onPress={() => edit({ vocal_gender })} />)}
                            </View>
                            <Button variant="secondary" accessibilityRole="checkbox" accessibilityState={{ checked: parameters.lyrics_rights_confirmed }}
                                label={t('musicTrackAdd.lyricsRights')} disabled={locked} onPress={() => edit({ lyrics_rights_confirmed: !parameters.lyrics_rights_confirmed })} />
                        </> : null}
                        <Button variant="secondary" accessibilityRole="checkbox" accessibilityState={{ checked: state.input.rights_confirmed }}
                            label={t('musicGenerationActions.rights')} disabled={locked}
                            onPress={() => flow.edit({ rights_confirmed: !state.input.rights_confirmed, parameters })} />
                        <Button label={t('musicActions.action.review')} disabled={locked || !state.input.rights_confirmed || !validTrackAdd(parameters)}
                            onPress={() => void flow.review()} />
                        {pending ? <MusicActionQuoteCard quote={pending.quote} ambiguous={pending.phase === 'AMBIGUOUS'} busy={state.busy} onConfirm={() => void flow.confirm()}>
                            <Text>{t('musicGenerationActions.duration', { seconds: pending.quote.source_duration_seconds })}</Text>
                            <Text>{t('musicTrackAdd.uploadPrice', { credits: pending.quote.upload_credits })}</Text>
                            <Text>{t('musicTrackAdd.partPrice', { credits: pending.quote.track_credits })}</Text>
                            <Text>{t('musicTrackAdd.charge')}</Text>
                        </MusicActionQuoteCard> : null}
                    </> : <>
                        <Card><Text accessibilityRole="header" variant="title3">{message}</Text>
                            {state.balance !== null ? <Text>{t('musicActions.action.remaining', { balance: state.balance })}</Text> : null}
                            {waiting && status?.state !== 'failed' ? <MusicNotice message={t('musicActions.action.waiting')} /> : null}
                            {waiting || status?.state === 'failed' ? <Button label={t('musicTrackAdd.checkAgain')} onPress={() => void flow.refresh()} /> : null}
                        </Card>
                        {status?.state === 'ready' && playback ? <MusicPlayer input={playback} /> : null}
                    </>}
                    {state.error ? <MusicNotice message={trackAddMessage(state.error)} /> : null}
                    {state.error === 'revision_conflict' ? <Button label={t('musicActions.action.reload')} onPress={() => void flow.load()} /> : null}
                </>}
    </SafeKeyboardFormScrollView>;
}
const sheets = themedStyles(p => ({ screen: { flex: 1, backgroundColor: p.bg }, content: { gap: ds.space.md },
    input: { color: p.textPrimary, borderColor: p.borderSubtle, borderWidth: 1, borderRadius: 12, padding: ds.space.md, minHeight: 100, textAlignVertical: 'top' },
    choices: { gap: ds.space.sm } }));
