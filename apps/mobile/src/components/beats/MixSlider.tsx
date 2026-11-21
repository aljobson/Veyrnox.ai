import { View } from 'react-native';
import { Text } from '../ui';
import { StrengthSlider } from '../StrengthSlider';
import { t } from '../../lib/i18n';

export const toUnit = (value: number, min: number, max: number): number => Math.max(0, Math.min(1, (value - min) / (max - min)));
export const fromUnit = (value: number, min: number, max: number, step: number): number =>
    Number(Math.max(min, Math.min(max, min + Math.round(toUnit(value, 0, 1) * (max - min) / step) * step)).toFixed(6));
export function MixSlider({ label, value, min = 0, max = 1, step = 0.01, unit = 'percent', disabled, reason, onChange }: {
    label: string; value: number; min?: number; max?: number; step?: number; unit?: 'percent' | 'db' | 'seconds' | 'ratio';
    disabled?: boolean; reason?: string; onChange(value: number): void;
}) {
    const shown = unit === 'percent' ? Math.round(value * 100) : Number(value.toFixed(2));
    const valueText = t(`beatMix.unit.${unit}`, { value: shown });
    return <View>
        <Text>{t('beatMix.slider.value', { label, value: valueText })}</Text>
        <StrengthSlider tone="surface" label={label} value={toUnit(value, min, max)} valueText={valueText} disabled={disabled}
            onChange={v => onChange(fromUnit(v, min, max, step))} />
        {disabled && reason ? <Text variant="footnote" tone="secondary">{reason}</Text> : null}
    </View>;
}
