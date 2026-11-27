import { useEffect, useRef, useState } from 'react';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { Switch, View } from 'react-native';
import { Button, SegmentedControl, Text, TextField, themedStyles, useThemedStyles } from '../../../components/ui';
import { MusicQuoteCard } from '../../../components/music/MusicQuoteCard';
import { MusicQueue } from '../../../components/music/MusicQueue';
import { MusicLyricsPanel } from '../../../components/music/MusicLyricsPanel';
import { MusicNotice } from '../../../components/music/MusicNotice';
import { MusicAdvancedControls } from '../../../components/music/MusicAdvancedControls';
import { MusicSunoControls } from '../../../components/music/MusicSunoControls';
import { MusicInspirationCard } from '../../../components/music/MusicInspirationCard';
import { MusicLyricistProfiles } from '../../../components/music/MusicLyricistProfiles';
import { useAuth } from '../../../auth/AuthProvider';
import { canMergeSmartDirectionText, EMPTY_MUSIC_SMART_DIRECTION, mergeSmartDirectionText, MusicSmartDirectionControls, type MusicSmartDirection } from '../../../components/music/MusicSmartDirectionControls';
import { useMusicCreate } from '../../../lib/music/useMusicCreate';
import { effectiveLyricsLimit, isSunoModel, modelCounterLimit, modelState, quoteBlockers } from '../../../lib/music/createForm';
import { formatLocale, t } from '../../../lib/i18n';
import { ds } from '../../../theme';
import { SafeKeyboardFormScrollView } from '../../../components/SafeContentScrollView';
import { resolveMusicCreateHandoff } from '../../../lib/music/createHandoff';
import { consumeMusicLyricReview, MUSIC_LYRIC_REQUEST_MAX, stageMusicLyricHandoff } from '../../../lib/music/lyricAssistantHandoff';
import type { MusicInspirationSource } from '../../../lib/music';
const KNOWN = new Set(['empty_prompt', 'lyrics_required', 'style_required', 'over_length', 'bpm_invalid', 'locked_plan', 'unavailable', 'rights', 'no_slot', 'not_affordable', 'quote_expired', 'quote_stale', 'daily_allowance_stale', 'contract_stale', 'draft_stale', 'quote_already_used', 'conflict', 'prompt_not_allowed', 'model_unavailable', 'plan_unavailable']);
const messageKey = (code: string) => code === 'rights' ? 'rights_required' : KNOWN.has(code) ? code : 'error';
export default function MusicCreate() {
    const { api, flow, state, pending, queue } = useMusicCreate(), s = useThemedStyles(sheets);
    const { generation: sessionGeneration = 0 } = useAuth();
    const router = useRouter();
    const { sample, challenge, lyricHandoff, templatePrompt, templateTitle } = useLocalSearchParams<{ sample?: string; challenge?: string; lyricHandoff?: string; templatePrompt?: string; templateTitle?: string }>();
    const [lyricRequest, setLyricRequest] = useState('');
    const [lyricReview, setLyricReview] = useState<null | { lyrics: string; sourceLyrics: string; draftId: string | null; draftRevision: number }>(null);
    const [lyricNotice, setLyricNotice] = useState<string | null>(null);
    const handledLyricTokens = useRef(new Set<string>());
    const seeded = useRef<typeof flow | null>(null), touched = useRef<typeof flow | null>(null);
    const edit: typeof flow.edit = (...args) => { touched.current = flow; flow.edit(...args); };
    useEffect(() => {
        if (seeded.current === flow || state.status !== 'on' || (!sample && !challenge && !templatePrompt)) return;
        seeded.current = flow;
        const handoff = resolveMusicCreateHandoff({ sampleId: sample, challengeId: challenge, templatePrompt, templateTitle, entitlements: state.entitlements,
            input: state.input, rights: state.rights, touched: touched.current === flow, pending: Boolean(pending), translate: t });
        if (handoff) flow.edit(handoff);
    }, [flow, sample, challenge, templatePrompt, templateTitle, state.status, state.input, state.rights, state.entitlements, pending]);
    const lock = useRef(false);
    const [direction, setDirection] = useState<MusicSmartDirection>(EMPTY_MUSIC_SMART_DIRECTION);
    const [directionError, setDirectionError] = useState('');
    const [now, setNow] = useState(Date.now);
    useEffect(() => {
        if (!pending || pending.phase === 'AMBIGUOUS') return;
        const timer = setTimeout(() => setNow(Date.now()), Math.min(2147483647, Math.max(0, Date.parse(pending.quote.expires_at) - Date.now()) + 1));
        return () => clearTimeout(timer);
    }, [pending]);
    const e = state.entitlements, input = state.input;
    const inspirationSources = (e?.inspiration_sources ?? []).filter((source): source is MusicInspirationSource => source === 'audio' || source === 'image');
    const model = e?.models.find(m => m.id === input.model_id);
    const suno = isSunoModel(model);
    const ambiguous = pending?.phase === 'AMBIGUOUS';
    const blockers = e && pending ? quoteBlockers({ input: pending.input, entitlements: e, rights: !pending.input.instrumental,
        activeCount: flow.tracker.activeCount(), quote: pending.quote, now, ambiguous }) : [];
    const error = state.error && t(`music.create.${messageKey(state.error)}`);
    const lyricLimit = e && model ? effectiveLyricsLimit(model, e) : null;
    useEffect(() => {
        if (typeof lyricHandoff !== 'string' || handledLyricTokens.current.has(lyricHandoff)
            || state.status !== 'on' || input.mode !== 'custom' || !state.draft || !lyricLimit) return;
        handledLyricTokens.current.add(lyricHandoff);
        router.setParams({ lyricHandoff: undefined });
        const result = consumeMusicLyricReview(lyricHandoff, { sourceLyrics: input.lyrics, lyricLimit,
            draftId: state.draft.id, draftRevision: state.draft.revision });
        if (result.ok) { setLyricReview({ lyrics: result.lyrics, sourceLyrics: input.lyrics,
            draftId: state.draft.id, draftRevision: state.draft.revision }); setLyricNotice(null); }
        else { setLyricReview(null); setLyricNotice(t(result.reason === 'over_length'
            ? 'music.lyricAssistant.overLength' : 'music.lyricAssistant.stale')); }
    }, [input.mode, input.lyrics, lyricHandoff, lyricLimit, router, state.draft, state.status]);

    useEffect(() => {
        if (!lyricReview) return;
        const activeLimit = e && model ? effectiveLyricsLimit(model, e) : null;
        if (input.mode !== 'custom' || input.instrumental || !state.draft || state.draft.id !== lyricReview.draftId
            || state.draft.revision !== lyricReview.draftRevision || input.lyrics !== lyricReview.sourceLyrics) {
            setLyricReview(null); setLyricNotice(t('music.lyricAssistant.stale')); return;
        }
        if (!activeLimit || Array.from(lyricReview.lyrics).length > activeLimit) {
            setLyricReview(null); setLyricNotice(t('music.lyricAssistant.overLength'));
        }
    }, [e, input.instrumental, input.lyrics, input.mode, lyricReview, model, state.draft]);

    function openLyricAssistant() {
        if (!state.draft || !lyricLimit) return;
        const token = stageMusicLyricHandoff({ sourceLyrics: input.lyrics, lyricLimit, request: lyricRequest,
            draftId: state.draft.id, draftRevision: state.draft.revision });
        if (!token) { setLyricNotice(t(Array.from(input.lyrics).length > lyricLimit
            ? 'music.lyricAssistant.overLength' : 'music.lyricAssistant.requestRequired')); return; }
        setLyricNotice(null);
        setLyricReview(null);
        router.push({ pathname: '/chat/new', params: { lyricHandoff: token } });
    }
    const updateDirection = (next: MusicSmartDirection, instrumentalOverride?: boolean) => {
        const max = input.mode === 'simple' ? (model ? modelCounterLimit(model, 'prompt') ?? 500 : 500)
            : Math.min(model && suno ? modelCounterLimit(model, 'styles') ?? e?.custom_drafts.styles_max ?? 500 : 500, e?.custom_drafts.styles_max ?? 500);
        const sourceText = input.mode === 'simple' ? input.prompt : input.styles;
        if (!canMergeSmartDirectionText(sourceText, next, max)) {
            setDirectionError('Your music direction is full. Shorten it before adding another Smart Direction choice.');
            return;
        }
        const voiceChanged = instrumentalOverride !== undefined || next.voice !== direction.voice;
        setDirectionError('');
        setDirection(next);
        const textPatch = input.mode === 'simple'
            ? { prompt: mergeSmartDirectionText(input.prompt, next, max) }
            : { styles: mergeSmartDirectionText(input.styles, next, max) };
        const voicePatch = instrumentalOverride !== undefined
            ? { instrumental: instrumentalOverride, vocalGender: 'auto' as const }
            : !voiceChanged ? {}
            : next.voice === 'Instrumental' ? { instrumental: true, vocalGender: 'auto' as const }
                : next.voice === 'Female vocal' ? { instrumental: false, vocalGender: 'female' as const }
                    : next.voice === 'Male vocal' ? { instrumental: false, vocalGender: 'male' as const }
                        : { instrumental: model?.controls.instrumental === 'required', vocalGender: 'auto' as const };
        edit({ ...textPatch, ...voicePatch });
    };
    const setInstrumentalDirection = (instrumental: boolean) => updateDirection(
        { ...direction, voice: instrumental ? 'Instrumental' : '' },
        instrumental,
    );
    return <SafeKeyboardFormScrollView style={s.screen} contentContainerStyle={s.content} gutter={ds.space.lg}>
        <Stack.Screen options={{ title: t('music.create.title') }} />
        {state.status === 'off' ? <MusicNotice message={t('music.off')} />
            : state.status === 'loading' ? <Text>{t('music.loading')}</Text>
                : state.status === 'error' ? <MusicNotice message={t('music.loadError')} retry={() => void flow.load()} />
                    : e && e.models.length === 0 ? <MusicNotice message={t('music.create.unavailable')} />
                        : e ? <>
                        <Text variant="title1">{t('music.create.title')}</Text>
                        {e.daily_allowance?.unavailable ? <MusicNotice message={t('music.create.dailyAllowanceUnavailable')} />
                            : e.daily_allowance?.enabled ? <View style={s.content}>
                                <Text>{e.daily_allowance.candidates_remaining === 0
                                    ? t('music.create.dailyAllowanceExhausted')
                                    : t(e.daily_allowance.candidates_remaining === 1
                                        ? 'music.create.dailyAllowanceStatus.one' : 'music.create.dailyAllowanceStatus.other',
                                    { count: e.daily_allowance.candidates_remaining ?? 0 })}</Text>
                                {e.daily_allowance.reset_at ? <Text>{t('music.create.dailyAllowanceReset', {
                                    time: new Date(e.daily_allowance.reset_at).toLocaleTimeString(formatLocale()),
                                })}</Text> : null}
                            </View> : null}
                        <SegmentedControl value={input.mode} options={[
                            { value: 'simple' as const, label: t('music.create.describe'), icon: 'textSize' as const },
                            { value: 'custom' as const, label: t('music.create.lyrics'), icon: 'audio' as const },
                        ]} onChange={mode => {
                            const prompt = mergeSmartDirectionText(input.prompt, EMPTY_MUSIC_SMART_DIRECTION, 500);
                            const styles = mergeSmartDirectionText(input.styles, EMPTY_MUSIC_SMART_DIRECTION, e.custom_drafts.styles_max);
                            edit({ mode, prompt, styles });
                            setDirection(EMPTY_MUSIC_SMART_DIRECTION);
                        }} />
                        {suno ? <Text variant="bodyStrong">{t('music.create.suno.offer')}</Text> : null}
                        <View style={s.row}>{e.models.filter(m => m.generation_modes.includes(input.mode)).map(m => {
                            const status = modelState(m, e);
                            return <Button key={m.id} variant={input.model_id === m.id ? 'primary' : 'secondary'}
                                label={status === 'locked_plan' ? t('music.create.paidModel', { model: m.name }) : m.name}
                                disabled={status !== 'usable'} onPress={() => { if (status === 'usable') {
                                    edit({ model_id: m.id, ...(m.controls.instrumental === 'required' ? { instrumental: true, vocalGender: 'auto' as const } : {}) });
                                    if (m.controls.instrumental === 'required') setDirection(current => ({ ...current, voice: 'Instrumental' }));
                                } }} />;
                        })}</View>
                        {input.mode === 'simple' ? <>
                            <TextField label={t('music.create.prompt')} value={input.prompt} multiline
                                maxLength={suno && model ? modelCounterLimit(model, 'prompt') ?? undefined : 500} onChangeText={prompt => edit({ prompt })} />
                            {inspirationSources.length ? <MusicInspirationCard api={api} sources={inspirationSources}
                                onApply={prompt => edit({ prompt: prompt.slice(0, model ? modelCounterLimit(model, 'prompt') ?? 500 : 500) })} /> : null}
                            <MusicSmartDirectionControls value={direction} onChange={updateDirection}
                                voiceLocked={model?.controls.instrumental === 'required'} />
                            {suno && model?.controls.instrumental ? <View style={s.row}>
                                <Text>{t('music.create.instrumental')}</Text><Switch accessibilityLabel={t('music.create.instrumental')}
                                    disabled={model.controls.instrumental === 'required'} value={input.instrumental}
                                    onValueChange={setInstrumentalDirection} />
                            </View> : null}
                        </> : suno && model ? <>
                            <View style={s.row}>
                                <Text>{t('music.create.instrumental')}</Text><Switch accessibilityLabel={t('music.create.instrumental')}
                                    value={input.instrumental} onValueChange={setInstrumentalDirection} />
                            </View>
                            <MusicSunoControls input={input} model={model} rights={state.rights} onChange={edit} showVocalGender={false}
                                onRights={rights => edit({}, rights)} />
                            <MusicSmartDirectionControls value={direction} onChange={updateDirection} />
                            {!input.instrumental && !input.lyrics.trim() ? <MusicNotice message={t('music.create.lyrics_required')} /> : null}
                            {!input.instrumental && !state.rights ? <MusicNotice message={t('music.create.rights_required')} /> : null}
                        </> : <>
                                <MusicLyricsPanel value={input.lyrics} max={Math.min(3000, e.custom_drafts.lyrics_max)} onChange={lyrics => edit({ lyrics })} />
                                <TextField label={t('music.create.styles')} value={input.styles} maxLength={Math.min(500, e.custom_drafts.styles_max)} onChangeText={styles => edit({ styles })} />
                                <MusicSmartDirectionControls value={direction} onChange={updateDirection}
                                    voiceLocked={model?.controls.instrumental === 'required'} />
                                {model?.controls.instrumental === 'optional' && model.controls.lyrics ? <View style={s.row}>
                                    <Text>{t('music.create.instrumental')}</Text><Switch accessibilityLabel={t('music.create.instrumental')} value={input.instrumental} onValueChange={setInstrumentalDirection} />
                                </View> : null}
                                {!input.instrumental ? <Button variant="secondary" accessibilityRole="checkbox" accessibilityState={{ checked: state.rights }}
                                    label={t('music.create.rights')} onPress={() => edit({}, !state.rights)} /> : null}
                                {!input.instrumental && !state.rights ? <MusicNotice message={t('music.create.rights_required')} /> : null}
                            </>}
                        {input.mode === 'custom' && !input.instrumental ? <MusicLyricistProfiles api={api} lyrics={input.lyrics}
                            sessionGeneration={sessionGeneration} onOpenChat={id => router.push({ pathname: '/chat/[id]', params: { id } })} /> : null}
                        {input.mode === 'custom' && !input.instrumental && state.draft && model && lyricLimit ? <View style={s.assistant}>
                            <Text variant="title3">{t('music.lyricAssistant.title')}</Text>
                            <Text>{t('music.lyricAssistant.help')}</Text>
                            <TextField accessibilityLabel={t('music.lyricAssistant.request')} label={t('music.lyricAssistant.request')}
                                value={lyricRequest} maxLength={MUSIC_LYRIC_REQUEST_MAX} multiline onChangeText={setLyricRequest} />
                            <View style={s.row}>
                                <Button variant="secondary" label={t('music.lyricAssistant.manageProfiles')} onPress={() => router.push('/chat/personas')} />
                                <Button variant="secondary" label={t('music.lyricAssistant.work')} disabled={!lyricRequest.trim()}
                                    onPress={openLyricAssistant} />
                            </View>
                        </View> : null}
                        {lyricNotice ? <MusicNotice message={lyricNotice} /> : null}
                        {lyricReview && input.mode === 'custom' && !input.instrumental ? <View style={s.assistant}>
                            <Text variant="title3">{t('music.lyricAssistant.reviewTitle')}</Text>
                            <Text variant="bodyStrong">{t('music.lyricAssistant.proposal')}</Text>
                            <Text selectable>{lyricReview.lyrics}</Text>
                            <Text variant="bodyStrong">{t('music.lyricAssistant.currentDraft')}</Text>
                            <Text selectable>{input.lyrics || t('music.lyricAssistant.emptyDraft')}</Text>
                            <Text>{t('music.lyricAssistant.reviewHelp')}</Text>
                            <View style={s.row}>
                                <Button label={t('music.lyricAssistant.apply')} onPress={() => {
                                    const activeLimit = e && model ? effectiveLyricsLimit(model, e) : null;
                                    if (!activeLimit || Array.from(lyricReview.lyrics).length > activeLimit) {
                                        setLyricReview(null); setLyricNotice(t('music.lyricAssistant.overLength')); return;
                                    }
                                    if (input.mode !== 'custom' || input.instrumental || !state.draft || state.draft.id !== lyricReview.draftId
                                        || state.draft.revision !== lyricReview.draftRevision || input.lyrics !== lyricReview.sourceLyrics) {
                                        setLyricReview(null); setLyricNotice(t('music.lyricAssistant.stale')); return;
                                    }
                                    edit({ lyrics: lyricReview.lyrics }, false); setLyricReview(null); setLyricNotice(t('music.lyricAssistant.applied'));
                                }} />
                                <Button variant="secondary" label={t('music.lyricAssistant.discard')} onPress={() => setLyricReview(null)} />
                            </View>
                        </View> : null}
                        {directionError ? <MusicNotice message={directionError} /> : null}
                        {!suno ? <>
                            <TextField label={t('music.create.songTitle')} value={input.title} maxLength={Math.min(80, e.custom_drafts.title_max)} onChangeText={title => edit({ title })} />
                            <Text>{t('music.create.duration', { seconds: input.duration })}</Text>
                            <View style={s.row}>
                                <Button variant="secondary" label={t('music.create.shorter')} disabled={!model?.controls.duration_seconds || input.duration <= model.controls.duration_seconds.min} onPress={() => edit({ duration: input.duration - 5 })} />
                                <Button variant="secondary" label={t('music.create.longer')} disabled={!model?.controls.duration_seconds || input.duration >= model.controls.duration_seconds.max} onPress={() => edit({ duration: input.duration + 5 })} />
                            </View>
                            {model?.controls.duration_price_block_seconds === 60 ? <Text>{t('music.create.durationPriceHint')}</Text> : null}
                            {input.duration > 60 ? <Text>{t('music.create.longerGenerationHint')}</Text> : null}
                            {input.mode === 'simple' && model ? <MusicAdvancedControls input={input} controls={model.controls} onChange={edit} /> : null}
                        </> : null}
                        {state.conflict ? <View style={s.content}>
                            <Text>{t('music.create.conflict')}</Text>
                            <Text selectable>{state.conflict.title}</Text><Text selectable>{state.conflict.lyrics}</Text><Text selectable>{state.conflict.styles}</Text>
                            <Text>{state.conflict.model_id}</Text>
                            <Button label={t('music.create.useServer')} onPress={flow.useServer} />
                            <Button label={t('music.create.keepMine')} onPress={() => { flow.keepMine(); void flow.review(); }} />
                        </View> : null}
                        {state.previousText ? <View style={s.content}>
                            <MusicNotice message={t('music.create.draft_refreshed')} />
                            <Button variant="secondary" label={t('music.create.copy_previous_text')} onPress={flow.copyPreviousText} />
                        </View> : null}
                        {error ? <MusicNotice message={error} retry={input.mode === 'custom' && !state.draft ? () => void flow.loadDraft() : undefined} /> : null}
                        <Button label={t('music.create.review')} disabled={state.busy || ambiguous || !!state.conflict || (input.mode === 'custom' && !state.draft)
                            || quoteBlockers({ input, entitlements: e, rights: state.rights, activeCount: flow.tracker.activeCount() }).length > 0}
                            onPress={() => void flow.review()} />
                        {flow.tracker.activeCount() >= e.concurrency_limit ? <MusicNotice message={t('music.create.no_slot')} /> : null}
                        {pending ? <>
                            <MusicQuoteCard quote={pending.quote} />
                            {ambiguous ? <><Text>{t('music.create.recovery')}</Text><Text>{pending.input.title}</Text>
                                <MusicLyricsPanel value={pending.input.lyrics} instrumental={pending.input.instrumental} />
                                <Text>{t('music.create.discardBody')}</Text>
                                <Button variant="secondary" label={t('music.create.discard')} disabled={state.busy} onPress={() => flow.attempts.dismiss()} /></> : null}
                            {blockers.map(reason => <Text key={reason}>{t(`music.create.${messageKey(reason)}`)}</Text>)}
                            <Button label={ambiguous ? t('music.create.check') : t('music.create.confirm', { credits: pending.quote.total_credits })}
                                disabled={state.busy || blockers.length > 0} onPress={() => {
                                    if (lock.current) return;
                                    lock.current = true;
                                    void flow.confirm().finally(() => { lock.current = false; });
                                }} />
                        </> : null}
                        <MusicQueue entries={queue.entries} activeCount={flow.tracker.activeCount()} limit={e.concurrency_limit}
                            api={api} refresh={flow.tracker.refresh} afterCancel={flow.refreshEntitlements} />
                    </> : null}
    </SafeKeyboardFormScrollView>;
}
const sheets = themedStyles(p => ({ screen: { flex: 1, backgroundColor: p.bg }, content: { gap: ds.space.md }, row: { flexDirection: 'row', flexWrap: 'wrap', gap: ds.space.sm },
    assistant: { gap: ds.space.sm, padding: ds.space.md, borderWidth: 1, borderColor: p.borderSubtle, borderRadius: ds.radius.md } }));
