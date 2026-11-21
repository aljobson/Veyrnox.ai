import { View } from 'react-native';
import { Button, SegmentedControl, Text, themedStyles, useThemedStyles } from '../ui';
import { MixSlider } from './MixSlider';
import { addEffect, removeEffect, moveEffect, setEffectBypass, setEffectParam, DEFAULT_FX_PARAMS, FX_RANGES, REVERB_SIZES,
    type FxType, type MixTrack, type MixApply } from '../../lib/beatNative/mix';
import { t } from '../../lib/i18n';
import { ds } from '../../theme';

export function BeatEffectRack({ track, apply }: { track: MixTrack; apply: MixApply }) {
    const s = useThemedStyles(sheets);
    const effects = track.fx ?? [];
    return <View style={s.rack}>
        <Text variant="bodyStrong">{t('beatMix.fx.title')}</Text>
        {!effects.length && <Text>{t('beatMix.fx.empty')}</Text>}
        {(Object.keys(DEFAULT_FX_PARAMS) as FxType[]).map(type => <Button key={type} variant="secondary"
            label={t('beatMix.fx.add', { effect: t(`beatMix.fx.${type}`) })} disabled={effects.length >= 4}
            onPress={() => apply(d => addEffect(d, track.id, type))} />)}
        {effects.length >= 4 && <Text variant="footnote">{t('beatMix.fx.limit')}</Text>}
        {effects.map((fx, index) => {
            const name = t('beatMix.fx.name', { effect: t(`beatMix.fx.${fx.type}`), n: index + 1 });
            return <View key={fx.id} style={s.card}>
                <Text variant="bodyStrong">{name}</Text>
                {fx.type === 'compressor' && <Text variant="footnote">{t('beatMix.fx.compressor.standIn')}</Text>}
                {fx.type === 'distortion' && <Text variant="footnote">{t('beatMix.fx.distortion.web')}</Text>}
                <Button variant={fx.bypass ? 'primary' : 'secondary'} label={t('beatMix.fx.bypass', { effect: name })}
                    accessibilityState={{ selected: fx.bypass }} onPress={() => apply(d => setEffectBypass(d, track.id, fx.id, !fx.bypass))} />
                {([-1, 1] as const).map(delta => <Button key={delta} variant="secondary" label={t(delta < 0 ? 'beatMix.fx.up' : 'beatMix.fx.down', { effect: name })}
                    disabled={delta < 0 ? index === 0 : index === effects.length - 1} onPress={() => apply(d => moveEffect(d, track.id, fx.id, delta))} />)}
                <Button variant="tertiary" label={t('beatMix.fx.remove', { effect: name })} onPress={() => apply(d => removeEffect(d, track.id, fx.id))} />
                {Object.keys(DEFAULT_FX_PARAMS[fx.type]).filter(param => param !== 'drive').map(param => {
                    const label = t('beatMix.fx.param', { effect: name, param: t(`beatMix.param.${param}`) });
                    const change = (value: number) => apply(d => setEffectParam(d, track.id, fx.id, param, value), undefined, `${track.id}:fx:${fx.id}:${param}`);
                    if (param === 'size') return <View key={param}><Text>{label}</Text><SegmentedControl accessibilityLabel={label} value={String(fx.params.size)} onChange={v => change(Number(v))}
                        options={REVERB_SIZES.map(size => ({ value: String(size), label: t('beatMix.unit.seconds', { value: size }) }))} /></View>;
                    const db = ['low', 'mid', 'high', 'threshold'].includes(param);
                    return <MixSlider key={param} label={label} value={fx.params[param]} min={FX_RANGES[param][0]} max={FX_RANGES[param][1]}
                        step={db || param === 'ratio' ? 1 : 0.01} unit={db ? 'db' : param === 'ratio' ? 'ratio' : param === 'time' ? 'seconds' : 'percent'} onChange={change} />;
                })}
            </View>;
        })}
    </View>;
}
const sheets = themedStyles(p => ({ rack: { gap: ds.space.sm }, card: { gap: ds.space.sm, padding: ds.space.md, borderWidth: 1, borderColor: p.borderSubtle, borderRadius: ds.radius.md } }));
