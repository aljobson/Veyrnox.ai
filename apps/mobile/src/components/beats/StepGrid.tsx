import { useEffect, useRef, useState } from 'react';
import { Pressable, View } from 'react-native';
import { SegmentedControl, Text, themedStyles, useThemedStyles } from '../ui';
import { ds } from '../../theme';
import { t } from '../../lib/i18n';
import { type BeatDoc, type PadId } from '../../lib/beatNative/doc';
import type { BeatEditorLayout } from '../../lib/beatNative/editorLayout';

const VELOCITIES = [60, 100, 127] as const;
type Velocity = typeof VELOCITIES[number];
type Direction = 1 | -1;
const velocityName = (value: Velocity): string => t(value === 60 ? 'beat.velocity.soft' : value === 100 ? 'beat.velocity.medium' : 'beat.velocity.hard');

export interface StepGridProps {
    doc: BeatDoc;
    pad: PadId;
    current: number | null;
    onToggle: (step: number) => void;
    onVelocity?: (step: number, direction: Direction) => void;
    disabled?: boolean;
    layout?: BeatEditorLayout;
}

function velocityAt(doc: BeatDoc, pad: PadId, step: number): Velocity | undefined {
    return doc.patterns[doc.currentPattern]?.rows[pad]?.find(([candidate]) => candidate === step)?.[1] as Velocity | undefined;
}

function directionTo(current: Velocity, target: Velocity): Direction {
    const from = VELOCITIES.indexOf(current);
    const to = VELOCITIES.indexOf(target);
    return (from + 1) % VELOCITIES.length === to ? 1 : -1;
}

function StepCell({ step, total, padName, velocity, current, selected, disabled, onSelect, onToggle, onVelocity }: {
    step: number; total: number; padName: string; velocity?: Velocity; current: boolean; selected: boolean; disabled: boolean;
    onSelect: (step: number) => void; onToggle: (step: number) => void; onVelocity?: (step: number, direction: Direction) => void;
}) {
    const s = useThemedStyles(sheets);
    const held = useRef(false);
    const on = velocity !== undefined;
    const label = t(on ? 'beat.step.on' : 'beat.step.off', { n: step + 1, total, pad: padName });
    const actions = on && onVelocity ? [{ name: 'increment' as const }, { name: 'decrement' as const }] : undefined;
    return (
        <Pressable accessibilityRole="button" accessibilityLabel={label}
            accessibilityState={{ selected: on, disabled }}
            accessibilityValue={{ text: on ? `${velocityName(velocity)}, ${t('beatPiano.keys.velocity', { n: velocity })}` : t('beat.pattern.off') }}
            accessibilityHint={current ? t('beat.step.now') : undefined}
            accessibilityActions={actions}
            disabled={disabled}
            delayLongPress={450}
            onPressIn={() => { held.current = false; onSelect(step); }}
            onLongPress={() => {
                held.current = true;
                if (on && onVelocity) onVelocity(step, 1);
            }}
            onPress={() => {
                onSelect(step);
                if (held.current) { held.current = false; return; }
                onToggle(step);
            }}
            onAccessibilityAction={event => {
                if (!on || !onVelocity || disabled) return;
                onSelect(step);
                if (event.nativeEvent.actionName === 'increment') onVelocity(step, 1);
                if (event.nativeEvent.actionName === 'decrement') onVelocity(step, -1);
            }}
            style={[s.cell, on && s.cellOn, disabled && s.disabled]}>
            {selected ? <View testID={`step-edit-target-${step}`} pointerEvents="none" accessible={false}
                accessibilityElementsHidden style={s.editOutline} /> : null}
            {current ? <Text testID={`step-playhead-${step}`} accessible={false} accessibilityElementsHidden
                variant="caption" tone={on ? 'onAccent' : 'primary'} style={s.playhead}>▶</Text> : null}
            {on ? <Text testID={`step-selected-${step}`} accessible={false} accessibilityElementsHidden
                variant="caption" tone="onAccent" style={s.mark}>✓</Text> : null}
            <Text variant="caption" tone={on ? 'onAccent' : 'secondary'}>{step + 1}</Text>
            {on ? <Text testID={`step-velocity-${step}`} accessible={false} accessibilityElementsHidden
                variant="caption" tone="onAccent" style={s.velocity}>{velocity}</Text> : null}
        </Pressable>
    );
}

export function StepGrid({ doc, pad, current, onToggle, onVelocity, disabled = false, layout = 'compact' }: StepGridProps) {
    const s = useThemedStyles(sheets);
    const [selectedStep, setSelectedStep] = useState(0);
    const name = t(`beat.pad.${pad}`);
    const total = doc.steps;
    const perRow = layout === 'regular' ? 8 : layout === 'accessible' ? 2 : 4;
    useEffect(() => { setSelectedStep(step => step < total ? step : 0); }, [total]);
    const rows = Array.from({ length: Math.ceil(total / perRow) }, (_, r) =>
        Array.from({ length: perRow }, (_, c) => r * perRow + c).filter(n => n < total));
    const selectedVelocity = velocityAt(doc, pad, selectedStep);
    const velocityValue = selectedVelocity === undefined ? 'off' : String(selectedVelocity);
    return (
        <View style={s.grid} accessibilityLabel={t('beat.steps', { pad: name })}>
            {rows.map((row, r) => (
                <View key={r} testID={`step-row-${r}`} style={s.row}>
                    {row.map(step => <StepCell key={step} step={step} total={total} padName={name}
                        velocity={velocityAt(doc, pad, step)} current={current === step} selected={selectedStep === step}
                        disabled={disabled} onSelect={setSelectedStep} onToggle={onToggle} onVelocity={onVelocity} />)}
                </View>
            ))}
            <View style={s.velocityEditor}>
                <Text variant="footnote" tone="secondary">{t('beatLabs.control.gridVelocity')} · {selectedStep + 1}{selectedVelocity === undefined ? ` · ${t('beat.pattern.off')}` : ''}</Text>
                <SegmentedControl<string> value={velocityValue} accessibilityLabel={t('beatLabs.control.gridVelocity')}
                    accessibilityHint={selectedVelocity === undefined ? `${t('beat.pattern.off')}. ${t('beatLabs.touch.gridToggle')}` : undefined}
                    disabled={disabled || selectedVelocity === undefined || !onVelocity}
                    options={VELOCITIES.map(value => ({ value: String(value) as `${Velocity}`, label: `${velocityName(value)} ${value}`, accessibilityLabel: `${velocityName(value)}, ${t('beatLabs.control.gridVelocity')} ${value}` }))}
                    onChange={value => {
                        if (!selectedVelocity || !onVelocity) return;
                        const target = Number(value) as Velocity;
                        if (target !== selectedVelocity) onVelocity(selectedStep, directionTo(selectedVelocity, target));
                    }} />
            </View>
        </View>
    );
}

const sheets = themedStyles(p => ({
    grid: { gap: ds.space.sm },
    row: { flexDirection: 'row', gap: ds.space.sm },
    cell: { flex: 1, minHeight: 52, borderRadius: ds.radius.sm, backgroundColor: p.bgElevated1, borderWidth: 1, borderColor: p.borderSubtle, alignItems: 'center', justifyContent: 'center', paddingVertical: ds.space.xs },
    cellOn: { backgroundColor: p.accent, borderColor: p.textPrimary, borderWidth: 3 },
    disabled: { opacity: 0.45 },
    editOutline: { position: 'absolute', top: 2, right: 2, bottom: 2, left: 2, borderWidth: 2, borderStyle: 'dashed', borderColor: p.textPrimary, borderRadius: ds.radius.sm },
    playhead: { position: 'absolute', top: ds.space.xs, left: ds.space.xs },
    mark: { position: 'absolute', top: ds.space.xs, right: ds.space.xs },
    velocity: { fontVariant: ['tabular-nums'] },
    velocityEditor: { gap: ds.space.xs, paddingTop: ds.space.xs },
}));
