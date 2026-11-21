import { View } from 'react-native';
import { Button, SegmentedControl, Text, themedStyles, useThemedStyles } from '../ui';
import { BeatMeter } from './BeatMeter';
import { MixSlider } from './MixSlider';
import { DEFAULT_MASTER, REVERB_SIZES, setMaster, type MixDoc, type MixApply, type MasterPatch } from '../../lib/beatNative/mix';
import type { BeatAudio } from '../../lib/beatNative/audio';
import { t } from '../../lib/i18n';
import { ds } from '../../theme';

export function BeatMasterStrip({ doc, audio, apply }: { doc: MixDoc; audio: BeatAudio | null; apply: MixApply }) {
    const s = useThemedStyles(sheets), master = doc.master ?? DEFAULT_MASTER;
    const change = (patch: MasterPatch, key: string) => apply(d => setMaster(d, patch), undefined, `master:${key}`);
    return <View style={s.strip}>
        <Text variant="title3">{t('beatMix.master')}</Text>
        <BeatMeter audio={audio} trackId="master" name={t('beatMix.master')} />
        <MixSlider label={t('beatMix.master.gain')} value={master.gain} onChange={gain => change({ gain }, 'gain')} />
        <Button label={t('beatMix.limiter')} variant={master.limiter ? 'primary' : 'secondary'} accessibilityState={{ selected: master.limiter }}
            onPress={() => change({ limiter: !master.limiter }, 'limiter')} />
        <Text variant="footnote">{t('beatMix.limiter.standIn')}</Text>
        <Text>{t('beatMix.master.room')}</Text>
        <SegmentedControl accessibilityLabel={t('beatMix.master.room')} value={String(master.reverb.size)} onChange={v => change({ reverb: { size: Number(v) } }, 'reverb.size')}
            options={REVERB_SIZES.map(size => ({ value: String(size), label: t('beatMix.unit.seconds', { value: size }) }))} />
        <MixSlider label={t('beatMix.master.time')} value={master.delay.time} min={0.02} max={1} unit="seconds" onChange={time => change({ delay: { time } }, 'delay.time')} />
        <MixSlider label={t('beatMix.master.feedback')} value={master.delay.feedback} max={0.8} onChange={feedback => change({ delay: { feedback } }, 'delay.feedback')} />
    </View>;
}
const sheets = themedStyles(p => ({ strip: { gap: ds.space.md, padding: ds.space.lg, backgroundColor: p.bgElevated1, borderRadius: ds.radius.md } }));
