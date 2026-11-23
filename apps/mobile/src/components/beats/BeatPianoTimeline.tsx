import { useCallback, useEffect, useMemo, useRef, useState, type ComponentRef } from 'react';
import { PanResponder, ScrollView, View, type GestureResponderEvent, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import { Button, Text, useThemedStyles } from '../ui';
import { BeatHardwareKeySurface } from './BeatHardwareKeySurface';
import { BeatPianoRoll } from './BeatPianoRoll';
import { BeatVelocityLane } from './BeatVelocityLane';
import { pianoStyles } from './pianoStyles';
import type { NoteActions } from './BeatNoteActions';
import { KEYS_WIDTH, ROW, notePosition, pinchScale, pitchRange } from '../../lib/beatNative/rollGeometry';
import { noteKey, noteLabel, type MidiClip } from '../../lib/beatNative/midi';
import { pianoHardwareCommand, type PianoHardwareKeyEvent } from '../../lib/beatNative/pianoHardwareKeys';
import { t } from '../../lib/i18n';

const distance = (event: GestureResponderEvent) => { const [a, b] = event.nativeEvent.touches; return a && b ? Math.hypot(a.pageX - b.pageX, a.pageY - b.pageY) : 0; };

type Props = {
    clip: MidiClip; selected: string[]; toggle(key: string): void; select(keys: string[]): void;
    add(tick: number, pitch: number): void; removeAt(key: string): void; snap: number; scale: number;
    setScale(value: number): void; actions: NoteActions; disabled: boolean; rollHeight: number;
};

export function BeatPianoTimeline(p: Props) {
    const s = useThemedStyles(pianoStyles), labels = useRef<ComponentRef<typeof ScrollView>>(null), vertical = useRef<ComponentRef<typeof ScrollView>>(null);
    const [active, setActive] = useState(false), [cursor, setCursor] = useState({ tick: 0, pitch: 60 });
    const latest = useRef(p); latest.current = p;
    const pinch = useRef<{ distance: number; scale: number } | null>(null);
    const { high, low } = pitchRange(p.clip), width = Math.max(300, p.clip.lengthTicks * p.scale + 44), height = (high - low + 1) * ROW;
    const tick = Math.min(cursor.tick, p.clip.lengthTicks - 30), pitch = Math.max(low, Math.min(high, cursor.pitch));
    const initialY = useRef(Math.max(0, (high - (p.clip.notes.length ? p.clip.notes.reduce((sum, note) => sum + note[2], 0) / p.clip.notes.length : 60)) * ROW - p.rollHeight / 2));
    useEffect(() => { setCursor(value => ({ tick: Math.min(value.tick, p.clip.lengthTicks - 30), pitch: Math.max(low, Math.min(high, value.pitch)) })); }, [p.clip.lengthTicks, low, high]);
    const responder = useMemo(() => PanResponder.create({
        onStartShouldSetPanResponderCapture: event => event.nativeEvent.touches.length === 2,
        onMoveShouldSetPanResponderCapture: event => event.nativeEvent.touches.length === 2,
        onPanResponderGrant: event => { pinch.current = { distance: distance(event), scale: latest.current.scale }; setActive(true); },
        onPanResponderMove: event => { if (pinch.current && event.nativeEvent.touches.length === 2) latest.current.setScale(pinchScale(pinch.current.scale, pinch.current.distance, distance(event))); },
        onPanResponderRelease: () => { pinch.current = null; setActive(false); },
        onPanResponderTerminate: () => { pinch.current = null; setActive(false); },
        onPanResponderTerminationRequest: () => false,
    }), []);
    const advance = useCallback((ticks: number, notes: number) => setCursor(value => ({
        tick: Math.max(0, Math.min(p.clip.lengthTicks - 30, value.tick + ticks)),
        pitch: Math.max(low, Math.min(high, value.pitch + notes)),
    })), [high, low, p.clip.lengthTicks]);
    const toggleCursor = useCallback(() => {
        const key = `${tick}:${pitch}`;
        if (p.clip.notes.some(note => noteKey(note) === key)) p.removeAt(key); else p.add(tick, pitch);
    }, [p, pitch, tick]);
    const onKeyCommand = useCallback((event: PianoHardwareKeyEvent) => {
        const command = pianoHardwareCommand(event, p.snap || 30, p.selected.length > 0);
        if (!command || p.disabled) return;
        if (command.type === 'selectAll') p.actions.selectAll();
        else if (command.type === 'clear') p.actions.clear();
        else if (command.type === 'delete') { if (p.selected.length) p.actions.remove(); }
        else if (command.type === 'toggleCursor') toggleCursor();
        else if (command.type === 'velocity') p.actions.velocity(command.delta);
        else if (command.type === 'resize') p.actions.resize(command.ticks);
        else if (command.type === 'move') p.actions.move(command.ticks, command.pitch);
        else if (command.type === 'cursor') advance(command.ticks, command.pitch);
    }, [advance, p, toggleCursor]);
    const syncPitchLabels = (event: NativeSyntheticEvent<NativeScrollEvent>) => labels.current?.scrollTo({ y: event.nativeEvent.contentOffset.y, animated: false });
    return <BeatHardwareKeySurface active={!p.disabled} onKeyCommand={onKeyCommand}>
        <View style={s.section}>
            <Text accessibilityRole="header">{t('beatPiano.title')}</Text>
            <Text>{t('beatPiano.hint')}</Text>
            <View style={s.timelineShell} {...responder.panHandlers}>
                <ScrollView ref={labels} style={{ width: KEYS_WIDTH, height: p.rollHeight }} scrollEnabled={false} showsVerticalScrollIndicator={false}>
                    {Array.from({ length: high - low + 1 }, (_, i) => high - i).map(note => <View key={note} style={[s.gridRow, s.pitchLabel, note % 12 === 0 && s.cRow]}><Text variant={note % 12 === 0 ? 'bodyStrong' : 'caption'}>{noteLabel(note)}</Text></View>)}
                </ScrollView>
                <ScrollView horizontal testID="beat-piano-timeline-scroll" scrollEnabled={!active} style={s.timelineScroll} contentContainerStyle={s.timelineContentLtr}>
                    <View style={{ width }}>
                        <ScrollView ref={vertical} style={{ height: p.rollHeight }} nestedScrollEnabled scrollEnabled={!active} onScroll={syncPitchLabels} scrollEventThrottle={16}
                            onLayout={() => { vertical.current?.scrollTo({ y: initialY.current, animated: false }); labels.current?.scrollTo({ y: initialY.current, animated: false }); }}>
                            <BeatPianoRoll {...p} select={p.select} high={high} low={low} width={width} height={height} active={setActive} />
                        </ScrollView>
                        <Text accessibilityRole="header">{t('beatPiano.velocity')}</Text>
                        <BeatVelocityLane clip={p.clip} selected={p.selected} toggle={p.toggle} scale={p.scale} velocity={p.actions.velocity} disabled={p.disabled} width={width} active={setActive} />
                    </View>
                </ScrollView>
            </View>
            <Text accessibilityLiveRegion="polite">{t('beatPiano.cursor', { ...notePosition(tick), note: noteLabel(pitch) })}</Text>
            <View style={s.row}>
                <Button label={t('beatPiano.cursorLeft')} onPress={() => advance(-(p.snap || 30), 0)} />
                <Button label={t('beatPiano.cursorRight')} onPress={() => advance(p.snap || 30, 0)} />
                <Button label={t('beatPiano.cursorDown')} onPress={() => advance(0, -1)} />
                <Button label={t('beatPiano.cursorUp')} onPress={() => advance(0, 1)} />
                <Button label={t('beatPiano.toggle')} disabled={p.disabled} onPress={toggleCursor} />
            </View>
        </View>
    </BeatHardwareKeySurface>;
}
