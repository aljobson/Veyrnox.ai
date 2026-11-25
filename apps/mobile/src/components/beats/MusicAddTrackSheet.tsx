import { View } from 'react-native';
import { Button, Icon, Text, themedStyles, useThemedStyles } from '../ui';
import { t } from '../../lib/i18n';
import { ds } from '../../theme';
import type { MenuIcon } from '../../lib/menuIcons';
import { BeatModal } from './BeatModal';

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
    const s = useThemedStyles(sheets);
    const choose = (action: () => void) => {
        onClose();
        action();
    };
    return <BeatModal title={t('beat.track.add')} testID="music-add-track-sheet" onClose={onClose}>
        <Button testID="music-add-track-close" size="md" variant="tertiary" icon="close" iconOnly
            label={t('beat.pattern.cancel')} onPress={onClose} containerStyle={s.close} />
        <View style={s.options}>
            <TrackChoice testID="music-add-track-library" icon="folder" title={t('beat.track.library')} disabled={disabled || busy} onPress={() => choose(onLibrary)} />
            <TrackChoice testID="music-add-track-device" icon="arrowUp" title={t(busy ? 'beat.track.deviceBusy' : 'beat.track.device')} disabled={disabled || busy} onPress={() => choose(onDevice)} />
            <TrackChoice testID="music-add-track-record" icon="microphone" title={t('beatTakes.addTrack')} disabled={disabled || busy} onPress={() => choose(onRecord)} />
            <TrackChoice testID="music-add-track-drums" icon="waveform" title={t('beat.kind.drums')} disabled={disabled || busy} onPress={() => choose(onDrums)} />
            <TrackChoice testID="music-add-track-instrument" icon="pianoKeys" title={t('beatPiano.library.add')} disabled={disabled || busy} onPress={() => choose(onInstrument)} />
        </View>
    </BeatModal>;
}

function TrackChoice({ testID, icon, title, disabled, onPress }: {
    testID: string; icon: MenuIcon; title: string; disabled: boolean; onPress(): void;
}) {
    const s = useThemedStyles(sheets);
    return <Button testID={testID} variant="tertiary" disabled={disabled}
        label={title} onPress={onPress} style={s.choice}><View style={s.label}><View style={s.icon}><Icon name={icon} size={24} /></View><View style={s.copy}>
            <Text variant="bodyStrong">{title}</Text>
        </View><Icon name="caretRight" size={20} /></View></Button>;
}

const sheets = themedStyles(p => ({
    close: { alignSelf: 'flex-end', marginTop: -56 },
    options: { gap: ds.space.xs, marginTop: ds.space.sm, padding: ds.space.sm, borderRadius: ds.radius.lg, backgroundColor: p.bgElevated1 },
    choice: { paddingHorizontal: ds.space.sm, justifyContent: 'flex-start', borderRadius: ds.radius.md },
    label: { width: '100%', flexDirection: 'row', alignItems: 'center', gap: ds.space.md, paddingVertical: ds.space.xs },
    icon: { width: 40, height: 40, borderRadius: ds.radius.md, alignItems: 'center', justifyContent: 'center', backgroundColor: p.surface },
    copy: { flex: 1, gap: ds.space.xs },
}));
