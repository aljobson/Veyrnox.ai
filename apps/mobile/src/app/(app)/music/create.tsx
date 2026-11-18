import { useEffect, useRef, useState } from 'react';
import { Stack } from 'expo-router';
import { ScrollView, Switch, View } from 'react-native';
import { Button, SegmentedControl, Text, TextField, themedStyles, useThemedStyles } from '../../../components/ui';
import { MusicQuoteCard } from '../../../components/music/MusicQuoteCard';
import { MusicQueue } from '../../../components/music/MusicQueue';
import { MusicLyricsPanel } from '../../../components/music/MusicLyricsPanel';
import { MusicNotice } from '../../../components/music/MusicNotice';
import { useMusicCreate } from '../../../lib/music/useMusicCreate';
import { modelState, quoteBlockers } from '../../../lib/music/createForm';
import { t } from '../../../lib/i18n';
import { ds } from '../../../theme';
const KNOWN = new Set(['empty_prompt', 'over_length', 'locked_plan', 'unavailable', 'rights', 'no_slot', 'not_affordable', 'quote_expired', 'quote_stale', 'quote_already_used', 'conflict', 'prompt_not_allowed', 'model_unavailable', 'plan_unavailable']);
const messageKey = (code: string) => code === 'rights' ? 'rights_required' : KNOWN.has(code) ? code : 'error';
export default function MusicCreate() {
    const { flow, state, pending, queue } = useMusicCreate(), s = useThemedStyles(sheets);
    const lock = useRef(false);
    const [now, setNow] = useState(Date.now);
    useEffect(() => {
        if (!pending || pending.phase === 'AMBIGUOUS') return;
        const timer = setTimeout(() => setNow(Date.now()), Math.min(2147483647, Math.max(0, Date.parse(pending.quote.expires_at) - Date.now()) + 1));
        return () => clearTimeout(timer);
    }, [pending]);
    const e = state.entitlements, input = state.input;
    const model = e?.models.find(m => m.id === input.model_id);
    const ambiguous = pending?.phase === 'AMBIGUOUS';
    const blockers = e && pending ? quoteBlockers({ input: pending.input, entitlements: e, rights: !pending.input.instrumental,
        activeCount: flow.tracker.activeCount(), quote: pending.quote, now, ambiguous }) : [];
    const error = state.error && t(`music.create.${messageKey(state.error)}`);
    return <ScrollView style={s.screen} contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
        <Stack.Screen options={{ title: t('music.create.title') }} />
        {state.status === 'off' ? <MusicNotice message={t('music.off')} />
            : state.status === 'loading' ? <Text>{t('music.loading')}</Text>
                : state.status === 'error' ? <MusicNotice message={t('music.loadError')} retry={() => void flow.load()} />
                    : e ? <>
                        <Text variant="title1">{t('music.create.title')}</Text>
                        <SegmentedControl value={input.mode} options={(['simple', 'custom'] as const).map(value => ({ value, label: t(`music.create.${value}`) }))}
                            onChange={mode => flow.edit({ mode })} />
                        <View style={s.row}>{e.models.filter(m => m.generation_modes.includes(input.mode)).map(m => {
                            const status = modelState(m, e);
                            return <Button key={m.id} variant={input.model_id === m.id ? 'primary' : 'secondary'}
                                label={status === 'locked_plan' ? t('music.create.paidModel', { model: m.name }) : m.name}
                                disabled={status !== 'usable'} onPress={() => { if (status === 'usable') flow.edit({ model_id: m.id }); }} />;
                        })}</View>
                        {input.mode === 'simple' ? <TextField label={t('music.create.prompt')} value={input.prompt} multiline maxLength={500} onChangeText={prompt => flow.edit({ prompt })} />
                            : <>
                                <MusicLyricsPanel value={input.lyrics} max={Math.min(3000, e.custom_drafts.lyrics_max)} onChange={lyrics => flow.edit({ lyrics })} />
                                <TextField label={t('music.create.styles')} value={input.styles} maxLength={Math.min(500, e.custom_drafts.styles_max)} onChangeText={styles => flow.edit({ styles })} />
                                {model?.controls.instrumental === 'optional' && model.controls.lyrics ? <View style={s.row}>
                                    <Text>{t('music.create.instrumental')}</Text><Switch accessibilityLabel={t('music.create.instrumental')} value={input.instrumental} onValueChange={instrumental => flow.edit({ instrumental })} />
                                </View> : null}
                                {!input.instrumental ? <Button variant="secondary" accessibilityRole="checkbox" accessibilityState={{ checked: state.rights }}
                                    label={t('music.create.rights')} onPress={() => flow.edit({}, !state.rights)} /> : null}
                                {!input.instrumental && !state.rights ? <MusicNotice message={t('music.create.rights_required')} /> : null}
                            </>}
                        <TextField label={t('music.create.songTitle')} value={input.title} maxLength={Math.min(80, e.custom_drafts.title_max)} onChangeText={title => flow.edit({ title })} />
                        <Text>{t('music.create.duration', { seconds: input.duration })}</Text>
                        <View style={s.row}>
                            <Button variant="secondary" label={t('music.create.shorter')} onPress={() => flow.edit({ duration: input.duration - 5 })} />
                            <Button variant="secondary" label={t('music.create.longer')} onPress={() => flow.edit({ duration: input.duration + 5 })} />
                        </View>
                        {state.conflict ? <View style={s.content}>
                            <Text>{t('music.create.conflict')}</Text>
                            <Text selectable>{state.conflict.title}</Text><Text selectable>{state.conflict.lyrics}</Text><Text selectable>{state.conflict.styles}</Text>
                            <Text>{state.conflict.model_id}</Text>
                            <Button label={t('music.create.useServer')} onPress={flow.useServer} />
                            <Button label={t('music.create.keepMine')} onPress={() => { flow.keepMine(); void flow.review(); }} />
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
                        <MusicQueue entries={queue.entries} activeCount={flow.tracker.activeCount()} limit={e.concurrency_limit} />
                    </> : null}
    </ScrollView>;
}
const sheets = themedStyles(p => ({ screen: { flex: 1, backgroundColor: p.bg }, content: { padding: ds.space.lg, gap: ds.space.md }, row: { flexDirection: 'row', flexWrap: 'wrap', gap: ds.space.sm } }));
