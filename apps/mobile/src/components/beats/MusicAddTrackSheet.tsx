import { View } from 'react-native';
import { Button, Icon, Text, themedStyles, useThemedStyles } from '../ui';
import { t } from '../../lib/i18n';
import { ds } from '../../theme';
import type { MenuIcon } from '../../lib/menuIcons';

type Props = {
    disabled: boolean;
    busy?: boolean;
    onLibrary(): void;
    onDevice(): void;
    onRecord(): void;
    onInstrument(): void;
};

export function MusicAddTrackTray({ disabled, busy = false, onLibrary, onDevice, onRecord, onInstrument }: Props) {
    const s = useThemedStyles(sheets);
    return <View testID="music-add-track-tray" accessibilityRole="toolbar" accessibilityLabel={t('beat.track.add')} style={s.tray}>
        <TrackChoice testID="music-add-track-library" icon="folder" title={t('beat.track.library')} disabled={disabled || busy} onPress={onLibrary} />
        <TrackChoice testID="music-add-track-device" icon="arrowUp" title={t(busy ? 'beat.track.deviceBusy' : 'beat.track.device')} disabled={disabled || busy} onPress={onDevice} />
        <TrackChoice testID="music-add-track-record" icon="microphone" title={t('beatTakes.addTrack')} disabled={disabled || busy} onPress={onRecord} />
        <TrackChoice testID="music-add-track-instrument" icon="pianoKeys" title={t('beatPiano.library.title')} disabled={disabled || busy} onPress={onInstrument} />
    </View>;
}

function TrackChoice({ testID, icon, title, disabled, onPress }: {
    testID: string; icon: MenuIcon; title: string; disabled: boolean; onPress(): void;
}) {
    const s = useThemedStyles(sheets);
    return <Button testID={testID} variant="tertiary" disabled={disabled}
        label={title} onPress={onPress} containerStyle={s.choiceHit} style={s.choice}><View style={s.label}><Icon name={icon} size={22} />
            <Text variant="footnote" numberOfLines={1} style={s.choiceLabel}>{title}</Text>
        </View></Button>;
}

const sheets = themedStyles(p => ({
    tray: { width: '100%', maxWidth: 820, alignSelf: 'center', flexDirection: 'row', borderTopWidth: 1,
        borderTopColor: p.borderSubtle, paddingTop: ds.space.xs },
    choiceHit: { flex: 1, minWidth: 0 },
    choice: { minWidth: 0, minHeight: 58, paddingHorizontal: ds.space.xs, borderRadius: ds.radius.sm },
    label: { width: '100%', alignItems: 'center', justifyContent: 'center', gap: 2 },
    choiceLabel: { textAlign: 'center' },
}));
