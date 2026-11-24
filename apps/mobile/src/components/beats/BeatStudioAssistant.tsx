import { useState } from 'react';
import { View } from 'react-native';
import { Button, Card, Text, TextField } from '../ui';
import { plural, t } from '../../lib/i18n';
import { ds } from '../../theme';
import type { BeatDoc } from '../../lib/beatNative/doc';
import { musicStudioProposalCurrent, planMusicStudioAction, type MusicStudioOperation, type MusicStudioResult } from '../../../../../lib/musicStudioActions.mjs';

const VALUE_KEYS = { on: 'studioAssistant.value_on', off: 'studioAssistant.value_off' } as const;
const STATE_KEYS = { yes: 'studioAssistant.state_yes', no: 'studioAssistant.state_no' } as const;
const VIEW_KEYS = { song: 'beat.view.song', pattern: 'beat.view.pattern' } as const;

const message = (entry: MusicStudioResult) => {
    const params = { ...entry.params };
    if ('value' in params && (params.value === 'on' || params.value === 'off')) params.value = t(VALUE_KEYS[params.value]);
    if ('view' in params && (params.view === 'song' || params.view === 'pattern')) params.view = t(VIEW_KEYS[params.view]);
    if ('value' in params && (params.value === 'song' || params.value === 'pattern')) params.value = t(VIEW_KEYS[params.value]);
    return entry.code === 'tracks' ? plural(entry.messageKey, Number(params.count)) : t(entry.messageKey, params);
};

export function BeatStudioAssistant({ doc, magicBar, readOnly, recording, busy, applyOperation, announce }: {
    doc: BeatDoc; magicBar: boolean; readOnly: boolean; recording: boolean; busy: boolean;
    applyOperation(operation: MusicStudioOperation): boolean;
    announce(message: string): void;
}) {
    const [prompt, setPrompt] = useState('');
    const [result, setResult] = useState<MusicStudioResult | null>(null);
    const [history, setHistory] = useState<readonly MusicStudioResult[]>([]);
    const visibleResult = result?.kind === 'proposal' && !musicStudioProposalCurrent(result, doc)
        ? { kind: 'error' as const, code: 'changed', messageKey: 'studioAssistant.changed', params: {} } as MusicStudioResult : result;
    const ask = () => {
        const planned = planMusicStudioAction({ input: prompt, document: doc, capabilities: { studioChat: true, magicBar }, editability: { readOnly, recording, busy } });
        if (result && result.kind !== 'proposal') setHistory(items => [...items.slice(-5), result]);
        setResult(planned);
        announce(message(planned));
    };
    const apply = () => {
        if (result?.kind !== 'proposal') return;
        if (!musicStudioProposalCurrent(result, doc)) {
            const changed = { kind: 'error' as const, code: 'changed', messageKey: 'studioAssistant.changed', params: {} } as MusicStudioResult;
            setResult(changed); announce(message(changed)); return;
        }
        const liveMix = result.operation.type === 'set_track_mute' || result.operation.type === 'set_track_solo';
        if (readOnly || busy || (recording && !liveMix)) return;
        if (!applyOperation(result.operation)) return;
        const done = { kind: 'answer' as const, code: 'applied', messageKey: 'studioAssistant.applied', params: {} } as MusicStudioResult;
        setResult(done);
    };
    const trackLines = (entry: MusicStudioResult) => entry.kind !== 'proposal' && entry.tracks?.map(track =>
        <Text key={track.index} variant="footnote">{t('studioAssistant.track_line', { ...track, mute: t(STATE_KEYS[track.mute ? 'yes' : 'no']), solo: t(STATE_KEYS[track.solo ? 'yes' : 'no']) })}</Text>);
    return <Card accessibilityLabel={t('studioAssistant.title')} style={{ gap: ds.space.md }}>
        <View style={{ gap: ds.space.xs }}><Text variant="title3">{t('studioAssistant.title')}</Text><Text variant="footnote" tone="secondary">{t('studioAssistant.body')}</Text></View>
        <TextField label={t('studioAssistant.prompt')} placeholder={t('studioAssistant.placeholder')} value={prompt} maxLength={200} returnKeyType="done" onChangeText={setPrompt} onSubmitEditing={ask} />
        <Button label={t('studioAssistant.ask')} disabled={!prompt.trim()} onPress={ask} />
        {history.length ? <View accessibilityLabel={t('studioAssistant.title')} style={{ gap: ds.space.xs }}>{history.map((entry, index) => <View key={`${index}-${entry.code}`}><Text variant="footnote" tone="secondary">{message(entry)}</Text>{trackLines(entry)}</View>)}</View> : null}
        {visibleResult?.kind === 'proposal' ? <Card style={{ gap: ds.space.sm }}><Text variant="bodyStrong" tone="accent">{t('studioAssistant.local')}</Text><Text>{message(visibleResult)}</Text><View style={{ gap: ds.space.sm }}><Button label={t('studioAssistant.apply')} disabled={readOnly || busy || (recording && visibleResult.operation.type !== 'set_track_mute' && visibleResult.operation.type !== 'set_track_solo')} onPress={apply} /><Button variant="secondary" label={t('studioAssistant.cancel')} onPress={() => setResult(null)} /></View></Card>
            : visibleResult ? <View><Text>{message(visibleResult)}</Text>{trackLines(visibleResult)}</View> : null}
    </Card>;
}
