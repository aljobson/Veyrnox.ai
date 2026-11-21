import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { Button, Text, useThemedStyles } from '../ui';
import { pianoStyles } from './pianoStyles';
import { keyboardPitches } from '../../lib/beatNative/rollGeometry';
import { isBlackKey, noteLabel, type MidiSoundTrack } from '../../lib/beatNative/midi';
import type { BeatAudio } from '../../lib/beatNative/audio';
import { t } from '../../lib/i18n';
export function BeatKeyboard({ track, velocity, setVelocity, audio, onError }: { track: MidiSoundTrack; velocity: number; setVelocity(v: number): void; audio(): BeatAudio | null; onError(): void }) {
    const [octave, setOctave] = useState(0);
    const s = useThemedStyles(pianoStyles);
    // Do not create an audio context for cleanup alone.
    const used = useRef<BeatAudio | null>(null);
    useEffect(() => () => { used.current?.releaseKeys(); }, [octave, track.id]);
    return <View style={s.section}>
        <Text accessibilityRole="header">{t('beatPiano.keys.title')}</Text>
        <View style={s.row}>
            <Button label={t('beatPiano.keys.octaveDown')} disabled={octave <= -3} onPress={() => setOctave(octave - 1)} />
            <Text>{t('beatPiano.keys.octave', { n: 4 + octave })}</Text>
            <Button label={t('beatPiano.keys.octaveUp')} disabled={octave >= 2} onPress={() => setOctave(octave + 1)} />
            <Button label={t('beatPiano.keys.velocityDown')} disabled={velocity <= 1} onPress={() => setVelocity(Math.max(1, velocity - 16))} />
            <Text>{t('beatPiano.keys.velocity', { n: velocity })}</Text>
            <Button label={t('beatPiano.keys.velocityUp')} disabled={velocity >= 127} onPress={() => setVelocity(Math.min(127, velocity + 16))} />
        </View>
        <ScrollView horizontal accessibilityLabel={t('beatPiano.keys.title')}>
            {keyboardPitches(octave).map(pitch => <Pressable key={pitch} style={[s.key, isBlackKey(pitch) && s.black]} accessibilityRole="button" accessibilityLabel={t('beatPiano.keys.play', { note: noteLabel(pitch) })}
                onPressIn={() => { const a = audio(); if (a) { used.current = a; void a.noteOn(`touch:${pitch}`, track, pitch, velocity).catch(onError); } }}
                onPressOut={() => used.current?.noteOff(`touch:${pitch}`)}>
                <Text style={isBlackKey(pitch) ? s.blackText : undefined}>{noteLabel(pitch)}</Text>
            </Pressable>)}
        </ScrollView>
    </View>;
}
