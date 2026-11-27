import { Fragment, useEffect, useMemo, useState } from 'react';
import { Button, Text, TextField } from '../../ui';
import { t } from '../../../lib/i18n';
import { barChoices, magicQuoteBody, requestSeconds, MAGIC_LAYER_LIMIT } from '../../../lib/beatAi/shared';
import { ReceiptRequest } from '../../../lib/beatAi/request';
import { magicPendingStore } from '../../../lib/beatAi/magicPending';
import { magicLayers } from '../../../lib/beatAi/magicLayers';
import { useBeatAiRequest } from '../../../lib/beatAi/useBeatAiRequest';
import type { BeatAiClient } from '../../../lib/beatAi/client';
import { uuid } from '../../../lib/beatAi/client';
import type { AiDoc, Candidate, Layer, MagicPending } from '../../../lib/beatAi/types';
import { RequestControls } from './RequestControls';
export function BeatMagicBar({ doc, client, owner, current, off, disabled = false }: { doc: AiDoc; client: BeatAiClient; owner: string; current(): boolean; off(): void; disabled?: boolean }) {
    const layersStore = useMemo(() => magicLayers(), []);
    const request = useMemo(() => new ReceiptRequest<MagicPending>({ owner, beatId: doc.id, client, current, off, storage: magicPendingStore(),
        async finish(row, status) {
            if (['failed', 'refunded'].includes(status.state)) return { noticeKey: 'beatAi.failed' };
            return { keep: { ...row, terminal: status.state, candidates: status.candidates ?? [] }, noticeKey: 'beatAi.results' };
        },
    }), [owner, doc.id, client, current, off]);
    const view = useBeatAiRequest(request);
    const [prompt, setPrompt] = useState(''), [bars, setBars] = useState(barChoices(doc.tempo.bpm)[0]);
    const [layers, setLayers] = useState<Layer[]>([]), [error, setError] = useState(false), [adding, setAdding] = useState(false);
    useEffect(() => {
        void request.initialize();
        void layersStore.read(owner, doc.id).then(value => { if (current()) setLayers(value); }, () => { if (current()) setError(true); });
        return () => request.dispose();
    }, [request, layersStore, owner, doc.id, current]);
    const valid = prompt.trim().length > 0 && prompt.trim().length <= 400 && barChoices(doc.tempo.bpm).includes(bars) && doc.tempo.bpm >= 40 && doc.tempo.bpm <= 220;
    const price = () => {
        request.open();
        const bpm = doc.tempo.bpm, capturedPrompt = prompt;
        void request.price(() => client.quote('generate', undefined, magicQuoteBody({ prompt: capturedPrompt, bpm, bars, title: doc.title })), (quote, id) => ({
            owner, beatId: doc.id, quoteId: quote.quote_id, quote, key: `magic.${id}`, prompt: capturedPrompt, bars, bpm, createdAt: Date.now(),
        }));
    };
    const editLayers = async (edit: (rows: Layer[]) => Layer[]) => {
        if (disabled || !current()) return;
        setError(false);
        try {
            await layersStore.change(owner, doc.id, edit, current);
            if (!current()) return;
            const saved = await layersStore.read(owner, doc.id);
            if (current()) setLayers(saved);
        } catch { if (current()) setError(true); }
    };
    const add = async (candidate: Candidate) => {
        const row = request.snapshot().record;
        if (disabled || !row || !current() || adding || !uuid(candidate.song_id) || !uuid(candidate.job_id)) return;
        setAdding(true); setError(false);
        const layer: Layer = { songId: candidate.song_id, audioUrl: `/api/v1/jobs/${candidate.job_id}/asset`, title: candidate.title || row.prompt, bars: row.bars, bpm: row.bpm, muted: false };
        try {
            await layersStore.change(owner, doc.id, rows => rows.some(r => r.songId === layer.songId) ? rows : [...rows, layer], current);
            if (!current()) return;
            const saved = await layersStore.read(owner, doc.id);
            if (!current()) return;
            if (!saved.some(r => r.songId === layer.songId)) throw new Error('layer_not_saved');
            setLayers(saved);
            // Success candidates survive relaunch until a layer is durably saved.
            await request.discard();
        } catch { if (current()) setError(true); }
        finally { if (current()) setAdding(false); }
    };
    const locked = view.busy || !!view.quote || !!view.record;
    return <>
        <Text variant="title3">{t('beatAi.magic')}</Text>
        <TextField label={t('beatAi.prompt')} value={view.record?.prompt ?? prompt} maxLength={400} editable={!locked && !disabled} onChangeText={setPrompt} />
        {!locked ? barChoices(doc.tempo.bpm).map(value => <Button key={value} variant={bars === value ? 'primary' : 'secondary'} label={t('beatAi.bars', { bars: value, seconds: requestSeconds(doc.tempo.bpm, value) })} disabled={disabled} onPress={() => setBars(value)} />) : null}
        {!view.quote && !view.record ? <Button label={t('beatAi.priceLoops')} disabled={disabled || !valid || view.busy || view.offline} onPress={price} /> : null}
        {view.rows.map(row => <Button key={row.key} label={t('beatAi.resume', { name: row.prompt })} disabled={disabled || view.busy || adding} onPress={() => void request.resume(row)} />)}
        <RequestControls request={request} view={view} elapsed={view.elapsed} offline={view.offline} disabled={disabled} />
        {(view.record?.candidates ?? view.status?.candidates)?.map(candidate => <ReactCandidate key={candidate.ordinal} candidate={candidate} disabled={disabled || adding || !view.record?.terminal || layers.length >= MAGIC_LAYER_LIMIT || view.busy} onAdd={() => void add(candidate)} />)}
        <Text>{t('beatAi.noPlayback')}</Text>
        {layers.map(layer => <Fragment key={layer.songId}>
            <Text key={`title-${layer.songId}`}>{layer.title}</Text>
            <Button key={`mute-${layer.songId}`} label={t(layer.muted ? 'beatAi.unmute' : 'beatAi.mute', { name: layer.title })} disabled={disabled} onPress={() => void editLayers(rows => rows.map(r => r.songId === layer.songId ? { ...r, muted: !r.muted } : r))} />
            <Button key={`remove-${layer.songId}`} label={t('beatAi.remove', { name: layer.title })} disabled={disabled} onPress={() => void editLayers(rows => rows.filter(r => r.songId !== layer.songId))} />
        </Fragment>)}
        {layers.length >= MAGIC_LAYER_LIMIT ? <Text>{t('beatAi.layerLimit')}</Text> : null}
        {error ? <Text accessibilityRole="alert">{t('beatAi.error')}</Text> : null}
    </>;
}
function ReactCandidate({ candidate, disabled, onAdd }: { candidate: Candidate; disabled: boolean; onAdd(): void }) {
    const ready = ['ready', 'stored', 'succeeded'].includes(candidate.state.toLowerCase());
    return <>
        <Text>{t('beatAi.candidate', { label: candidate.ordinal === 1 ? 'A' : 'B', state: t(ready ? 'beatAi.ready' : ['failed', 'refunded'].includes(candidate.state) ? 'beatAi.failed' : 'beatAi.waiting') })}</Text>
        <Button label={t('beatAi.add', { label: candidate.ordinal === 1 ? 'A' : 'B' })} disabled={disabled || !ready || !uuid(candidate.song_id) || !uuid(candidate.job_id)} onPress={onAdd} />
    </>;
}
