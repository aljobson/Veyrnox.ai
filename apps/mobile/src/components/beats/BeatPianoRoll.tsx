import { useEffect, useMemo, useRef, useState, type ComponentRef } from 'react';
import { PanResponder, Pressable, ScrollView, View, type GestureResponderEvent } from 'react-native';
import { Button, Text, useThemedStyles } from '../ui';
import { pianoStyles } from './pianoStyles';
import { BeatRollNote } from './BeatRollNote';
import type { NoteActions } from './BeatNoteActions';
import { KEYS_WIDTH, ROW, pinchScale, pitchRange, xToTick, yToPitch, notePosition } from '../../lib/beatNative/rollGeometry';
import { noteKey, noteLabel, type MidiClip } from '../../lib/beatNative/midi';
import { t } from '../../lib/i18n';
const distance = (e: GestureResponderEvent) => { const [a, b] = e.nativeEvent.touches; return a && b ? Math.hypot(a.pageX - b.pageX, a.pageY - b.pageY) : 0; };
export function BeatPianoRoll(p: { clip: MidiClip; selected: string[]; toggle(key: string): void; add(tick: number, pitch: number): void; removeAt(key: string): void; snap: number; scale: number; setScale(n: number): void; actions: NoteActions; disabled: boolean }) {
    const s = useThemedStyles(pianoStyles), vertical = useRef<ComponentRef<typeof ScrollView>>(null);
    const [active, setActive] = useState(false), [cursor, setCursor] = useState({ tick: 0, pitch: 60 });
    const latest = useRef(p); latest.current = p;
    const pinch = useRef<{ distance: number; scale: number } | null>(null);
    const { high, low } = pitchRange(p.clip);
    const tick = Math.min(cursor.tick, p.clip.lengthTicks - 30), pitch = Math.max(low, Math.min(high, cursor.pitch));
    useEffect(() => { setCursor(c => ({ tick: Math.min(c.tick, p.clip.lengthTicks - 30), pitch: Math.max(low, Math.min(high, c.pitch)) })); }, [p.clip.lengthTicks, low, high]);
    const initialY = useRef(Math.max(0, (high - (p.clip.notes.length ? p.clip.notes.reduce((n, note) => n + note[2], 0) / p.clip.notes.length : 60)) * ROW - 150));
    const responder = useMemo(() => PanResponder.create({
        onStartShouldSetPanResponderCapture: e => e.nativeEvent.touches.length === 2,
        onMoveShouldSetPanResponderCapture: e => e.nativeEvent.touches.length === 2,
        onPanResponderGrant: e => { pinch.current = { distance: distance(e), scale: latest.current.scale }; setActive(true); },
        onPanResponderMove: e => { if (pinch.current && e.nativeEvent.touches.length === 2) latest.current.setScale(pinchScale(pinch.current.scale, pinch.current.distance, distance(e))); },
        onPanResponderRelease: () => { pinch.current = null; setActive(false); },
        onPanResponderTerminate: () => { pinch.current = null; setActive(false); },
        onPanResponderTerminationRequest: () => false,
    }), []);
    const width = Math.max(300, p.clip.lengthTicks * p.scale + 44), height = (high - low + 1) * ROW;
    const lineUnit = p.snap || 240;
    const advance = (ticks: number, notes: number) => setCursor({ tick: Math.max(0, Math.min(p.clip.lengthTicks - 30, tick + ticks)), pitch: Math.max(low, Math.min(high, pitch + notes)) });
    return <View style={s.section}>
        <Text accessibilityRole="header">{t('beatPiano.title')}</Text>
        <Text>{t('beatPiano.hint')}</Text>
        <View {...responder.panHandlers}>
            <ScrollView ref={vertical} style={{ height: 308 }} nestedScrollEnabled scrollEnabled={!active} onLayout={() => vertical.current?.scrollTo({ y: initialY.current, animated: false })}>
                <View style={{ flexDirection: 'row' }}>
                    <View style={{ width: KEYS_WIDTH }}>{Array.from({ length: high - low + 1 }, (_, i) => high - i).map(n => <View key={n} style={[s.gridRow, { height: ROW, justifyContent: 'center' }, n % 12 === 0 && s.cRow]}><Text variant={n % 12 === 0 ? 'bodyStrong' : 'caption'}>{noteLabel(n)}</Text></View>)}</View>
                    <ScrollView horizontal nestedScrollEnabled scrollEnabled={!active}>
                        <View style={{ width, height }}>
                            <Pressable accessible={false} disabled={p.disabled} style={{ width, height, position: 'absolute' }} onPress={e => p.add(xToTick(e.nativeEvent.locationX, p.scale, p.snap, p.clip.lengthTicks), yToPitch(e.nativeEvent.locationY, high, low))}>
                                {Array.from({ length: high - low + 1 }, (_, i) => <View pointerEvents="none" key={i} style={[s.gridRow, { height: ROW }, (high - i) % 12 === 0 && s.cRow]} />)}
                                {Array.from({ length: Math.ceil(p.clip.lengthTicks / lineUnit) }, (_, i) => i * lineUnit).map(n => <View pointerEvents="none" key={n} style={[s.gridLine, { left: n * p.scale, opacity: n % 960 ? 0.4 : 1 }, n % 3840 === 0 && s.barLine]} />)}
                            </Pressable>
                            {p.clip.notes.map(note => <BeatRollNote key={noteKey(note)} {...p} note={note} high={high} active={setActive} />)}
                        </View>
                    </ScrollView>
                </View>
            </ScrollView>
        </View>
        <Text accessibilityLiveRegion="polite">{t('beatPiano.cursor', { ...notePosition(tick), note: noteLabel(pitch) })}</Text>
        <View style={s.row}>
            <Button label={t('beatPiano.cursorLeft')} onPress={() => advance(-(p.snap || 30), 0)} />
            <Button label={t('beatPiano.cursorRight')} onPress={() => advance(p.snap || 30, 0)} />
            <Button label={t('beatPiano.cursorDown')} onPress={() => advance(0, -1)} />
            <Button label={t('beatPiano.cursorUp')} onPress={() => advance(0, 1)} />
            <Button label={t('beatPiano.toggle')} disabled={p.disabled} onPress={() => { const key = `${tick}:${pitch}`; if (p.clip.notes.some(n => noteKey(n) === key)) p.removeAt(key); else p.add(tick, pitch); }} />
        </View>
    </View>;
}
