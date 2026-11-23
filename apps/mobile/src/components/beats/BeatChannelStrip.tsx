import { View } from 'react-native';
import { Button, Text, themedStyles, useThemedStyles } from '../ui';
import { BeatMeter } from './BeatMeter';
import { MixSlider } from './MixSlider';
import { BeatEffectRack } from './BeatEffectRack';
import { setTrackGain, setTrackPan, setTrackMute, setTrackSolo } from '../../lib/beatNative/doc';
import { automationControl, setSend, type MixDoc, type MixTrack, type MixApply, type Lane } from '../../lib/beatNative/mix';
import type { BeatAudio } from '../../lib/beatNative/audio';
import { t } from '../../lib/i18n';
import { ds } from '../../theme';

export function BeatChannelStrip({ doc, track, audio, apply, onLane }: {
    doc: MixDoc; track: MixTrack; audio: BeatAudio | null; apply: MixApply; onLane(lane: Lane): void;
}) {
    const s = useThemedStyles(sheets);
    return <View style={s.strip}>
        <Text variant="title3">{track.name}</Text>
        <BeatMeter audio={audio} trackId={track.id} name={track.name} />
        {(['gain', 'pan'] as const).map(lane => <MixSlider key={lane} label={t(`beat.${lane}`, { track: track.name })}
            value={track[lane]} min={lane === 'pan' ? -1 : 0} disabled={automationControl(track, lane, doc.view).disabled} reason={t(`beatMix.locked.${lane}`)}
            onChange={v => apply(d => (lane === 'gain' ? setTrackGain : setTrackPan)(d, track.id, v), undefined, `${track.id}:${lane}`)} />)}
        <Button label={t('beat.mute', { track: track.name })} variant={track.mute ? 'primary' : 'secondary'} accessibilityState={{ selected: track.mute }}
            style={track.mute ? s.selected : undefined} onPress={() => apply(d => setTrackMute(d, track.id, !track.mute))}>
            <Text testID={track.mute ? `channel-mute-selected-${track.id}` : undefined} variant="bodyStrong" tone={track.mute ? 'onAccent' : 'primary'}>
                {track.mute ? '✓ ' : ''}{t('beat.mute', { track: track.name })}
            </Text>
        </Button>
        <Button label={t('beat.solo', { track: track.name })} variant={track.solo ? 'primary' : 'secondary'} accessibilityState={{ selected: track.solo }}
            style={track.solo ? s.selected : undefined} onPress={() => apply(d => setTrackSolo(d, track.id, !track.solo))}>
            <Text testID={track.solo ? `channel-solo-selected-${track.id}` : undefined} variant="bodyStrong" tone={track.solo ? 'onAccent' : 'primary'}>
                {track.solo ? '✓ ' : ''}{t('beat.solo', { track: track.name })}
            </Text>
        </Button>
        {(['reverb', 'delay'] as const).map(bus => <MixSlider key={bus} label={t(`beatMix.send.${bus}`)} value={track.sends?.[bus] ?? 0}
            onChange={v => apply(d => setSend(d, track.id, bus, v), undefined, `${track.id}:send:${bus}`)} />)}
        {(['gain', 'pan'] as const).map(lane => <Button key={lane} variant="secondary" label={t(`beatMix.lane.show.${lane}`)} onPress={() => onLane(lane)} />)}
        <BeatEffectRack track={track} apply={apply} />
    </View>;
}
const sheets = themedStyles(p => ({
    strip: { gap: ds.space.md, padding: ds.space.lg, backgroundColor: p.bgElevated1, borderRadius: ds.radius.md },
    selected: { borderWidth: 2, borderColor: p.textPrimary },
}));
