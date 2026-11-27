import { Pressable, ScrollView, View } from 'react-native';
import type { ComponentRef, Ref } from 'react';
import { Button, Icon, Text, themedStyles, useThemedStyles } from '../ui';
import { t } from '../../lib/i18n';
import { ds } from '../../theme';
import type { MenuIcon } from '../../lib/menuIcons';

type Props = {
    disabled: boolean;
    reason?: string;
    busy?: boolean;
    compact?: boolean;
    instrumentControlRef?: Ref<ComponentRef<typeof Pressable>>;
    onDevice(): void;
    onRecord(): void;
    onInstrument(): void;
    onSounds?(): void;
};

export function MusicAddTrackTray({ disabled, reason, busy = false, compact = false, instrumentControlRef, onDevice, onRecord, onInstrument, onSounds }: Props) {
    const s = useThemedStyles(sheets);
    const hint = disabled ? reason : busy ? t('beat.track.deviceBusy') : undefined;
    const choices = <>
        <TrackChoice testID="music-add-track-device" icon="arrowUp" title={t(busy ? 'beat.track.deviceBusy' : 'beat.track.device')} compact={compact} disabled={disabled || busy} hint={hint} onPress={onDevice} />
        <TrackChoice testID="music-add-track-record" icon="microphone" title={t('beatTakes.addTrack')} compact={compact} disabled={disabled || busy} hint={hint} onPress={onRecord} />
        <TrackChoice controlRef={instrumentControlRef} testID="music-add-track-instrument" icon="pianoKeys" title={t('beatPiano.library.title')} compact={compact} disabled={disabled || busy} hint={hint} onPress={onInstrument} />
        {onSounds ? <TrackChoice testID="music-add-track-sounds" icon="waveSine" title={t('beatLabs.sounds')} compact={compact} disabled={disabled || busy} hint={hint} onPress={onSounds} /> : null}
    </>;
    const reasonText = disabled && reason ? <Text testID="music-add-track-disabled-reason" variant="footnote" tone="secondary" style={s.reason}>{reason}</Text> : null;
    if (compact) return <ScrollView horizontal testID="music-add-track-tray" accessibilityRole="toolbar" accessibilityLabel={t('beat.track.add')}
        style={s.compactTray} contentContainerStyle={s.compactRow} showsHorizontalScrollIndicator={false}>{reasonText}{choices}</ScrollView>;
    return <ScrollView testID="music-add-track-tray" accessibilityRole="toolbar" accessibilityLabel={t('beat.track.add')}
        style={s.trayViewport} contentContainerStyle={s.tray} nestedScrollEnabled showsVerticalScrollIndicator={false}>
        <View style={s.row}>{choices}</View>{reasonText}
    </ScrollView>;
}

function TrackChoice({ controlRef, testID, icon, title, compact, disabled, hint, onPress }: {
    controlRef?: Ref<ComponentRef<typeof Pressable>>; testID: string; icon: MenuIcon; title: string; compact: boolean; disabled: boolean; hint?: string; onPress(): void;
}) {
    const s = useThemedStyles(sheets);
    return <Button ref={controlRef} testID={testID} variant="tertiary" disabled={disabled} accessibilityHint={disabled ? hint : undefined}
        label={title} onPress={onPress} containerStyle={compact ? s.choiceHitCompact : s.choiceHit} style={[s.choice, compact && s.choiceCompact]}>
        {compact ? <Icon name={icon} size={24} /> : <View style={s.label}><Icon name={icon} size={24} />
            <Text variant="footnote" numberOfLines={1} style={s.choiceLabel}>{title}</Text></View>}
    </Button>;
}

const sheets = themedStyles(p => ({
    trayViewport: { flexGrow: 0, flexShrink: 1, minHeight: 0 },
    tray: { width: '100%', maxWidth: 820, alignSelf: 'center', gap: ds.space.xs, borderTopWidth: 1,
        borderTopColor: p.borderSubtle, paddingTop: ds.space.xs },
    row: { flexDirection: 'row' },
    compactTray: { flexGrow: 0, borderTopWidth: 1, borderTopColor: p.borderSubtle },
    compactRow: { minHeight: 44, alignItems: 'center', gap: ds.space.xs, paddingHorizontal: ds.space.xs },
    choiceHit: { flex: 1, minWidth: 0 },
    choiceHitCompact: { width: 52, minHeight: 44 },
    choice: { minWidth: 0, minHeight: 58, paddingHorizontal: ds.space.xs, borderRadius: ds.radius.sm },
    choiceCompact: { width: 52, minWidth: 52, minHeight: 44, paddingHorizontal: 0 },
    label: { width: '100%', alignItems: 'center', justifyContent: 'center', gap: 2 },
    choiceLabel: { textAlign: 'center' },
    reason: { paddingHorizontal: ds.space.sm },
}));
