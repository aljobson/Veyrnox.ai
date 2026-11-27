import { View } from 'react-native';
import { Button, Icon, Text, themedStyles, useThemedStyles } from '../ui';
import { BeatMeter } from './BeatMeter';
import { MixSlider } from './MixSlider';
import { BeatEffectRack } from './BeatEffectRack';
import { setTrackGain, setTrackPan, setTrackMute, setTrackSolo } from '../../lib/beatNative/doc';
import { automationControl, setSend, type MixDoc, type MixTrack, type MixApply, type Lane } from '../../lib/beatNative/mix';
import type { BeatAudio } from '../../lib/beatNative/audio';
import { t } from '../../lib/i18n';
import { ds } from '../../theme';

export function BeatChannelStrip({ doc, track, audio, apply, expanded, onToggle, onLane }: {
    doc: MixDoc; track: MixTrack; audio: BeatAudio | null; apply: MixApply; expanded: boolean; onToggle(): void; onLane(lane: Lane): void;
}) {
    const s = useThemedStyles(sheets);
    return <View style={s.strip}>
        <View style={s.header}>
            <View style={s.trackIcon}><Icon name={track.kind === 'drums' ? 'drum' : track.kind === 'midi' ? 'pianoKeys' : 'audio'} size={20} tint={s.icon.color} /></View>
            <View style={s.trackCopy}><Text variant="bodyStrong" numberOfLines={1}>{track.name}</Text>
                <BeatMeter audio={audio} trackId={track.id} name={track.name} /></View>
            <View style={s.actions}>
                <Button testID={track.mute ? `channel-mute-selected-${track.id}` : undefined} size="md" icon="speaker" iconOnly
                    label={t('beat.mute', { track: track.name })} variant={track.mute ? 'primary' : 'tertiary'}
                    accessibilityState={{ selected: track.mute }} onPress={() => apply(d => setTrackMute(d, track.id, !track.mute))} />
                <Button testID={track.solo ? `channel-solo-selected-${track.id}` : undefined} size="md" icon="headphones" iconOnly
                    label={t('beat.solo', { track: track.name })} variant={track.solo ? 'primary' : 'tertiary'}
                    accessibilityState={{ selected: track.solo }} onPress={() => apply(d => setTrackSolo(d, track.id, !track.solo))} />
                <Button testID={`beat-mixer-track-details-${track.id}`} size="md" icon="sliders" iconOnly variant={expanded ? 'secondary' : 'tertiary'}
                    label={t('beatMix.lane.title', { track: track.name, lane: t('beat.track.controls') })}
                    accessibilityState={{ expanded }} onPress={onToggle} />
            </View>
        </View>
        <MixSlider label={t('beat.gain', { track: track.name })} value={track.gain}
            disabled={automationControl(track, 'gain', doc.view).disabled} reason={t('beatMix.locked.gain')}
            onChange={v => apply(d => setTrackGain(d, track.id, v), undefined, `${track.id}:gain`)} />
        {expanded ? <View testID={`beat-mixer-track-advanced-${track.id}`} style={s.advanced}>
            <MixSlider label={t('beat.pan', { track: track.name })} value={track.pan} min={-1}
                disabled={automationControl(track, 'pan', doc.view).disabled} reason={t('beatMix.locked.pan')}
                onChange={v => apply(d => setTrackPan(d, track.id, v), undefined, `${track.id}:pan`)} />
            {(['reverb', 'delay'] as const).map(bus => <MixSlider key={bus} label={t(`beatMix.send.${bus}`)} value={track.sends?.[bus] ?? 0}
                onChange={v => apply(d => setSend(d, track.id, bus, v), undefined, `${track.id}:send:${bus}`)} />)}
            <View style={s.lanes}>{(['gain', 'pan'] as const).map(lane => <Button key={lane} size="sm" variant="tertiary" icon="waveSine"
                label={t(`beatMix.lane.show.${lane}`)} onPress={() => onLane(lane)} containerStyle={s.lane} />)}</View>
            <BeatEffectRack track={track} apply={apply} />
        </View> : null}
    </View>;
}
const sheets = themedStyles(p => ({
    strip: { gap: ds.space.xs, paddingVertical: ds.space.sm, borderBottomWidth: 1, borderBottomColor: p.borderSubtle },
    header: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: ds.space.sm },
    trackIcon: { width: 40, height: 40, flexShrink: 0, alignItems: 'center', justifyContent: 'center', borderRadius: ds.radius.md, backgroundColor: p.surface },
    icon: { color: p.textSecondary },
    trackCopy: { flex: 1, minWidth: 0, gap: 2 },
    actions: { flexShrink: 0, flexDirection: 'row', gap: 2 },
    advanced: { gap: ds.space.sm, paddingTop: ds.space.xs },
    lanes: { flexDirection: 'row', gap: ds.space.xs },
    lane: { flex: 1, minWidth: 0 },
}));
