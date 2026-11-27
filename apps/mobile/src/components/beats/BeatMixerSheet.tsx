import { useState } from 'react';
import { MusicNotice } from '../music/MusicNotice';
import { BeatModal } from './BeatModal';
import { BeatChannelStrip } from './BeatChannelStrip';
import { BeatMasterStrip } from './BeatMasterStrip';
import { BeatAutomationLane } from './BeatAutomationLane';
import type { BeatAudio } from '../../lib/beatNative/audio';
import type { BeatDoc } from '../../lib/beatNative/doc';
import type { MixDoc, MixTrack, MixApply, Lane } from '../../lib/beatNative/mix';
import { t } from '../../lib/i18n';

export function BeatMixerSheet({ doc, audio, apply, playing, step, notice, onClose }: {
    doc: BeatDoc; audio: BeatAudio | null; apply: MixApply; playing: boolean; step: number | null; notice?: string | null; onClose(): void;
}) {
    const [lane, setLane] = useState<{ id: string; lane: Lane } | null>(null);
    const [details, setDetails] = useState<{ kind: 'track'; id: string } | { kind: 'master' } | null>(null);
    const mix = doc as MixDoc;
    const selected = mix.tracks.find(track => track.id === lane?.id) as MixTrack | undefined;
    return <BeatModal title={t('beatMix.title')} closeLabel={t('beatMix.close')} onClose={onClose}>
        {notice ? <MusicNotice message={notice} /> : null}
        {mix.tracks.map(track => <BeatChannelStrip key={track.id} track={track} doc={mix} audio={audio} apply={apply}
            expanded={details?.kind === 'track' && details.id === track.id}
            onToggle={() => { setLane(null); setDetails(value => value?.kind === 'track' && value.id === track.id ? null : { kind: 'track', id: track.id }); }}
            onLane={value => { setDetails({ kind: 'track', id: track.id }); setLane({ id: track.id, lane: value }); }} />)}
        <BeatMasterStrip doc={mix} audio={audio} apply={apply} expanded={details?.kind === 'master'}
            onToggle={() => { setLane(null); setDetails(value => value?.kind === 'master' ? null : { kind: 'master' }); }} />
        {selected && lane && <BeatAutomationLane key={`${selected.id}:${lane.lane}`} doc={mix} track={selected} lane={lane.lane} playing={playing} step={step} apply={apply} onHide={() => setLane(null)} />}
    </BeatModal>;
}
