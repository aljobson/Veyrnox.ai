import { Stack } from 'expo-router';
import * as Sharing from 'expo-sharing';
import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { DRUM_PADS, GUITAR_CHORDS, GUITAR_FRETS, GUITAR_STRINGS, INSTRUMENTS, INSTRUMENT_IDS, MAX_TAKE_EVENTS, MAX_TAKE_SECONDS, PRESETS, chordNotes, isBlackKey, keyRange, noteLabel, type Chord, type Pad, type Preset } from '../../lib/instrumentShared';
import { t } from '../../lib/i18n';
import { useAnnouncement } from '../../lib/useAnnouncement';
import { touchTarget } from '../../lib/a11y';
import { playFile, playVoice, prepareInstrumentAudio, releaseInstrumentAudio, renderTakeFile, type RawTake } from '../../lib/instrumentPlayer';
import { deleteTake, listTakes, saveTake, type StoredTake } from '../../lib/instrumentTakes';
import { getCacheUser } from '../../lib/appCache';
import { colors } from '../../theme';

// Plays on the phone by rendering each voice to a small WAV once (pure JS), then replaying it from a player pool.
export default function Instruments() {
    const [instrument, setInstrument] = useState('piano');
    const [preset, setPreset] = useState('grand');
    const [shift, setShift] = useState(0);
    const [recording, setRecording] = useState(false);
    const [takes, setTakes] = useState<StoredTake[]>([]);
    const [messageKey, setMessageKey] = useState('instruments.idle');
    const message = t(messageKey);
    useAnnouncement(message);
    const rec = useRef<{ on: boolean; started: number; events: RawTake['events'] }>({ on: false, started: 0, events: [] });
    const state = useRef({ instrument, preset });
    state.current = { instrument, preset };

    useEffect(() => {
        prepareInstrumentAudio();
        const user = getCacheUser();
        let live = true;
        if (user) listTakes(user).then((rows) => { if (live) setTakes(rows); }).catch(() => undefined);
        return () => { live = false; releaseInstrumentAudio(); };
    }, []);

    const hit = (value: number | string, vel = 0.85) => {
        const { instrument: inst, preset: pre } = state.current;
        playVoice(inst, pre, value, vel);
        const r = rec.current;
        const at = (Date.now() - r.started) / 1000;
        if (r.on && r.events.length < MAX_TAKE_EVENTS && at <= MAX_TAKE_SECONDS) r.events.push({ at, dur: 0.4, vel, value });
    };

    const choose = (id: string) => {
        setInstrument(id);
        setPreset(PRESETS[id][0].id);
        setShift(0);
    };

    const toggleRecord = () => {
        const r = rec.current;
        if (!r.on) {
            rec.current = { on: true, started: Date.now(), events: [] };
            setRecording(true);
            setMessageKey('instruments.recording');
            return;
        }
        r.on = false;
        setRecording(false);
        const rendered = renderTakeFile({ instrument, preset, events: r.events });
        if (!rendered) { setMessageKey('instruments.nothing'); return; }
        const user = getCacheUser();
        const presetLabel = (PRESETS[instrument] as Preset[]).find((p) => p.id === preset)?.label ?? preset;
        const label = `${INSTRUMENTS[instrument].label} · ${presetLabel}`;
        if (!user) {
            setTakes((current) => [{ id: `unsaved-${Date.now()}`, label, name: '', seconds: rendered.seconds, createdAt: Date.now(), uri: rendered.uri }, ...current]);
            setMessageKey('instruments.captured');
            return;
        }
        saveTake(user, label, rendered.uri, rendered.seconds).then((saved) => {
            if (!saved) { setMessageKey('instruments.saveFailed'); return; }
            setTakes((current) => [saved, ...current.filter((item) => item.id !== saved.id)].slice(0, 12));
            setMessageKey('instruments.savedMsg');
        });
    };

    const remove = (item: StoredTake) => {
        const user = getCacheUser();
        setTakes((current) => current.filter((row) => row.id !== item.id));
        if (user && item.name) deleteTake(user, item.id).catch(() => undefined);
    };

    const share = async (item: StoredTake) => {
        try {
            if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(item.uri, { mimeType: 'audio/wav', UTI: 'com.microsoft.waveform-audio' });
            else setMessageKey('instruments.shareNo');
        } catch { setMessageKey('instruments.shareFail'); }
    };

    const keys = keyRange(instrument, shift);
    const presets: Preset[] = PRESETS[instrument];
    const whites = keys.filter((n) => !isBlackKey(n));

    return (
        <>
            <Stack.Screen options={{ title: t('instruments.title') }} />
            <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
                <Text style={styles.title} accessibilityRole="header">{t('instruments.headline')}</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
                    {INSTRUMENT_IDS.map((id: string) => (
                        <Pressable key={id} accessibilityRole="tab" accessibilityState={{ selected: instrument === id }} onPress={() => choose(id)} style={[styles.chip, instrument === id && styles.chipOn]}>
                            <Text style={[styles.chipText, instrument === id && styles.chipTextOn]}>{INSTRUMENTS[id].glyph} {INSTRUMENTS[id].label}</Text>
                        </Pressable>
                    ))}
                </ScrollView>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
                    {presets.map((p) => (
                        <Pressable key={p.id} accessibilityRole="button" accessibilityState={{ selected: preset === p.id }} accessibilityHint={p.hint} onPress={() => setPreset(p.id)} style={[styles.chip, preset === p.id && styles.chipOn]}>
                            <Text style={[styles.chipText, preset === p.id && styles.chipTextOn]}>{p.label}</Text>
                        </Pressable>
                    ))}
                </ScrollView>

                {INSTRUMENTS[instrument].surface === 'keys' ? (
                    <View>
                        <View style={styles.row}>
                            <Pressable accessibilityRole="button" style={styles.small} onPress={() => setShift((v) => Math.max(-2, v - 1))}><Text style={styles.smallText}>{t('instruments.octaveDown')}</Text></Pressable>
                            <Pressable accessibilityRole="button" style={styles.small} onPress={() => setShift((v) => Math.min(2, v + 1))}><Text style={styles.smallText}>{t('instruments.octaveUp')}</Text></Pressable>
                        </View>
                        <ScrollView horizontal contentContainerStyle={styles.keyboard}>
                            {whites.map((note) => {
                                const sharp = keys.includes(note + 1) && isBlackKey(note + 1) ? note + 1 : null;
                                return (
                                    <View key={note} style={styles.keyWrap}>
                                        <Pressable accessibilityRole="button" accessibilityLabel={noteLabel(note)} onPressIn={() => hit(note)} style={({ pressed }) => [styles.white, pressed && styles.keyDown]}>
                                            <Text style={styles.keyLabel}>{noteLabel(note)}</Text>
                                        </Pressable>
                                        {sharp ? <Pressable accessibilityRole="button" accessibilityLabel={noteLabel(sharp)} onPressIn={() => hit(sharp)} style={({ pressed }) => [styles.black, pressed && styles.keyDown]} /> : null}
                                    </View>
                                );
                            })}
                        </ScrollView>
                    </View>
                ) : INSTRUMENTS[instrument].surface === 'strings' ? (
                    <View style={{ gap: 6 }}>
                        <ScrollView horizontal contentContainerStyle={styles.chips}>
                            {GUITAR_CHORDS.map((chord: Chord) => (
                                <Pressable key={chord.id} accessibilityRole="button" accessibilityLabel={t('instruments.strum', { chord: chord.label })} style={styles.chord} onPress={() => chordNotes(chord).forEach((n, i) => setTimeout(() => hit(n.note, 0.7), i * 28))}>
                                    <Text style={styles.chordText}>{chord.label}</Text>
                                </Pressable>
                            ))}
                        </ScrollView>
                        {[...Array(GUITAR_STRINGS.length).keys()].reverse().map((string) => (
                            <View key={string} style={styles.row}>
                                {Array.from({ length: GUITAR_FRETS + 1 }, (_, fret) => {
                                    const note = GUITAR_STRINGS[string] + fret;
                                    return (
                                        <Pressable key={fret} accessibilityRole="button" accessibilityLabel={t('instruments.stringFret', { string: string + 1, fret })} onPressIn={() => hit(note)} style={({ pressed }) => [styles.fret, pressed && styles.keyDown]}>
                                            <Text style={styles.fretText}>{noteLabel(note)}</Text>
                                        </Pressable>
                                    );
                                })}
                            </View>
                        ))}
                    </View>
                ) : (
                    <View style={styles.pads}>
                        {DRUM_PADS.map((pad: Pad) => (
                            <Pressable key={pad.id} accessibilityRole="button" accessibilityLabel={pad.label} onPressIn={() => hit(pad.id, 0.9)} style={({ pressed }) => [styles.pad, pressed && styles.keyDown]}>
                                <Text style={styles.padText}>{pad.label}</Text>
                            </Pressable>
                        ))}
                    </View>
                )}

                <Pressable accessibilityRole="button" accessibilityState={{ selected: recording }} onPress={toggleRecord} style={[styles.primary, recording && styles.recording]}>
                    <Text style={styles.primaryText}>{recording ? t('instruments.stop') : t('instruments.record')}</Text>
                </Pressable>
                <Text style={styles.muted}>{message}</Text>

                {takes.length ? (
                    <View style={styles.takes}>
                        <Text style={styles.heading} accessibilityRole="header">{t('instruments.savedTitle')}</Text>
                        {takes.map((item) => (
                            <View key={item.id} style={styles.takeCard}>
                                <Text style={styles.takeLabel}>{item.label}</Text>
                                <View style={styles.row}>
                                    <Pressable accessibilityRole="button" style={styles.secondary} onPress={() => playFile(item.uri)}><Text style={styles.secondaryText}>{t('instruments.playTake', { seconds: item.seconds.toFixed(1) })}</Text></Pressable>
                                    <Pressable accessibilityRole="button" style={styles.secondary} onPress={() => share(item)}><Text style={styles.secondaryText}>{t('instruments.share')}</Text></Pressable>
                                    <Pressable accessibilityRole="button" style={styles.secondary} onPress={() => remove(item)}><Text style={styles.secondaryText}>{t('instruments.remove')}</Text></Pressable>
                                </View>
                            </View>
                        ))}
                    </View>
                ) : null}
            </ScrollView>
        </>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background },
    content: { padding: 16, gap: 12, paddingBottom: 48 },
    title: { color: colors.text, fontSize: 22, fontWeight: '700' },
    muted: { color: colors.muted, fontSize: 13 },
    chips: { gap: 8, paddingVertical: 2 },
    chip: { ...touchTarget, paddingHorizontal: 14, borderRadius: 22, borderWidth: 1, borderColor: colors.border },
    chipOn: { backgroundColor: colors.accent, borderColor: colors.accent },
    chipText: { color: colors.body, fontWeight: '600' },
    chipTextOn: { color: colors.accentInk },
    row: { flexDirection: 'row', gap: 6, alignItems: 'center' },
    small: { ...touchTarget, paddingHorizontal: 14, borderRadius: 22, borderWidth: 1, borderColor: colors.border },
    smallText: { color: colors.text, fontWeight: '600' },
    keyboard: { paddingVertical: 8 },
    keyWrap: { width: 46 },
    white: { height: 190, backgroundColor: '#fff', borderColor: colors.border, borderWidth: 1, borderBottomLeftRadius: 8, borderBottomRightRadius: 8, justifyContent: 'flex-end', alignItems: 'center', paddingBottom: 6 },
    black: { position: 'absolute', right: -13, top: 0, width: 26, height: 118, backgroundColor: '#0f172a', borderBottomLeftRadius: 6, borderBottomRightRadius: 6, zIndex: 2 },
    keyDown: { backgroundColor: colors.accent },
    keyLabel: { color: '#475569', fontSize: 10, fontWeight: '700' },
    chord: { ...touchTarget, paddingHorizontal: 18, borderRadius: 22, backgroundColor: colors.accent },
    chordText: { color: colors.accentInk, fontWeight: '700' },
    fret: { flex: 1, minHeight: 44, borderRadius: 6, borderBottomWidth: 2, borderColor: '#94a3b8', backgroundColor: 'rgba(120,53,15,0.35)', alignItems: 'center', justifyContent: 'center' },
    fretText: { color: colors.text, fontSize: 10, fontWeight: '700' },
    pads: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
    pad: { width: '47%', height: 96, borderRadius: 16, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
    padText: { color: colors.text, fontWeight: '800' },
    primary: { minHeight: 48, borderRadius: 12, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
    recording: { backgroundColor: '#ef4444' },
    primaryText: { color: colors.accentInk, fontWeight: '700', fontSize: 16 },
    takes: { gap: 8, marginTop: 8 },
    heading: { color: colors.text, fontSize: 17, fontWeight: '600' },
    takeCard: { gap: 6, padding: 12, borderRadius: 12, borderWidth: 1, borderColor: colors.border },
    takeLabel: { color: colors.body, fontSize: 14 },
    secondary: { ...touchTarget, flex: 1, borderRadius: 10, borderColor: colors.border, borderWidth: 1, alignItems: 'center' },
    secondaryText: { color: colors.accent, fontWeight: '600' },
});
