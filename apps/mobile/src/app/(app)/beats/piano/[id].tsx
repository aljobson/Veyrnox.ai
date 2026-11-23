import { Stack, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { EmptyState } from '../../../../components/EmptyState';
import { MusicNotice } from '../../../../components/music/MusicNotice';
import { useAppearance, useThemedStyles } from '../../../../components/ui';
import { BeatPianoToolbar } from '../../../../components/beats/BeatPianoToolbar';
import { BeatPianoTimeline } from '../../../../components/beats/BeatPianoTimeline';
import { BeatNoteActions, type NoteActions } from '../../../../components/beats/BeatNoteActions';
import { BeatKeyboard } from '../../../../components/beats/BeatKeyboard';
import { pianoStyles } from '../../../../components/beats/pianoStyles';
import { createBeatAudio, type BeatAudio } from '../../../../lib/beatNative/audio';
import { audibleGain } from '../../../../lib/beatNative/doc';
import { addNote, asMidiDoc, deleteNotes, midiRegions, midiTracks, selectionAfterMove, moveNotes, noteKey, quantisedSelection, quantiseNotes, resizeNotes, velocityNotes } from '../../../../lib/beatNative/midi';
import { useBeatEdit } from '../../../../lib/beatNative/useBeatEdit';
import { useLocalBeatLifecycle } from '../../../../lib/beatNative/useLocalBeatLifecycle';
import { getBeat } from '../../../../lib/beatNative/store';
import { t } from '../../../../lib/i18n';
import { useAnnouncement } from '../../../../lib/useAnnouncement';
import { beatPianoLayout } from '../../../../lib/beatNative/pianoLayout';
import { TEXT_SCALE } from '../../../../theme';
import { KeyboardScreen } from '../../../../components/KeyboardScreen';
import { KeyboardFormScrollView } from '../../../../components/KeyboardFormScrollView';

export default function BeatPianoScreen() {
    const params = useLocalSearchParams<{ id: string; region: string }>(), id = String(params.id);
    const edit = useBeatEdit(id), { doc, apply } = edit;
    const audio = useRef<BeatAudio | null>(null), alive = useRef(true);
    const [playing, setPlaying] = useState(false), [snap, setSnap] = useState(240), [strength, setStrength] = useState(1);
    const [scale, setScale] = useState(0.1), [velocity, setVelocity] = useState(100), [selection, setSelection] = useState<string[]>([]);
    const s = useThemedStyles(pianoStyles);
    const { width, height, fontScale } = useWindowDimensions(), { settings } = useAppearance();
    const layout = beatPianoLayout(width, height, fontScale, TEXT_SCALE[settings.textSize]);
    useAnnouncement(edit.notice ?? edit.said, { everywhere: true });
    useLocalBeatLifecycle();
    useEffect(() => {
        alive.current = true;
        const close = () => { const a = audio.current; audio.current = null; a?.releaseKeys(); void a?.close().catch(() => undefined); };
        const listener = AppState.addEventListener('change', state => { if (state !== 'active') { close(); setPlaying(false); } });
        return () => { alive.current = false; listener.remove(); close(); };
    }, []);
    useEffect(() => { if (doc) for (const track of midiTracks(doc)) audio.current?.setTrackMix(track.id, { gain: audibleGain(doc, track), pan: track.pan }); }, [doc]);
    const engine = useCallback(() => {
        if (audio.current) return audio.current;
        try { audio.current = createBeatAudio(); return audio.current; }
        catch { edit.setNotice(t('beat.audioError')); return null; }
    }, [edit.setNotice]);
    const found = doc && midiRegions(doc).find(x => x.region.id === params.region);
    useEffect(() => { setSelection([]); audio.current?.releaseKeys(); }, [id, params.region, found?.region.clipId]);
    if (!doc || !found?.clip) return <EmptyState title={t('beatPiano.missing')} body={t('beatPiano.missingBody')} actionLabel={t('beat.back')} href={{ pathname: '/beats/[id]', params: { id } }} />;
    const { clip, region, track } = found;
    const selected = selection.filter(key => clip.notes.some(n => noteKey(n) === key));
    const toggle = (key: string) => setSelection(selected.includes(key) ? selected.filter(k => k !== key) : [...selected, key]);
    const actions: NoteActions = {
        move(ticks, pitch, keys = selected) {
            const before = asMidiDoc(getBeat(id) ?? doc).clips[region.clipId];
            if (apply(d => moveNotes(d, region.clipId, keys, ticks, pitch), t('beatPiano.moved'))) {
                const committed = asMidiDoc(getBeat(id)!).clips[region.clipId];
                setSelection(selectionAfterMove(before, committed, selected, keys, ticks, pitch));
            }
        },
        resize(delta, keys = selected) { apply(d => resizeNotes(d, region.clipId, keys, delta), t('beatPiano.resized')); },
        velocity(delta, keys = selected) { apply(d => velocityNotes(d, region.clipId, keys, delta), t('beatPiano.velocity')); },
        remove() { if (apply(d => deleteNotes(d, region.clipId, selected), t('beatPiano.delete'))) setSelection([]); },
        selectAll: () => setSelection(clip.notes.map(noteKey)), clear: () => setSelection([]),
    };
    const play = async () => {
        const a = engine(); if (!a) return;
        if (playing) { a.stop(); setPlaying(false); return; }
        try { await a.play(() => getBeat(id) ?? doc); if (alive.current && audio.current === a) setPlaying(a.isPlaying()); }
        catch { if (alive.current) edit.setNotice(t('beat.audioError')); }
    };
    const toolbar = <BeatPianoToolbar {...edit} doc={doc} clip={clip} region={region} playing={playing} togglePlay={() => void play()} snap={snap} setSnap={setSnap} strength={strength} setStrength={setStrength} scale={scale} setScale={setScale} quantise={() => {
            const next = quantisedSelection(clip, selected, snap, strength);
            if (apply(d => quantiseNotes(d, region.clipId, selected, snap, strength), t('beatPiano.quantise'))) setSelection(next);
        }} />;
    const timeline = <BeatPianoTimeline key={region.clipId} clip={clip} selected={selected} toggle={toggle} select={setSelection} snap={snap} scale={scale} setScale={setScale} actions={actions} disabled={edit.busy} rollHeight={layout.rollHeight}
            add={(tick, pitch) => apply(d => addNote(d, region.clipId, [tick, Math.min(snap || 30, clip.lengthTicks - tick), pitch, velocity]), t('beatPiano.added'))}
            removeAt={key => apply(d => deleteNotes(d, region.clipId, [key]), t('beatPiano.delete'))} />;
    const noteActions = !!selected.length && <BeatNoteActions actions={actions} unit={snap || 30} disabled={edit.busy} />;
    const keyboard = <BeatKeyboard compact={layout.compactKeyboard} track={{ ...track, gain: audibleGain(doc, track) }} velocity={velocity} setVelocity={setVelocity} audio={engine} onError={() => edit.setNotice(t('beat.audioError'))} />;
    return <SafeAreaView style={s.screen} edges={layout.dockKeyboard ? ['left', 'right'] : ['left', 'right', 'bottom']}>
        <Stack.Screen options={{ title: t('beatPiano.title') }} />
        <KeyboardScreen><KeyboardFormScrollView style={s.workspace} contentContainerStyle={[s.content, layout.mode === 'regular' && s.contentWide]} keyboardShouldPersistTaps="handled" nestedScrollEnabled>
            {edit.notice && <MusicNotice message={edit.notice} announce={false} />}
            {layout.mode === 'regular' ? <>
                <View style={s.main}>{timeline}{noteActions}</View>
                <View style={s.sidebar}>{toolbar}</View>
            </> : <>{toolbar}{timeline}{noteActions}</>}
            {!layout.dockKeyboard && keyboard}
        </KeyboardFormScrollView></KeyboardScreen>
        {layout.dockKeyboard && <SafeAreaView edges={['bottom']} style={s.keyboardDock}>{keyboard}</SafeAreaView>}
    </SafeAreaView>;
}
