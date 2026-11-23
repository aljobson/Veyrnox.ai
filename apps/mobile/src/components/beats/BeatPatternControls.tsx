import { View } from 'react-native';
import { Button, SegmentedControl, Text, themedStyles, useThemedStyles } from '../ui';
import { t } from '../../lib/i18n';
import type { PatternSlot, StepCount } from '../../lib/beatNative/doc';
import { ds } from '../../theme';
import { BeatModal } from './BeatModal';
import { MixSlider } from './MixSlider';

const PATTERNS: readonly PatternSlot[] = ['A', 'B', 'C', 'D'];

export function BeatPatternControls({ pattern, uses, swing, metronome, steps, disabled, clearDisabled,
    onSwing, onMetronome, onSteps, onCopy, onClear, onClose, onDismiss }: {
    pattern: PatternSlot;
    uses: number;
    swing: number;
    metronome: boolean;
    steps: StepCount;
    disabled: boolean;
    clearDisabled: boolean;
    onSwing(value: number): void;
    onMetronome(value: boolean): void;
    onSteps(value: StepCount): void;
    onCopy(target: PatternSlot): void;
    onClear(): void;
    onClose(): void;
    onDismiss?(): void;
}) {
    const s = useThemedStyles(sheets);
    const targets = PATTERNS.filter(target => target !== pattern);
    return <BeatModal testID="beat-pattern-controls-modal" title={t('beat.pattern.controlsNamed', { pattern })} onClose={onClose} onDismiss={onDismiss}>
        <Text variant="body" tone="secondary" accessibilityLiveRegion="polite">
            {t('beat.pattern.usage', { pattern, count: uses })}
        </Text>
        <View style={s.section}>
            <Text variant="bodyStrong" accessibilityRole="header">{t('beat.pattern.swing')}</Text>
            <MixSlider label={t('beat.pattern.swing')} value={swing} min={0} max={0.6} step={0.01}
                accessibilityStep={0.01} disabled={disabled} onChange={onSwing} />
        </View>
        <View style={s.section}>
            <Text variant="bodyStrong" accessibilityRole="header">{t('beat.pattern.metronome')}</Text>
            <Button testID="beat-pattern-metronome" variant="secondary" label={t('beat.pattern.metronome')}
                accessibilityRole="switch" accessibilityState={{ checked: metronome }} disabled={disabled}
                onPress={() => onMetronome(!metronome)}>
                <Text testID={metronome ? 'beat-pattern-metronome-on' : 'beat-pattern-metronome-off'} variant="bodyStrong">
                    {metronome ? '✓ ' : ''}{t('beat.pattern.metronome')}: {t(metronome ? 'beat.pattern.on' : 'beat.pattern.off')}
                </Text>
            </Button>
        </View>
        <View style={s.section}>
            <Text variant="bodyStrong" accessibilityRole="header">{t('beat.pattern.length')}</Text>
            <SegmentedControl value={String(steps) as '16' | '32'} disabled={disabled} accessibilityLabel={t('beat.pattern.length')}
                options={[
                    { value: '16', label: t('beat.pattern.length16') },
                    { value: '32', label: t('beat.pattern.length32') },
                ] as const}
                onChange={value => onSteps(value === '16' ? 16 : 32)} />
        </View>
        <View style={s.section}>
            <Text variant="bodyStrong" accessibilityRole="header">{t('beat.pattern.controls')}</Text>
            <View style={s.actions}>
                {targets.map(target => <Button key={target} variant="secondary" label={t('beat.pattern.copy', { from: pattern, to: target })}
                    disabled={disabled} onPress={() => onCopy(target)} />)}
                <Button testID="beat-pattern-clear" variant="destructive" label={t('beat.pattern.clear', { pattern })}
                    disabled={disabled || clearDisabled} onPress={onClear} />
            </View>
        </View>
        <Button variant="secondary" label={t('beat.pattern.close')} onPress={onClose} />
    </BeatModal>;
}

const sheets = themedStyles(p => ({
    section: { gap: ds.space.md, padding: ds.space.lg, borderRadius: ds.radius.lg, borderWidth: 1, borderColor: p.borderSubtle, backgroundColor: p.bgElevated1 },
    actions: { gap: ds.space.sm },
}));
