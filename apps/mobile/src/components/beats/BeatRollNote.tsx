import { useMemo, useRef } from 'react';
import { PanResponder, Pressable, View } from 'react-native';
import { Text, useThemedStyles } from '../ui';
import { pianoStyles } from './pianoStyles';
import { dragDelta, noteLengthUnits, notePosition, noteRect } from '../../lib/beatNative/rollGeometry';
import { noteKey, noteLabel, type MidiNote } from '../../lib/beatNative/midi';
import type { NoteActions } from './BeatNoteActions';
import { createHoldDrag } from '../../lib/beatNative/holdDrag';
import { t } from '../../lib/i18n';
export function BeatRollNote(p: { note: MidiNote; high: number; scale: number; snap: number; selected: string[]; toggle(key: string): void; actions: NoteActions; active(value: boolean): void; disabled: boolean }) {
    const s = useThemedStyles(pianoStyles), latest = useRef(p); latest.current = p;
    const drag = useRef(createHoldDrag<'move' | 'resize'>()).current;
    const rect = noteRect(p.note, p.scale, p.high), key = noteKey(p.note), selected = p.selected.includes(key);
    const left = Math.max(0, rect.x - (rect.touchWidth - rect.width) / 2), inset = rect.x - left;
    const finish = (dx: number, dy: number, commit: boolean) => {
        const q = latest.current, kind = drag.finish();
        q.active(false);
        if (!kind || !commit || q.disabled) return;
        const keys = q.selected.includes(noteKey(q.note)) ? q.selected : [noteKey(q.note)];
        const delta = dragDelta(dx, dy, q.scale, q.snap);
        if (kind === 'resize') { if (delta.ticks) q.actions.resize(delta.ticks, keys); }
        else if (delta.ticks || delta.pitch) q.actions.move(delta.ticks, delta.pitch, keys);
    };
    const responder = useMemo(() => PanResponder.create({
        onMoveShouldSetPanResponder: (_, g) => drag.canCapture(g.dx, g.dy, g.numberActiveTouches, latest.current.disabled),
        onPanResponderGrant: () => { if (latest.current.disabled) drag.cancel(); else if (drag.capture()) latest.current.active(true); },
        onPanResponderRelease: (_, g) => finish(g.dx, g.dy, true),
        onPanResponderTerminate: () => finish(0, 0, false),
        onPanResponderTerminationRequest: () => false,
    // Gesture callbacks read current props without replacing an active responder.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }), []);
    return <View {...responder.panHandlers}
        onTouchEnd={() => { drag.releaseTouch(); if (!drag.isCaptured()) p.active(false); }}
        onTouchCancel={() => { drag.cancel(); p.active(false); }} style={{ position: 'absolute', left, top: rect.y, width: rect.touchWidth, height: rect.height }}>
        <Pressable disabled={p.disabled} style={{ width: rect.touchWidth, height: rect.height }}
            accessibilityRole="button" accessibilityState={{ selected, disabled: p.disabled }}
            accessibilityLabel={t('beatPiano.note', { note: noteLabel(p.note[2]), ...notePosition(p.note[0]), length: noteLengthUnits(p.note[1]), velocity: p.note[3] })}
            accessibilityActions={[{ name: 'activate' }, { name: 'increment', label: t('beatPiano.up') }, { name: 'decrement', label: t('beatPiano.down') }]}
            onAccessibilityAction={e => { if (e.nativeEvent.actionName === 'activate') p.toggle(key); else p.actions.move(0, e.nativeEvent.actionName === 'increment' ? 1 : -1, [key]); }}
            onPressIn={e => drag.begin(selected && e.nativeEvent.locationX >= inset + rect.width - 14 ? 'resize' : 'move')}
            onLongPress={() => { if (!p.disabled) drag.arm(); }}
            onPress={() => { if (!drag.suppressesTap()) p.toggle(key); drag.cancel(); p.active(false); }}>
            <View pointerEvents="none" style={[s.note, { left: inset, top: 0, width: rect.width, height: rect.height }, selected && s.selected]}><Text tone="onAccent" variant="caption">{noteLabel(p.note[2])}</Text></View>
        </Pressable>
    </View>;
}
