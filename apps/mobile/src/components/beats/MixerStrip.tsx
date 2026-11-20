import { View } from 'react-native';
import { Button, SegmentedControl, Text, themedStyles, useThemedStyles } from '../ui';
import { StrengthSlider } from '../StrengthSlider';
import { instrumentLabel, type MidiTrackDoc } from '../../lib/beatNative/midi';
import { ds } from '../../theme';
import { t } from '../../lib/i18n';
import { DRUM_KITS, type BeatTrackDoc } from '../../lib/beatNative/doc';

export interface MixerStripProps {
    track: BeatTrackDoc; index: number; canRemove: boolean;
    onGain: (value: number) => void; onPan: (value: number) => void;
    onMute: (value: boolean) => void; onSolo: (value: boolean) => void; onKit: (kit: string) => void; onRemove: () => void;
}
// Pan runs -1..1 in the document and 0..1 on the slider (centre at 50). The Distortion effect's Drive control is not offered (N0 gap G2).
const toSlider = (pan: number) => (pan + 1) / 2;
const fromSlider = (value: number) => Math.round((value * 2 - 1) * 100) / 100;

export function MixerStrip({ track, index, canRemove, onGain, onPan, onMute, onSolo, onKit, onRemove }: MixerStripProps) {
    const s = useThemedStyles(sheets);
    const name = t('beat.track', { n: index + 1 });
    return (
        <View style={s.strip} accessibilityLabel={name}>
            <Text variant="bodyStrong">{name}</Text>
            {track.kind === 'midi' ? <Text>{instrumentLabel((track as MidiTrackDoc).instrument)}</Text> : <SegmentedControl value={track.kit} onChange={onKit} options={DRUM_KITS.map(k => ({ value: k.id, label: t(`beat.kit.${k.id}`) }))}
                accessibilityLabel={t('beat.kit', { track: name })} />}
            <StrengthSlider tone="surface" label={t('beat.gain', { track: name })} value={track.gain} onChange={onGain} />
            <StrengthSlider tone="surface" label={t('beat.pan', { track: name })} value={toSlider(track.pan)} onChange={v => onPan(fromSlider(v))} />
            <View style={s.buttons}>
                <Button size="md" variant={track.mute ? 'primary' : 'secondary'} label={t('beat.mute.short')} accessibilityLabel={t('beat.mute', { track: name })}
                    accessibilityState={{ selected: track.mute }} onPress={() => onMute(!track.mute)} containerStyle={s.flex} />
                <Button size="md" variant={track.solo ? 'primary' : 'secondary'} label={t('beat.solo.short')} accessibilityLabel={t('beat.solo', { track: name })}
                    accessibilityState={{ selected: track.solo }} onPress={() => onSolo(!track.solo)} containerStyle={s.flex} />
                {canRemove ? <Button size="md" variant="tertiary" label={t('beat.track.remove', { track: name })} onPress={onRemove} containerStyle={s.flex} /> : null}
            </View>
        </View>
    );
}
const sheets = themedStyles(p => ({
    strip: { gap: ds.space.md, padding: ds.space.lg, borderRadius: ds.radius.md, backgroundColor: p.bgElevated1, borderWidth: 1, borderColor: p.borderSubtle },
    buttons: { flexDirection: 'row', gap: ds.space.sm },
    flex: { flex: 1 },
}));
