import { useRef } from 'react';
import { Pressable, View } from 'react-native';
import { Text, themedStyles, useThemedStyles } from '../ui';
import { ds } from '../../theme';
import { t } from '../../lib/i18n';
import { DRUM_PADS, type PadId } from '../../lib/beatNative/doc';

const COLUMNS = 4;
export interface PadGridProps { selected: PadId; onHit: (pad: PadId) => void }

// The web document has eight drum pads, so the phone grid is 4 wide by 2 tall, with big pads for one thumb.
export function PadGrid({ selected, onHit }: PadGridProps) {
    const s = useThemedStyles(sheets);
    // Touch fires on touch-down for the lowest latency; a screen reader only activates (onPress), so that path hits too.
    const down = useRef(false);
    const rows = Array.from({ length: Math.ceil(DRUM_PADS.length / COLUMNS) }, (_, r) => DRUM_PADS.slice(r * COLUMNS, (r + 1) * COLUMNS));
    return (
        <View style={s.grid} accessibilityLabel={t('beat.pads')}>
            {rows.map((row, r) => (
                <View key={r} style={s.row}>
                    {row.map(pad => {
                        const name = t(`beat.pad.${pad.id}`);
                        const on = pad.id === selected;
                        return (
                            <Pressable key={pad.id} accessibilityRole="button" accessibilityLabel={t('beat.pad.hit', { pad: name })}
                                accessibilityState={{ selected: on }} onPressIn={() => { down.current = true; onHit(pad.id); }}
                                onPress={() => { if (!down.current) onHit(pad.id); down.current = false; }} style={[s.pad, on && s.padOn]}>
                                {on ? <Text testID={`pad-selected-${pad.id}`} accessible={false} accessibilityElementsHidden
                                    variant="caption" tone="onAccent" style={s.mark}>✓</Text> : null}
                                <Text variant="footnote" tone={on ? 'onAccent' : 'primary'} numberOfLines={2} style={s.label}>{name}</Text>
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
    pad: { flex: 1, minHeight: 72, borderRadius: ds.radius.md, backgroundColor: p.bgElevated1, borderWidth: 1, borderColor: p.borderSubtle, alignItems: 'center', justifyContent: 'center', paddingHorizontal: ds.space.xs },
    padOn: { backgroundColor: p.accent, borderColor: p.textPrimary, borderWidth: 3 },
    mark: { position: 'absolute', top: ds.space.xs, right: ds.space.sm },
    label: { textAlign: 'center' },
}));
