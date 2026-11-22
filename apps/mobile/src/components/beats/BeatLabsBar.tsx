import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
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
import { ds } from '../../theme';
export function BeatLabsBar({ doc, apply, targets, capabilities, showSounds = true }: {
    doc: BeatDoc; apply(operation: Edit, announce?: string): boolean; targets: ReadonlySet<TipId>; capabilities: ReadonlySet<PhoneCapability>;
    showSounds?: boolean;
}) {
    const [sheet, setSheet] = useState<'sounds' | 'controls' | null>(null);
    const coach = useBeatCoachMarks(tipTargetsForView(targets, doc.view === 'song' ? 'song' : 'pattern'));
    useEffect(() => { if (!showSounds && sheet === 'sounds') setSheet(null); }, [showSounds, sheet]);
    const activeSheet = sheet === 'sounds' && !showSounds ? null : sheet;
    return <View style={styles.group}>
        {showSounds ? <Button variant="secondary" label={t('beatLabs.sounds')} onPress={() => setSheet('sounds')} /> : null}
        <Button variant="secondary" label={t('beatLabs.controls')} onPress={() => setSheet('controls')} />
        {activeSheet === 'sounds' ? <BeatSoundsSheet bpm={doc.tempo.bpm} onClose={() => setSheet(null)}
            onAdd={sound => apply(current => addAudioRegion(current, soundAsset(sound, current.tempo.bpm), undefined, 0), t('beatLabs.added'))} /> : null}
        {activeSheet === 'controls' ? <BeatControlsSheet capabilities={capabilities} canReplay={coach.canReplay} onClose={() => setSheet(null)} onReplay={coach.replay} /> : null}
        {!activeSheet && coach.step ? <BeatCoachCard id={coach.step.id} last={coach.last} onNext={coach.next} onSkip={coach.skip} /> : null}
    </View>;
}
const styles = StyleSheet.create({ group: { gap: ds.space.sm } });
