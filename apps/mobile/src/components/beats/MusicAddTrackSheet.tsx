import { SimpleEditorSheet, type SheetRow } from '../editor/SimpleEditorChrome';
import { t } from '../../lib/i18n';

type Props = {
    disabled: boolean;
    busy?: boolean;
    onLibrary(): void;
    onDevice(): void;
    onRecord(): void;
    onDrums(): void;
    onInstrument(): void;
    onClose(): void;
};

export function MusicAddTrackSheet({ disabled, busy = false, onLibrary, onDevice, onRecord, onDrums, onInstrument, onClose }: Props) {
    const blocked = disabled || busy;
    const rows: readonly SheetRow[] = [
        { id: 'library', icon: 'folder', label: t('beat.track.library'), disabled: blocked, onPress: onLibrary },
        { id: 'device', icon: 'arrowUp', label: t(busy ? 'beat.track.deviceBusy' : 'beat.track.device'), disabled: blocked, onPress: onDevice },
        { id: 'record', icon: 'microphone', label: t('beatTakes.addTrack'), disabled: blocked, onPress: onRecord },
        { id: 'drums', icon: 'waveform', label: t('beat.kind.drums'), disabled: blocked, onPress: onDrums },
        { id: 'instrument', icon: 'pianoKeys', label: t('beatPiano.library.add'), disabled: blocked, onPress: onInstrument },
    ];
    return <SimpleEditorSheet title={t('beat.track.add')} rows={rows} onClose={onClose} />;
}
