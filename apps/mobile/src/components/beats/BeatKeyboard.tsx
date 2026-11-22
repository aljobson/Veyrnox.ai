import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Pressable, ScrollView, View } from 'react-native';
import { Button, Text, useThemedStyles } from '../ui';
import { pianoStyles } from './pianoStyles';
import { keyboardPitches } from '../../lib/beatNative/rollGeometry';
import { isBlackKey, noteLabel, type MidiSoundTrack } from '../../lib/beatNative/midi';
import type { BeatAudio } from '../../lib/beatNative/audio';
import { t } from '../../lib/i18n';

export type BeatKeyboardNoteSource = 'touch' | 'accessibility';
export type BeatKeyboardNoteEvent = {
    keyId: string;
    pitch: number;
    velocity: number;
    contextTime: number;
    source: BeatKeyboardNoteSource;
};

export type BeatKeyboardProps = {
    track: MidiSoundTrack;
    velocity: number;
    setVelocity(v: number): void;
    audio(): BeatAudio | null;
    onError(): void;
    onNoteOn?(event: BeatKeyboardNoteEvent): void;
    onNoteOff?(event: BeatKeyboardNoteEvent): void;
    /** Synchronous audio-clock reader. Defaults to BeatAudio.now when available. */
    clock?: () => number;
    /** VoiceOver activation length. The editor derives this from snap, with its 30-tick floor. */
    accessibilityNoteDurationMs?: number;
    captureActive?: boolean;
    disabled?: boolean;
};

type HeldNote = Omit<BeatKeyboardNoteEvent, 'contextTime'>;

export function BeatKeyboard(props: BeatKeyboardProps) {
    const { track, velocity, setVelocity, disabled = false } = props;
    const [octave, setOctave] = useState(0);
    const [heldPitches, setHeldPitches] = useState<ReadonlySet<number>>(() => new Set());
    const s = useThemedStyles(pianoStyles);
    const current = useRef(props);
    current.current = props;
    // Do not create an audio context for cleanup alone.
    const used = useRef<BeatAudio | null>(null);
    const held = useRef(new Map<number, HeldNote>());
    const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());
    const wasCapturing = useRef(!!props.captureActive);

    const clockNow = useCallback((audio: BeatAudio | null) => {
        if (current.current.clock) return current.current.clock();
        const now = (audio as (BeatAudio & { now?: () => number }) | null)?.now;
        return typeof now === 'function' ? now.call(audio) : 0;
    }, []);

    const end = useCallback((pitch: number) => {
        const note = held.current.get(pitch);
        if (!note) return;
        const timer = timers.current.get(pitch);
        if (timer) clearTimeout(timer);
        timers.current.delete(pitch);
        held.current.delete(pitch);
        setHeldPitches(new Set(held.current.keys()));
        used.current?.noteOff(note.keyId);
        current.current.onNoteOff?.({ ...note, contextTime: clockNow(used.current) });
    }, [clockNow]);

    const releaseAll = useCallback(() => {
        for (const pitch of [...held.current.keys()]) end(pitch);
        used.current?.releaseKeys();
    }, [end]);

    const begin = useCallback((pitch: number, source: BeatKeyboardNoteSource) => {
        if (current.current.disabled || held.current.has(pitch)) return;
        const audio = current.current.audio();
        const note: HeldNote = { keyId: `touch:${pitch}`, pitch, velocity: current.current.velocity, source };
        const event = { ...note, contextTime: clockNow(audio) };
        held.current.set(pitch, note);
        setHeldPitches(new Set(held.current.keys()));
        current.current.onNoteOn?.(event);
        if (audio) {
            used.current = audio;
            void audio.noteOn(note.keyId, current.current.track, pitch, note.velocity).catch(current.current.onError);
        }
    }, [clockNow]);

    const activate = useCallback((pitch: number) => {
        begin(pitch, 'accessibility');
        if (!held.current.has(pitch)) return;
        const duration = Math.max(1, current.current.accessibilityNoteDurationMs ?? 250);
        const prior = timers.current.get(pitch);
        if (prior) clearTimeout(prior);
        timers.current.set(pitch, setTimeout(() => end(pitch), duration));
    }, [begin, end]);

    useEffect(() => () => releaseAll(), [octave, track.id, track.instrument.engine, track.instrument.id, track.instrument.preset, releaseAll]);
    useEffect(() => {
        if (disabled || (wasCapturing.current && !props.captureActive)) releaseAll();
        wasCapturing.current = !!props.captureActive;
    }, [disabled, props.captureActive, releaseAll]);
    useEffect(() => {
        const sub = AppState.addEventListener('change', state => {
            if (state !== 'active') releaseAll();
        });
        return () => sub.remove();
    }, [releaseAll]);

    return <View style={s.section}>
        <Text accessibilityRole="header">{t('beatPiano.keys.title')}</Text>
        <View style={s.row}>
            <Button label={t('beatPiano.keys.octaveDown')} disabled={disabled || octave <= -3} onPress={() => setOctave(octave - 1)} />
            <Text>{t('beatPiano.keys.octave', { n: 4 + octave })}</Text>
            <Button label={t('beatPiano.keys.octaveUp')} disabled={disabled || octave >= 2} onPress={() => setOctave(octave + 1)} />
            <Button label={t('beatPiano.keys.velocityDown')} disabled={disabled || velocity <= 1} onPress={() => setVelocity(Math.max(1, velocity - 16))} />
            <Text>{t('beatPiano.keys.velocity', { n: velocity })}</Text>
            <Button label={t('beatPiano.keys.velocityUp')} disabled={disabled || velocity >= 127} onPress={() => setVelocity(Math.min(127, velocity + 16))} />
        </View>
        <ScrollView horizontal accessibilityLabel={t('beatPiano.keys.title')} style={s.keysLtr} contentContainerStyle={s.keysContentLtr}>
            {keyboardPitches(octave).map(pitch => {
                const heldNow = heldPitches.has(pitch);
                const note = noteLabel(pitch);
                const captureState = t(props.captureActive ? 'beat.midiRecord.key.capturing' : 'beat.midiRecord.key.audition');
                return <Pressable key={pitch} testID={`beat-key-${pitch}`}
                    style={[s.key, isBlackKey(pitch) && s.black, heldNow && s.keyHeld]}
                    accessibilityRole="button"
                    accessibilityLabel={props.captureActive
                        ? t('beat.midiRecord.key.label', { note, velocity, state: captureState })
                        : t('beatPiano.keys.play', { note })}
                    accessibilityHint={t('beat.midiRecord.key.hint')}
                    accessibilityState={{ selected: heldNow, disabled }}
                    disabled={disabled}
                    onAccessibilityTap={() => activate(pitch)}
                    onPressIn={() => begin(pitch, 'touch')}
                    onPressOut={() => end(pitch)}
                    onBlur={() => end(pitch)}
                    onResponderTerminate={() => end(pitch)}>
                    <Text style={[isBlackKey(pitch) ? s.blackText : undefined, s.keyLabelLtr]}>{note}</Text>
                </Pressable>;
            })}
        </ScrollView>
    </View>;
}
