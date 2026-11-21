import { useState } from 'react';
import { View } from 'react-native';
import { Button } from '../ui';
import { t } from '../../lib/i18n';
import type { BeatDoc, Edit } from '../../lib/beatNative/doc';
import { addAudioRegion, soundAsset, type TipId } from '../../lib/beatNative/labs';
import type { PhoneCapability } from '../../lib/beatNative/controls';
import { BeatSoundsSheet } from './BeatSoundsSheet';
import { BeatControlsSheet } from './BeatControlsSheet';
import { BeatCoachCard } from './BeatCoachCard';
import { useBeatCoachMarks } from './useBeatCoachMarks';
import { tipTargetsForView } from '../../lib/beatNative/coachMarks';
export function BeatLabsBar({ doc, apply, targets, capabilities }: {
    doc: BeatDoc; apply(operation: Edit, announce?: string): boolean; targets: ReadonlySet<TipId>; capabilities: ReadonlySet<PhoneCapability>;
}) {
    const [sheet, setSheet] = useState<'sounds' | 'controls' | null>(null);
    const coach = useBeatCoachMarks(tipTargetsForView(targets, doc.view === 'song' ? 'song' : 'pattern'));
    return <View>
        <Button label={t('beatLabs.sounds')} onPress={() => setSheet('sounds')} />
        <Button label={t('beatLabs.controls')} onPress={() => setSheet('controls')} />
        {sheet === 'sounds' ? <BeatSoundsSheet bpm={doc.tempo.bpm} onClose={() => setSheet(null)}
            onAdd={sound => apply(current => addAudioRegion(current, soundAsset(sound, current.tempo.bpm), undefined, 0), t('beatLabs.added'))} /> : null}
        {sheet === 'controls' ? <BeatControlsSheet capabilities={capabilities} canReplay={coach.canReplay} onClose={() => setSheet(null)} onReplay={coach.replay} /> : null}
        {!sheet && coach.step ? <BeatCoachCard id={coach.step.id} last={coach.last} onNext={coach.next} onSkip={coach.skip} /> : null}
    </View>;
}
