import { useMemo, useRef } from 'react';
import { PanResponder, Pressable, View } from 'react-native';
import { useThemedStyles } from '../ui';
import { pianoStyles } from './pianoStyles';
import { velocityFromDrag } from '../../lib/beatNative/rollGeometry';
import { noteKey, noteLabel, type MidiClip, type MidiNote } from '../../lib/beatNative/midi';
import { createHoldDrag } from '../../lib/beatNative/holdDrag';
import { t } from '../../lib/i18n';
export const VELOCITY_HEIGHT = 100;
function VelocityBar(p: { note: MidiNote; selected: string[]; scale: number; toggle(key: string): void; velocity(delta: number, keys: string[]): void; active(v: boolean): void; disabled: boolean }) {
    const s = useThemedStyles(pianoStyles), latest = useRef(p); latest.current = p;
    const drag = useRef(createHoldDrag<'velocity'>()).current, start = useRef(p.note[3]);
    const keys = () => latest.current.selected.includes(noteKey(latest.current.note)) ? latest.current.selected : [noteKey(latest.current.note)];
    const responder = useMemo(() => PanResponder.create({
        onMoveShouldSetPanResponder: (_, g) => drag.canCapture(g.dx, g.dy, g.numberActiveTouches, latest.current.disabled, true),
        onPanResponderGrant: () => { if (latest.current.disabled) drag.cancel(); else if (drag.capture()) { start.current = latest.current.note[3]; latest.current.active(true); } },
        onPanResponderRelease: (_, g) => {
            const kind = drag.finish(); latest.current.active(false);
            if (!kind || latest.current.disabled) return;
            const delta = velocityFromDrag(start.current, g.dy, VELOCITY_HEIGHT) - start.current;
            if (delta) latest.current.velocity(delta, keys());
        },
        onPanResponderTerminate: () => { drag.cancel(); latest.current.active(false); },
        onPanResponderTerminationRequest: () => false,
    }), []);
    return <View {...responder.panHandlers}
        onTouchEnd={() => { drag.releaseTouch(); if (!drag.isCaptured()) p.active(false); }}
        onTouchCancel={() => { drag.cancel(); p.active(false); }} style={{ position: 'absolute', left: p.note[0] * p.scale, bottom: 0, width: Math.max(44, p.note[1] * p.scale - 2), height: VELOCITY_HEIGHT }}>
        <Pressable style={{ flex: 1 }} disabled={p.disabled} accessibilityRole="adjustable" accessibilityState={{ selected: p.selected.includes(noteKey(p.note)), disabled: p.disabled }} accessibilityValue={{ min: 1, max: 127, now: p.note[3] }} accessibilityLabel={t('beatPiano.noteVelocity', { note: noteLabel(p.note[2]), velocity: p.note[3] })}
            accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]} onAccessibilityAction={e => p.velocity(e.nativeEvent.actionName === 'increment' ? 16 : -16, keys())}
            onPressIn={() => drag.begin('velocity')} onLongPress={() => { if (!p.disabled) drag.arm(); }}
            onPress={() => { if (!drag.suppressesTap()) p.toggle(noteKey(p.note)); drag.cancel(); p.active(false); }}>
            <View style={[s.note, p.selected.includes(noteKey(p.note)) && s.selected, { bottom: 0, left: 0, width: Math.max(8, p.note[1] * p.scale - 2), height: p.note[3] / 127 * VELOCITY_HEIGHT }]} />
        </Pressable>
    </View>;
}
export function BeatVelocityLane(p: { clip: MidiClip; selected: string[]; scale: number; toggle(key: string): void; velocity(delta: number, keys: string[]): void; disabled: boolean; width?: number; active?(value: boolean): void }) {
    const changeActive = (value: boolean) => p.active?.(value);
    return <View testID="beat-piano-velocity" accessibilityLabel={t('beatPiano.velocity')} style={{ width: p.width ?? Math.max(300, p.clip.lengthTicks * p.scale + 44), height: VELOCITY_HEIGHT }}>
        {p.clip.notes.map(note => <VelocityBar key={noteKey(note)} {...p} note={note} active={changeActive} />)}
    </View>;
}
