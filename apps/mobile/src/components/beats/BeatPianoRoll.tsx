import { useMemo, useRef, useState } from 'react';
import { PanResponder, Pressable, View } from 'react-native';
import { useThemedStyles } from '../ui';
import { pianoStyles } from './pianoStyles';
import { BeatRollNote } from './BeatRollNote';
import type { NoteActions } from './BeatNoteActions';
import { normaliseMarquee, notesInMarquee, ROW, type MarqueeRect, xToTick, yToPitch } from '../../lib/beatNative/rollGeometry';
import { createHoldDrag } from '../../lib/beatNative/holdDrag';
import { noteKey, type MidiClip } from '../../lib/beatNative/midi';

export type BeatPianoRollProps = {
    clip: MidiClip; selected: string[]; toggle(key: string): void; select(keys: string[]): void;
    add(tick: number, pitch: number): void; removeAt(key: string): void; snap: number; scale: number;
    actions: NoteActions; disabled: boolean; high: number; low: number; width: number; height: number;
    active(value: boolean): void;
};

export function BeatPianoRoll(p: BeatPianoRollProps) {
    const s = useThemedStyles(pianoStyles), latest = useRef(p); latest.current = p;
    const drag = useRef(createHoldDrag<'marquee'>()).current, origin = useRef({ x: 0, y: 0 });
    const [marquee, setMarquee] = useState<MarqueeRect | null>(null);
    const responder = useMemo(() => PanResponder.create({
        onMoveShouldSetPanResponder: (_, gesture) => drag.canCapture(gesture.dx, gesture.dy, gesture.numberActiveTouches, latest.current.disabled),
        onPanResponderGrant: () => {
            if (latest.current.disabled || !drag.capture()) return;
            latest.current.active(true);
            setMarquee(normaliseMarquee(origin.current.x, origin.current.y, origin.current.x, origin.current.y));
        },
        onPanResponderMove: (_, gesture) => setMarquee(normaliseMarquee(origin.current.x, origin.current.y, origin.current.x + gesture.dx, origin.current.y + gesture.dy)),
        onPanResponderRelease: (_, gesture) => {
            const kind = drag.finish(); latest.current.active(false);
            if (kind) latest.current.select(notesInMarquee(latest.current.clip.notes, normaliseMarquee(origin.current.x, origin.current.y, origin.current.x + gesture.dx, origin.current.y + gesture.dy), latest.current.scale, latest.current.high));
            setMarquee(null);
        },
        onPanResponderTerminate: () => { drag.cancel(); latest.current.active(false); setMarquee(null); },
        onPanResponderTerminationRequest: () => false,
    }), [drag]);
    const lineUnit = p.snap || 240;
    return <View testID="beat-piano-roll" style={[s.rollCanvas, { width: p.width, height: p.height }]} {...responder.panHandlers}
        onTouchEnd={() => { drag.releaseTouch(); if (!drag.isCaptured()) p.active(false); }}
        onTouchCancel={() => { drag.cancel(); p.active(false); setMarquee(null); }}>
        <Pressable accessible={false} accessibilityRole="none" disabled={p.disabled} style={s.rollBackground}
            onPressIn={event => { origin.current = { x: event.nativeEvent.locationX, y: event.nativeEvent.locationY }; drag.begin('marquee'); }}
            onLongPress={() => { if (!p.disabled) drag.arm(); }}
            onPress={event => {
                if (!drag.suppressesTap()) p.add(xToTick(event.nativeEvent.locationX, p.scale, p.snap, p.clip.lengthTicks), yToPitch(event.nativeEvent.locationY, p.high, p.low));
                drag.cancel();
            }}>
            {Array.from({ length: p.high - p.low + 1 }, (_, i) => <View pointerEvents="none" key={i} style={[s.gridRow, { height: ROW }, (p.high - i) % 12 === 0 && s.cRow]} />)}
            {Array.from({ length: Math.ceil(p.clip.lengthTicks / lineUnit) }, (_, i) => i * lineUnit).map(n => <View pointerEvents="none" key={n} style={[s.gridLine, { left: n * p.scale, opacity: n % 960 ? 0.4 : 1 }, n % 3840 === 0 && s.barLine]} />)}
        </Pressable>
        {p.clip.notes.map(note => <BeatRollNote key={noteKey(note)} {...p} note={note} active={p.active} />)}
        {marquee && <View pointerEvents="none" testID="beat-piano-marquee" style={[s.marquee, { left: marquee.x, top: marquee.y, width: marquee.width, height: marquee.height }]} />}
    </View>;
}
