import { Pressable, View } from 'react-native';
import { Text, themedStyles, useThemedStyles } from '../ui';
import { ds } from '../../theme';
import { t } from '../../lib/i18n';
import { hasHit, type BeatDoc, type PadId } from '../../lib/beatNative/doc';

const PER_ROW = 4; // 4 cells of at least 44 pt each fit a 375 pt phone with room to spare, one bar beat per row.
export interface StepGridProps { doc: BeatDoc; pad: PadId; current: number | null; onToggle: (step: number) => void }

export function StepGrid({ doc, pad, current, onToggle }: StepGridProps) {
    const s = useThemedStyles(sheets);
    const name = t(`beat.pad.${pad}`);
    const total = doc.steps;
    const rows = Array.from({ length: Math.ceil(total / PER_ROW) }, (_, r) => Array.from({ length: PER_ROW }, (_, c) => r * PER_ROW + c).filter(n => n < total));
    return (
        <View style={s.grid} accessibilityLabel={t('beat.steps', { pad: name })}>
            {rows.map((row, r) => (
                <View key={r} style={s.row}>
                    {row.map(step => {
                        const on = hasHit(doc, pad, step);
                        const now = current === step;
                        const label = t(on ? 'beat.step.on' : 'beat.step.off', { n: step + 1, total, pad: name });
                        return (
                            <Pressable key={step} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected: on }}
                                accessibilityHint={now ? t('beat.step.now') : undefined} onPress={() => onToggle(step)}
                                style={[s.cell, on && s.cellOn, now && s.cellNow]}>
                                {on ? <Text testID={`step-selected-${step}`} accessible={false} accessibilityElementsHidden
                                    variant="caption" tone="onAccent" style={s.mark}>✓</Text> : null}
                                <Text variant="caption" tone={on ? 'onAccent' : 'secondary'}>{step + 1}</Text>
                            </Pressable>
                        );
                    })}
                </View>
            ))}
        </View>
    );
}
const sheets = themedStyles(p => ({
    grid: { gap: ds.space.sm },
    row: { flexDirection: 'row', gap: ds.space.sm },
    cell: { flex: 1, minHeight: 48, borderRadius: ds.radius.sm, backgroundColor: p.bgElevated1, borderWidth: 1, borderColor: p.borderSubtle, alignItems: 'center', justifyContent: 'center' },
    cellOn: { backgroundColor: p.accent, borderColor: p.textPrimary, borderWidth: 3 },
    cellNow: { borderColor: p.textPrimary, borderWidth: 3 },
    mark: { position: 'absolute', top: ds.space.xs, right: ds.space.sm },
}));
