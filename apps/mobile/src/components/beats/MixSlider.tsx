import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { Text } from '../ui';
import { StrengthSlider } from '../StrengthSlider';
import { t } from '../../lib/i18n';

export const toUnit = (value: number, min: number, max: number): number => Math.max(0, Math.min(1, (value - min) / (max - min)));
export const fromUnit = (value: number, min: number, max: number, step: number): number =>
    Number(Math.max(min, Math.min(max, min + Math.round(toUnit(value, 0, 1) * (max - min) / step) * step)).toFixed(6));
export function MixSlider({ label, value, min = 0, max = 1, step = 0.01, accessibilityStep, unit = 'percent', disabled, reason, commitOnEnd = false, onChange }: {
    label: string; value: number; min?: number; max?: number; step?: number; unit?: 'percent' | 'db' | 'seconds' | 'ratio';
    accessibilityStep?: number; disabled?: boolean; reason?: string; commitOnEnd?: boolean; onChange(value: number): void;
}) {
    const [draft, setDraft] = useState(value);
    const dragging = useRef(false), draftRef = useRef(value);
    useEffect(() => {
        if (!dragging.current) { draftRef.current = value; setDraft(value); }
    }, [value]);
    const change = (next: number) => {
        draftRef.current = next; setDraft(next);
        if (!commitOnEnd) onChange(next);
    };
    const finish = () => {
        dragging.current = false;
        if (commitOnEnd && draftRef.current !== value) onChange(draftRef.current);
    };
    const shown = unit === 'percent' ? Math.round(draft * 100) : Number(draft.toFixed(2));
    const valueText = t(`beatMix.unit.${unit}`, { value: shown });
    const normalizedAccessibilityStep = accessibilityStep && max > min ? accessibilityStep / (max - min) : undefined;
    const rangeScale = unit === 'percent' ? 100 : 1;
    return <View testID={commitOnEnd ? 'mix-slider-commit-on-end' : undefined}>
        <Text>{t('beatMix.slider.value', { label, value: valueText })}</Text>
        <StrengthSlider tone="surface" label={label} value={toUnit(draft, min, max)} valueText={valueText} displayValue={shown}
            valueRange={{ min: min * rangeScale, max: max * rangeScale, now: draft * rangeScale }} disabled={disabled}
            step={normalizedAccessibilityStep}
            onChangeStart={() => { dragging.current = true; }} onChangeEnd={finish}
            onChange={v => change(fromUnit(v, min, max, step))} />
        {disabled && reason ? <Text variant="footnote" tone="secondary">{reason}</Text> : null}
    </View>;
}
