import { useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';
import { Button, Checkbox, Text, TextField, themedStyles, useThemedStyles } from '../../ui';
import { BeatModal } from '../BeatModal';
import { t } from '../../../lib/i18n';
import { ds } from '../../../theme';
import { AI_INSTRUMENTS, BEAT_AI_KEYS, actionEligibility, aiError, trackCapacity, placementIds } from '../../../lib/beatAi/shared';
import { buildDraft, phoneTranslator } from '../../../lib/beatAi/draft';
import { useBeatAiRequest } from '../../../lib/beatAi/useBeatAiRequest';
import type { ReceiptRequest } from '../../../lib/beatAi/request';
import type { BeatAiClient } from '../../../lib/beatAi/client';
import type { AiDoc, AudioRegion, Op, Pending, Selection, Song } from '../../../lib/beatAi/types';
import { promptDrafts } from '../../../lib/beatAi/drafts';
import { RequestControls } from './RequestControls';
export function BeatAiSheet({ request, client, doc, op, onClose }: { request: ReceiptRequest<Pending>; client: BeatAiClient; doc: AiDoc; op: Op; onClose(): void }) {
    const view = useBeatAiRequest(request), s = useThemedStyles(styles);
    const drafts = useMemo(() => promptDrafts(), []);
    const [draftReady, setDraftReady] = useState(!!view.record), [draftError, setDraftError] = useState(false);
    const [prompt, setPrompt] = useState(view.record?.prompt ?? '');
    useEffect(() => {
        let live = true;
        if (!view.record) void drafts.read(request.options.owner, doc.id, op).then(value => {
            if (live && request.current()) { setPrompt(value); setDraftReady(true); }
        }, () => { if (live && request.current()) { setDraftError(true); setDraftReady(true); } });
        return () => { live = false; };
    }, [drafts, request, doc.id, op, view.record]);
    const [key, setKey] = useState(''), [instrument, setInstrument] = useState(view.record?.instrument ?? AI_INSTRUMENTS[0]);
    const [rights, setRights] = useState(false), [selected, setSelected] = useState<Selection | null>(null);
    const [song, setSong] = useState<Song | null>(null), [songError, setSongError] = useState(false);
    const locked = !draftReady || !!view.quote || !!view.record || view.busy;
    const regions: Selection[] = doc.tracks.filter(track => track.kind === 'audio').flatMap(track => track.regions.map(r => {
        const region = r as AudioRegion; return { track, region, asset: doc.assets[region.assetId] };
    })).filter(item => item.asset?.source === 'song');
    useEffect(() => {
        let live = true; setSong(null); setSongError(false);
        if (selected) void client.song(selected.asset.ref.songId).then(value => { if (live && request.current()) setSong(value); }, () => { if (live && request.current()) setSongError(true); });
        return () => { live = false; };
    }, [selected, client, request]);
    let reason = '';
    if (!view.record) {
        if (op === 'stems') reason = t('beatAi.stemsWeb');
        else if (op !== 'generate' && !selected) reason = t('beatAi.chooseSource');
        else if (op === 'generate') reason = trackCapacity(doc, phoneTranslator);
        else if (selected) reason = songError ? t('beatAi.error') : actionEligibility(op, doc, selected.region, selected.asset, song, {}, phoneTranslator);
        if (!reason && ['generate', 'extend', 'replace'].includes(op) && (!prompt.trim() || prompt.trim().length > 400)) reason = t('beatAi.promptError');
        if (!reason && op !== 'generate' && !rights) reason = t('beatAi.rights');
    }
    let built: ReturnType<typeof buildDraft> | undefined;
    if (!reason && !view.record) {
        try { built = buildDraft(doc, op, prompt, key, instrument, rights, selected, song); }
        catch (error) { reason = aiError(error, op, phoneTranslator); }
    }
    const keyLabel = (value: string) => value ? t(value.endsWith('Major') ? 'beatAi.major' : 'beatAi.minor', { note: value.split(' ')[0] }) : t('beatAi.auto');
    const price = () => {
        const captured = built;
        if (!captured) return;
        void request.price(() => client.quote(op, captured.draft.source?.songId, captured.body), (quote, id) => {
            const key = `beat-ai.${id}`;
            return { ...captured.draft, owner: request.options.owner, beatId: doc.id, key, quoteId: quote.quote_id, quote, state: 'pending', createdAt: Date.now(), placementIds: placementIds(key) };
        });
    };
    return <BeatModal title={t(`beatAi.${op}`)} onClose={onClose}>
        {!view.record ? <>
            {['generate', 'extend', 'replace'].includes(op) ? <><TextField label={t('beatAi.prompt')} value={prompt} editable={!locked} maxLength={400} multiline
                onChangeText={value => { setPrompt(value); request.reset(); void drafts.write(request.options.owner, doc.id, op, value, request.current).catch(() => { if (request.current()) setDraftError(true); }); }} /></> : null}
            {op === 'generate' ? <><Text>{t('beatAi.key')}</Text><View style={s.options}>{['', ...BEAT_AI_KEYS].map(value => <Button key={value} size="md" variant={key === value ? 'primary' : 'secondary'} disabled={locked} label={keyLabel(value)} accessibilityLabel={t('beatAi.keyValue', { key: keyLabel(value) })} onPress={() => setKey(value)} />)}</View></> : null}
            {op !== 'generate' ? <><Text>{t('beatAi.chooseSource')}</Text>{regions.map(item => <Button key={item.region.id} disabled={locked} label={t('beatAi.source', { name: item.track.name, region: item.region.id })} variant={selected?.region.id === item.region.id ? 'primary' : 'secondary'} onPress={() => setSelected(item)} />)}
                <Checkbox checked={rights} disabled={locked} accessibilityLabel={t('beatAi.rights')} onChange={setRights}><Text>{t('beatAi.rights')}</Text></Checkbox></> : null}
            {op === 'targetStems' ? <><Text>{t('beatAi.instrument')}</Text>{AI_INSTRUMENTS.map(value => <Button key={value} disabled={locked} variant={instrument === value ? 'primary' : 'secondary'} label={t(`musicTargetStems.instrument.${value}`)} onPress={() => setInstrument(value)} />)}</> : null}
            <Text>{t('beatAi.cycle', { bars: (doc.cycle.end - doc.cycle.start) / 3840, seconds: ((doc.cycle.end - doc.cycle.start) * 60 / doc.tempo.bpm / 960).toFixed(1) })}</Text>
            {reason ? <Text accessibilityLiveRegion="polite">{reason}</Text> : null}
            {!view.quote ? <Button label={t('beatAi.price')} disabled={view.busy || view.offline || !!reason || !built} onPress={price} /> : null}
        </> : <Text>{view.record.prompt}</Text>}
        {draftError ? <Text>{t('beatAi.error')}</Text> : null}
        <RequestControls request={request} view={view} elapsed={view.elapsed} offline={view.offline} />
        <Button label={t('beatAi.close')} disabled={view.busy} onPress={onClose} />
    </BeatModal>;
}
const styles = themedStyles(() => ({ options: { gap: ds.space.sm } }));
