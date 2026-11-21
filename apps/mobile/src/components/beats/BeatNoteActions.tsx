import { View } from 'react-native';
import { Button, useThemedStyles } from '../ui';
import { pianoStyles } from './pianoStyles';
import { t } from '../../lib/i18n';
export type NoteActions = { move(ticks: number, pitch: number, keys?: string[]): void; resize(delta: number, keys?: string[]): void; velocity(delta: number, keys?: string[]): void; remove(): void; selectAll(): void; clear(): void };
export function BeatNoteActions({ actions, unit, disabled }: { actions: NoteActions; unit: number; disabled: boolean }) {
    const s = useThemedStyles(pianoStyles);
    const buttons: [string, () => void][] = [
        [t('beatPiano.left'), () => actions.move(-unit, 0)], [t('beatPiano.right'), () => actions.move(unit, 0)],
        [t('beatPiano.up'), () => actions.move(0, 1)], [t('beatPiano.down'), () => actions.move(0, -1)],
        [t('beatPiano.selected.octaveDown'), () => actions.move(0, -12)], [t('beatPiano.selected.octaveUp'), () => actions.move(0, 12)],
        [t('beatPiano.shorter'), () => actions.resize(-unit)], [t('beatPiano.longer'), () => actions.resize(unit)],
        [t('beatPiano.velocityDown'), () => actions.velocity(-16)], [t('beatPiano.velocityUp'), () => actions.velocity(16)],
        [t('beatPiano.delete'), actions.remove], [t('beatPiano.selectAll'), actions.selectAll], [t('beatPiano.clear'), actions.clear],
    ];
    return <View style={s.row} accessibilityLabel={t('beatPiano.actions')}>
        {buttons.map(([label, onPress]) => <Button key={label} label={label} accessibilityLabel={label} disabled={disabled} onPress={onPress} />)}
    </View>;
}
