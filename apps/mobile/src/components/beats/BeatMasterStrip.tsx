import { View } from 'react-native';
import { Button, SegmentedControl, Text, themedStyles, useThemedStyles } from '../ui';
import { BeatMeter } from './BeatMeter';
import { MixSlider } from './MixSlider';
import { DEFAULT_MASTER, REVERB_SIZES, setMaster, type MixDoc, type MixApply, type MasterPatch } from '../../lib/beatNative/mix';
import type { BeatAudio } from '../../lib/beatNative/audio';
import { t } from '../../lib/i18n';
import { ds } from '../../theme';

export function BeatMasterStrip({ doc, audio, apply, expanded, onToggle }: {
    doc: MixDoc; audio: BeatAudio | null; apply: MixApply; expanded: boolean; onToggle(): void;
}) {
    const s = useThemedStyles(sheets), master = doc.master ?? DEFAULT_MASTER;
    const change = (patch: MasterPatch, key: string) => apply(d => setMaster(d, patch), undefined, `master:${key}`);
    return <View style={s.strip}>
        <View style={s.header}><View style={s.copy}><Text variant="bodyStrong">{t('beatMix.master')}</Text>
            <BeatMeter audio={audio} trackId="master" name={t('beatMix.master')} /></View>
            <Button size="md" icon="shieldCheck" iconOnly label={t('beatMix.limiter')} variant={master.limiter ? 'primary' : 'tertiary'}
                accessibilityState={{ selected: master.limiter }} onPress={() => change({ limiter: !master.limiter }, 'limiter')} />
            <Button testID="beat-mixer-master-details" size="md" icon="sliders" iconOnly variant={expanded ? 'secondary' : 'tertiary'}
                label={t('beatMix.lane.title', { track: t('beatMix.master'), lane: t('beat.track.controls') })}
                accessibilityState={{ expanded }} onPress={onToggle} />
        </View>
        <MixSlider label={t('beatMix.master.gain')} value={master.gain} onChange={gain => change({ gain }, 'gain')} />
        {expanded ? <View testID="beat-mixer-master-advanced" style={s.advanced}>
            <Text>{t('beatMix.master.room')}</Text>
            <SegmentedControl accessibilityLabel={t('beatMix.master.room')} value={String(master.reverb.size)} onChange={v => change({ reverb: { size: Number(v) } }, 'reverb.size')}
                options={REVERB_SIZES.map(size => ({ value: String(size), label: t('beatMix.unit.seconds', { value: size }) }))} />
            <MixSlider label={t('beatMix.master.time')} value={master.delay.time} min={0.02} max={1} unit="seconds" onChange={time => change({ delay: { time } }, 'delay.time')} />
            <MixSlider label={t('beatMix.master.feedback')} value={master.delay.feedback} max={0.8} onChange={feedback => change({ delay: { feedback } }, 'delay.feedback')} />
        </View> : null}
    </View>;
}
const sheets = themedStyles(p => ({
    strip: { gap: ds.space.xs, paddingVertical: ds.space.sm, borderBottomWidth: 1, borderBottomColor: p.borderSubtle },
    header: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 2 },
    copy: { flex: 1, minWidth: 0, gap: 2 },
    advanced: { gap: ds.space.sm, paddingTop: ds.space.xs },
}));
