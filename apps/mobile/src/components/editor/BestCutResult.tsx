import { useEffect, useState } from 'react';
import { Modal, ScrollView, View } from 'react-native';
import { Button, Chip, Text } from '../ui';
import type { ApiClient } from '../../lib/api';
import { framesIn, type Timeline } from '../../lib/nativeEditorModel';
import type { BestCutPlan } from '../../lib/bestCutPlan';
import { t } from '../../lib/i18n';
import { createFrameStore } from './editorFrameStore';
import { PlaybackPreview, PlaybackTransport } from './EditorPlayback';
import { colors } from '../../theme';
export function BestCutResult({ before, after, plan, api, uris, onOpen, captionsOmitted, refunded }: { onOpen(): void; before: Timeline; after: Timeline; plan: BestCutPlan | null; api: ApiClient; uris: Record<string, string>; captionsOmitted?: boolean; refunded?: number }) {
    const [open, setOpen] = useState(false), [view, setView] = useState<'before' | 'after'>('after'), [details, setDetails] = useState(false);
    const [playing, setPlaying] = useState(false), [store] = useState(createFrameStore);
    const timeline = view === 'before' ? before : after, total = framesIn(timeline);
    useEffect(() => { if (!playing || !open) return; const timer = setInterval(() => { const next = store.get() + 1; if (next >= total) { setPlaying(false); store.set(0); } else store.set(next); }, 1000 / timeline.fps); return () => clearInterval(timer); }, [playing, open, total, timeline.fps, store]);
    return <><View style={{ gap: 8 }}>{plan?.warnings.map(w => <Text key={w}>{t(`bestCut.warning.${w}`)}</Text>)}
        {captionsOmitted ? <Text>{t('bestCut.captionsOmitted')}</Text> : null}
        {refunded ? <Text>{t('bestCut.refunded', { n: refunded })}</Text> : null}</View>
    <View style={{ flexDirection: 'row', gap: 8 }}>
        <Chip label={t('bestCut.before')} selected={open && view === 'before'} onPress={() => { onOpen(); setView('before'); store.set(0); setOpen(true); }} />
        <Chip label={t('bestCut.afterView')} selected={!open || view === 'after'} onPress={() => { onOpen(); setView('after'); store.set(0); setOpen(true); }} />
    </View><Modal visible={open} onRequestClose={() => { setOpen(false); setPlaying(false); }} animationType="slide">
        <ScrollView contentContainerStyle={{ padding: 24, paddingTop: 60, gap: 16, backgroundColor: colors.background }}>
            <Text>{t('bestCut.readOnly')}</Text><View style={{ flexDirection: 'row', gap: 8 }}>{(['before', 'after'] as const).map(v => <Chip key={v} label={t(v === 'before' ? 'bestCut.before' : 'bestCut.afterView')} selected={v === view} onPress={() => { setView(v); setPlaying(false); store.set(0); }} />)}</View>
            <View style={{ height: 320 }}><PlaybackPreview frameStore={store} timeline={timeline} api={api} playing={playing} localMediaUris={uris} /></View>
            <PlaybackTransport frameStore={store} total={total} fps={timeline.fps} playing={playing} onSeek={store.set} onPlaying={setPlaying} />
            <Button variant="secondary" label={t('bestCut.changed')} onPress={() => setDetails(v => !v)} />
            {details && plan ? <><Text>{t('bestCut.dropped', { n: plan.droppedClips })}</Text><Text>{t('bestCut.summary', { pauses: plan.removedPauses, retakes: plan.removedRetakes, matched: plan.matchedLines })}</Text>
                {plan.ranges.map((r, i) => <Button key={i} variant="tertiary" label={`${(r.from / plan.fps).toFixed(2)}–${(r.to / plan.fps).toFixed(2)} · ${r.label}`} onPress={() => { setView('after'); setPlaying(false); store.set(r.start); }} />)}
                {!!plan.missingLines.length && <Text>{t('bestCut.missing', { lines: plan.missingLines.join(', ') })}</Text>}</> : null}
            <Button label={t('bestCut.close')} onPress={() => { setOpen(false); setPlaying(false); }} />
        </ScrollView></Modal></>;
}
