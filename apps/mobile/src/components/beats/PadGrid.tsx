import { useEffect, useRef } from 'react';
import { Pressable, View } from 'react-native';
import { Text, themedStyles, useThemedStyles } from '../ui';
import { ds } from '../../theme';
import { t } from '../../lib/i18n';
import { DRUM_PADS, type PadId } from '../../lib/beatNative/doc';
import type { BeatEditorLayout } from '../../lib/beatNative/editorLayout';

export type PadRecordingState = 'off' | 'armed' | 'recording';
export interface PadGridProps {
    selected: PadId;
    onHit: (pad: PadId) => void;
    layout?: BeatEditorLayout;
    recordingState?: PadRecordingState;
    recordingHint?: string;
    /** A mutation lock never disables auditioning the pads. */
    disabled?: boolean;
}

function Pad({ id, selected, onHit, recordingState, recordingHint, mutationDisabled }: {
    id: PadId; selected: boolean; onHit: (pad: PadId) => void; recordingState: PadRecordingState;
    recordingHint?: string; mutationDisabled: boolean;
}) {
    const s = useThemedStyles(sheets);
    // Each pad owns its low-latency touch guard. Sharing one guard makes overlapping drum hits suppress each other.
    const touched = useRef(false);
    const reset = useRef<ReturnType<typeof setTimeout> | null>(null);
    useEffect(() => () => { if (reset.current) clearTimeout(reset.current); }, []);
    const name = t(`beat.pad.${id}`);
    const hint = recordingHint ?? (recordingState === 'recording' && !mutationDisabled
        ? t('beat.padRecord.status.recording')
        : recordingState === 'armed' ? t('beat.padRecord.status.armed') : undefined);
    return (
        <Pressable accessibilityRole="button" accessibilityLabel={t('beat.pad.hit', { pad: name })}
            accessibilityHint={hint} accessibilityState={{ selected }}
            onPressIn={() => {
                if (reset.current) clearTimeout(reset.current);
                touched.current = true;
                onHit(id);
            }}
            onPressOut={() => {
                // Pressable dispatches onPress after onPressOut. Defer reset so a physical touch cannot double-fire,
                // while a cancelled touch cannot suppress the next screen-reader activation.
                reset.current = setTimeout(() => { touched.current = false; reset.current = null; }, 0);
            }}
            onPress={() => {
                if (!touched.current) onHit(id);
                touched.current = false;
                if (reset.current) { clearTimeout(reset.current); reset.current = null; }
            }}
            style={[s.pad, selected && s.padOn]}>
            {selected ? <Text testID={`pad-selected-${id}`} accessible={false} accessibilityElementsHidden
                variant="caption" tone="onAccent" style={s.mark}>✓</Text> : null}
            <Text variant="footnote" tone={selected ? 'onAccent' : 'primary'} style={s.label}>{name}</Text>
        </Pressable>
    );
}

// The same eight pads use available space rather than a device name: 8 regular, 4 compact, and 2 at large text.
export function PadGrid({ selected, onHit, layout = 'compact', recordingState = 'off', recordingHint, disabled = false }: PadGridProps) {
    const s = useThemedStyles(sheets);
    const columns = layout === 'regular' ? 8 : layout === 'accessible' ? 2 : 4;
    const rows = Array.from({ length: Math.ceil(DRUM_PADS.length / columns) }, (_, r) => DRUM_PADS.slice(r * columns, (r + 1) * columns));
    return (
        <View style={s.grid} accessibilityLabel={t('beat.pads')}>
            {rows.map((row, r) => (
                <View key={r} testID={`pad-row-${r}`} style={s.row}>
                    {row.map(pad => <Pad key={pad.id} id={pad.id} selected={pad.id === selected} onHit={onHit}
                        recordingState={recordingState} recordingHint={recordingHint} mutationDisabled={disabled} />)}
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
