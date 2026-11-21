import { BeatExportSheet } from '../../../components/beats/BeatExportSheet';
import { releaseExportPlayback } from '../../../lib/beatNative/exportPlayback';
import { BeatRecordPanel } from '../../../components/beats/BeatRecordPanel';
import { BeatTakeLanes } from '../../../components/beats/BeatTakeLanes';
import { useTakeRecording } from '../../../lib/beatNative/useTakeRecording';
import { addAudioTrack } from '../../../lib/beatNative/takeShared';
import { replacementUnderway, subscribeReplacements } from '../../../lib/beatNative/recordingFinalizers';
import type { RecordingEdit } from '../../../lib/beatNative/takeShared';
import type { TakeRecording } from '../../../lib/beatNative/takeRecording';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { ScrollView, View } from 'react-native';
import { Button, SegmentedControl, Text, themedStyles, useThemedStyles } from '../../../components/ui';
import { EmptyState } from '../../../components/EmptyState';
import { MusicNotice } from '../../../components/music/MusicNotice';
import { PadGrid } from '../../../components/beats/PadGrid';
import { StepGrid } from '../../../components/beats/StepGrid';
import { BeatMixerSheet } from '../../../components/beats/BeatMixerSheet';
import { automationControl, type MixDoc } from '../../../lib/beatNative/mix';
import { BeatInstrumentsSection, openPiano } from '../../../components/beats/BeatInstrumentsSection';
import { BeatArrangement } from '../../../components/beats/BeatArrangement';
import { MixerStrip } from '../../../components/beats/MixerStrip';
import { createBeatAudio, type BeatAudio } from '../../../lib/beatNative/audio';
import {
    addKitTrack, audibleGain, DRUM_KITS, MAX_BPM, MAX_TRACKS, MIN_BPM, removeTrack, setTempo, setTrackGain, setTrackKit, setTrackMute, setTrackPan, setTrackSolo, toggleStep, tryOp, setView,
    type BeatDoc, type Edit, type PadId,
} from '../../../lib/beatNative/doc';
import { beatStore, getBeat, listBeats, putBeat, subscribeBeats } from '../../../lib/beatNative/store';
import { t } from '../../../lib/i18n';
import { useAnnouncement } from '../../../lib/useAnnouncement';
import { ds } from '../../../theme';

import { createHistory, record, replacePresent, travel, canUndo, canRedo, type History } from '../../../lib/beatNative/history';
import { useLocalBeatLifecycle } from '../../../lib/beatNative/useLocalBeatLifecycle';
import { BeatSaveControls } from '../../../components/beats/BeatSaveControls';

const clampBpm = (n: number) => Math.min(MAX_BPM, Math.max(MIN_BPM, n));

export default function BeatEditor() {
    const { id } = useLocalSearchParams<{ id: string }>();
    useSyncExternalStore(subscribeBeats, listBeats, listBeats);
    const doc = getBeat(String(id));
    const s = useThemedStyles(sheets);
    const history = useRef<History | null>(null);
    if (doc && history.current?.present !== doc) history.current = createHistory(doc);
    const recordingRef = useRef<TakeRecording | null>(null);
    const audio = useRef<BeatAudio | null>(null);
    const manualRun = useRef(false);
    const docRef = useRef<BeatDoc | undefined>(doc);
    docRef.current = doc;
    const [held, setHeld] = useState(false);
    const [pad, setPad] = useState<PadId>('kick');
    const [mixer, setMixer] = useState(false);
    const [exporting, setExporting] = useState(false);
    const [playing, setPlaying] = useState(false);
    const [step, setStep] = useState<number | null>(null);
    const [notice, setNotice] = useState<string | null>(null);
    const [said, setSaid] = useState<string | null>(null);
    useAnnouncement(notice ?? said, { everywhere: true });
    useLocalBeatLifecycle();
    useEffect(() => () => { void recordingRef.current?.finishAndDisarm().finally(() => { void audio.current?.close(); audio.current = null; }); }, []);

    // The native module is touched only when the person first asks for sound.
    const engine = useCallback((): BeatAudio | null => {
        if (audio.current) return audio.current;
        try { audio.current = createBeatAudio(); return audio.current; } catch { setNotice(t('beat.audioError')); return null; }
    }, []);
    // Third argument: N5's history key (a slider drag is one undo step) or N6's options; both forms are accepted.
    const apply = useCallback((operation: Edit, announce?: string, third?: string | { recordingCommit?: boolean; key?: string }) => {
        const options = typeof third === 'string' ? { key: third } : third ?? {};
        const key = options.key;
        const current = docRef.current;
        if (!current) return false;
        if ((recordingRef.current?.locked() || replacementUnderway(current.id)) && !options?.recordingCommit) { setNotice(t(replacementUnderway(current.id) ? 'beatTakes.replacing' : 'beatTakes.locked')); return false; }
        let result;
        try { result = tryOp(current, operation); } catch { setNotice(t('beat.refused', { reason: '' })); return false; }
        if (result.refused) { setNotice(t('beat.refused', { reason: result.refused })); return false; }
        if (result.doc !== current) {
            if (!putBeat(result.doc)) { setNotice(t('beat.local.busy')); return false; }
            docRef.current = getBeat(current.id)!;
            history.current = record(history.current ?? createHistory(current), docRef.current, { label: announce, key });
        }
        setNotice(null); setSaid(announce ?? null); return true;
    }, []);

    const currentDoc = useCallback(() => docRef.current!, []);
    const recordingEdit = useCallback<RecordingEdit>((edit, options) => apply(edit, options?.message ?? t('beatTakes.recordingSaved'), options), [apply]);
    const takes = useTakeRecording(String(id), doc, { current: currentDoc, audio: engine, edit: recordingEdit, t });
    recordingRef.current = takes.controller;
    const wasRecording = useRef(false);
    useEffect(() => {
        const active = ['recording', 'finishing'].includes(takes.view.status);
        if (active || wasRecording.current) setPlaying(active);
        wasRecording.current = active;
    }, [takes.view.status]);
    const replacing = useSyncExternalStore(subscribeReplacements, () => replacementUnderway(String(id)), () => false);
    const locked = takes.controller.locked() || replacing;
    useEffect(() => { if (!replacing) setNotice(message => message === t('beatTakes.replacing') ? null : message); }, [replacing]);

    const navigateHistory = (direction: 'undo' | 'redo') => {
        if (!history.current || recordingRef.current?.locked() || replacementUnderway(String(id))) return;
        const next = travel(history.current, direction);
        if (next === history.current) return;
        if (!putBeat(next.present)) { setNotice(t('beat.local.busy')); return; }
        docRef.current = getBeat(next.present.id)!;
        history.current = replacePresent(next, docRef.current);
    };
    if (!doc && beatStore.hydrationState() !== 'ready') return <><Text accessibilityLiveRegion="polite">{t(beatStore.hydrationState() === 'error' ? 'beat.local.loadError' : 'beat.home.checking')}</Text><Button label={t('beat.retry')} onPress={() => void beatStore.hydrateBeats().catch(() => undefined)} /></>;
    if (!doc) return <EmptyState title={t('beat.missing')} body={t('beat.missingBody')} actionLabel={t('beat.back')} href="/beats" />;
    const play = async () => {
        const a = engine(); if (!a) return;
        try { let failed = false; await a.play(() => docRef.current as BeatDoc, n => setStep(n), undefined, 0, { onError: () => { failed = true; setPlaying(false); setStep(null); setNotice(t('beat.audioError')); }, onEffectError: () => setNotice(t('beatMix.fx.unavailable')) }); if (!failed) { manualRun.current = false; setPlaying(true); setSaid(t('beat.playing')); } } catch { setNotice(t('beat.audioError')); }
    };
    const stop = () => { audio.current?.stop(); setPlaying(false); setStep(null); setSaid(t('beat.stopped')); };
    const hit = (p: PadId) => { setPad(p); engine()?.hitPad(p, doc.tracks.find(track => !track.kind || track.kind === 'drums')?.kit ?? DRUM_KITS[0].id); };
    const mixOf = (trackId: string, next: BeatDoc) => {
        const track = next.tracks.find(x => x.id === trackId);
        if (track) audio.current?.setTrackMix(trackId, { gain: audibleGain(next, track), pan: track.pan });
    };
    const mix = (trackId: string, operation: Edit, announce?: string, key?: string) => {
        apply(operation, announce, key);
        const next = getBeat(doc.id); if (next) { mixOf(trackId, next); next.tracks.forEach(x => mixOf(x.id, next)); }
    };
    const nameOf = (i: number) => t('beat.track', { n: i + 1 });
    const bpm = doc.tempo.bpm;
    const bump = (by: number) => apply(d => setTempo(d, clampBpm(bpm + by)));
    return (
        <ScrollView scrollEnabled={!held} style={s.screen} contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
            <Stack.Screen options={{ title: doc.title }} />
            <BeatSaveControls id={doc.id} apply={apply} />
            <Button label={t('beatExport.title')} onPress={() => setExporting(true)} />
            {exporting && <BeatExportSheet doc={doc} replacing={replacing} recording={['opening', 'armed', 'recording', 'finishing'].includes(takes.view.status)}
                prepare={() => releaseExportPlayback(audio, recordingRef, stop)} onClose={() => setExporting(false)} />}
            <Button label={t('beat.undo')} disabled={locked || !history.current || !canUndo(history.current) || beatStore.saveState(doc.id) === 'busy'} onPress={() => navigateHistory('undo')} />
            <Button label={t('beat.redo')} disabled={locked || !history.current || !canRedo(history.current) || beatStore.saveState(doc.id) === 'busy'} onPress={() => navigateHistory('redo')} />
            {replacing ? <Text accessibilityLiveRegion="polite">{t('beatTakes.replacing')}</Text> : null}
            <BeatRecordPanel doc={doc} controller={takes.controller} view={takes.view} playing={playing} />
            {notice ? <MusicNotice message={notice} /> : null}
            <View style={s.transport} accessibilityLabel={t('beat.transport')}>
                <Button label={playing ? t('beat.stop') : t('beat.play')} disabled={locked} onPress={() => void (playing ? stop() : play())} containerStyle={s.play} />
                <View style={s.tempo} accessibilityLabel={t('beat.tempo')}>
                    <View style={s.stepper}>
                        <Button size="md" variant="secondary" label="−5" accessibilityLabel={t('beat.tempoDown5')} onPress={() => bump(-5)} disabled={bpm <= MIN_BPM} containerStyle={s.flex} />
                        <Button size="md" variant="secondary" label="−" accessibilityLabel={t('beat.tempoDown')} onPress={() => bump(-1)} disabled={bpm <= MIN_BPM} containerStyle={s.flex} />
                        <Button size="md" variant="secondary" label="+" accessibilityLabel={t('beat.tempoUp')} onPress={() => bump(1)} disabled={bpm >= MAX_BPM} containerStyle={s.flex} />
                        <Button size="md" variant="secondary" label="+5" accessibilityLabel={t('beat.tempoUp5')} onPress={() => bump(5)} disabled={bpm >= MAX_BPM} containerStyle={s.flex} />
                    </View>
                    <Text variant="title3" accessibilityLiveRegion="polite">{t('beat.tempoValue', { bpm })}</Text>
                </View>
            </View>
            <SegmentedControl value={doc.view} accessibilityLabel={t('beat.view.label')}
                options={[{ value: 'pattern', label: t('beat.view.pattern') }, { value: 'song', label: t('beat.view.song') }]}
                onChange={view => apply(d => setView(d, view), t('beat.view.changed'))} />
            {doc.view === 'song' ? <BeatArrangement manualRun={manualRun} key={doc.id} doc={doc} apply={apply} playing={playing} step={step} announce={setSaid} onHold={setHeld} /> : <>
            <Text variant="bodyStrong" accessibilityRole="header">{t('beat.pads')}</Text>
            <PadGrid selected={pad} onHit={hit} />
            <Text variant="bodyStrong" accessibilityRole="header">{t('beat.steps', { pad: t(`beat.pad.${pad}`) })}</Text>
            <StepGrid doc={doc} pad={pad} current={playing ? step : null} onToggle={n => apply(d => toggleStep(d, pad, n))} />
            </>}
            <Text variant="bodyStrong" accessibilityRole="header">{t('beat.mixer')}</Text>
            <Button label={t('beatMix.title')} onPress={() => setMixer(true)} />
            {mixer && <BeatMixerSheet doc={doc} audio={audio.current} apply={apply} playing={playing} step={step} notice={notice} onClose={() => setMixer(false)} />}
            {doc.tracks.map((track, i) => (
                <View key={track.id}><MixerStrip track={track} index={i} canRemove={doc.tracks.length > 1}
                    gainLocked={automationControl(track, 'gain', (doc as MixDoc).view).disabled ? t('beatMix.locked.gain') : undefined}
                    panLocked={automationControl(track, 'pan', (doc as MixDoc).view).disabled ? t('beatMix.locked.pan') : undefined}
                    onGain={v => mix(track.id, d => setTrackGain(d, track.id, Math.round(v * 100) / 100), undefined, `${track.id}:gain`)}
                    onPan={v => mix(track.id, d => setTrackPan(d, track.id, v), undefined, `${track.id}:pan`)}
                    onMute={v => mix(track.id, d => setTrackMute(d, track.id, v), t(v ? 'beat.muted' : 'beat.unmuted', { track: nameOf(i) }))}
                    onSolo={v => mix(track.id, d => setTrackSolo(d, track.id, v), t(v ? 'beat.soloOn' : 'beat.soloOff', { track: nameOf(i) }))}
                    onKit={kit => apply(d => setTrackKit(d, track.id, kit))}
                    onRemove={() => apply(d => removeTrack(d, track.id))} />
                    <BeatTakeLanes doc={doc} track={track} apply={apply} locked={locked} />
                </View>
            ))}
            <BeatInstrumentsSection doc={doc} apply={apply} audio={engine} onOpen={regionId => { stop(); openPiano(doc.id, regionId); }} />
            <Button variant="secondary" label={t('beat.track.add')} disabled={doc.tracks.length >= MAX_TRACKS}
                onPress={() => apply(d => addKitTrack(d, DRUM_KITS[0].id))} />
            <Button variant="secondary" label={t('beatTakes.addTrack')} disabled={locked || doc.tracks.length >= MAX_TRACKS} onPress={() => apply(d => addAudioTrack(d))} />
            {doc.tracks.length >= MAX_TRACKS ? <Text variant="footnote" tone="secondary">{t('beat.track.max', { max: MAX_TRACKS })}</Text> : null}
        </ScrollView>
    );
}
const sheets = themedStyles(p => ({
    screen: { flex: 1, backgroundColor: p.bg },
    content: { padding: ds.space.gutter, gap: ds.space.lg, paddingBottom: ds.space.hero },
    transport: { gap: ds.space.md },
    play: { alignSelf: 'stretch' },
    tempo: { gap: ds.space.sm, alignItems: 'center' },
    stepper: { flexDirection: 'row', gap: ds.space.sm },
    flex: { flex: 1 },
}));
