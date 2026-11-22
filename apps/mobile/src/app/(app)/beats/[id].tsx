import { BeatExportSheet } from '../../../components/beats/BeatExportSheet';
import { releaseExportPlayback } from '../../../lib/beatNative/exportPlayback';
import { BeatLabsBar } from '../../../components/beats/BeatLabsBar';
import { PHONE_CAPABILITIES } from '../../../lib/beatNative/controls';
import { PHONE_TIP_TARGETS } from '../../../lib/beatNative/coachMarks';
import { BeatRecordPanel } from '../../../components/beats/BeatRecordPanel';
import { BeatTakeLanes } from '../../../components/beats/BeatTakeLanes';
import { useTakeRecording } from '../../../lib/beatNative/useTakeRecording';
import { addAudioTrack } from '../../../lib/beatNative/takeShared';
import { replacementUnderway, subscribeReplacements } from '../../../lib/beatNative/recordingFinalizers';
import type { RecordingEdit } from '../../../lib/beatNative/takeShared';
import type { TakeRecording } from '../../../lib/beatNative/takeRecording';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { ScrollView, View, useWindowDimensions } from 'react-native';
import { Button, SegmentedControl, Text, themedStyles, useAppearance, useThemedStyles } from '../../../components/ui';
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
import { createNativeAssetPort } from '../../../lib/beatNative/nativeAssets';
import { useAuth } from '../../../auth/AuthProvider';
import {
    addKitTrack, audibleGain, DRUM_KITS, MAX_BPM, MAX_TRACKS, MIN_BPM, removeTrack, setTempo, setTrackGain, setTrackKit, setTrackMute, setTrackPan, setTrackSolo, toggleStep, tryOp, setView,
    type BeatDoc, type Edit, type PadId,
} from '../../../lib/beatNative/doc';
import { beatStore, getBeat, listBeats, putBeat, subscribeBeats } from '../../../lib/beatNative/store';
import { t } from '../../../lib/i18n';
import { useAnnouncement } from '../../../lib/useAnnouncement';
import { ds, TEXT_SCALE } from '../../../theme';

import { createHistory, record, replacePresent, travel, canUndo, canRedo, type History } from '../../../lib/beatNative/history';
import { useLocalBeatLifecycle } from '../../../lib/beatNative/useLocalBeatLifecycle';
import { BeatAiPanel } from '../../../components/beats/ai/BeatAiPanel';
import { BeatSaveControls } from '../../../components/beats/BeatSaveControls';
import { BeatEditorTransport } from '../../../components/beats/BeatEditorTransport';
import { beatEditorLayout } from '../../../lib/beatNative/editorLayout';

const clampBpm = (n: number) => Math.min(MAX_BPM, Math.max(MIN_BPM, n));
const playbackNotice = (error: unknown) => t((error as Error)?.message === 'audio_playback_too_large' ? 'beat.audioTooLarge' : 'beat.audioError');

export default function BeatEditor() {
    const { id } = useLocalSearchParams<{ id: string }>();
    const { api, generation, beginSessionTask } = useAuth();
    const authRef = useRef({ api, generation, beginSessionTask });
    authRef.current = { api, generation, beginSessionTask };
    useSyncExternalStore(subscribeBeats, listBeats, listBeats);
    const doc = getBeat(String(id));
    const s = useThemedStyles(sheets);
    const { width, fontScale } = useWindowDimensions();
    const { settings } = useAppearance();
    const layout = beatEditorLayout(width, fontScale, TEXT_SCALE[settings.textSize]);
    const history = useRef<History | null>(null);
    if (doc && history.current?.present !== doc) history.current = createHistory(doc);
    const recordingRef = useRef<TakeRecording | null>(null);
    const audio = useRef<BeatAudio | null>(null);
    const audioSession = useRef<{ generation: number; engine: BeatAudio; recording: TakeRecording | null } | null>(null);
    const manualRun = useRef(false);
    const docRef = useRef<BeatDoc | undefined>(doc);
    docRef.current = doc;
    const [held, setHeld] = useState(false);
    const [pad, setPad] = useState<PadId>('kick');
    const [mixer, setMixer] = useState(false);
    const [exporting, setExporting] = useState(false);
    const [playing, setPlaying] = useState(false);
    const [starting, setStarting] = useState(false);
    const startingRef = useRef(false);
    const [step, setStep] = useState<number | null>(null);
    const [notice, setNotice] = useState<string | null>(null);
    const [said, setSaid] = useState<string | null>(null);
    useAnnouncement(notice ?? said, { everywhere: true });
    useLocalBeatLifecycle();
    useEffect(() => () => {
        const session = audioSession.current; audioSession.current = null; audio.current = null;
        void (session?.recording ?? recordingRef.current)?.finishAndDisarm().catch(() => undefined).finally(() => { void session?.engine.close(); });
    }, []);
    useEffect(() => {
        const stale = audioSession.current;
        if (!stale || stale.generation === generation) return;
        audioSession.current = null; if (audio.current === stale.engine) audio.current = null;
        startingRef.current = false; setStarting(false); setPlaying(false); setStep(null);
        stale.engine.stop();
        void stale.recording?.finishAndDisarm().catch(() => undefined).finally(() => { void stale.engine.close(); });
    }, [generation]);

    // The native module is touched only when the person first asks for sound.
    const engine = useCallback((): BeatAudio | null => {
        if (audio.current) return audio.current;
        try {
            const auth = authRef.current;
            audio.current = createBeatAudio(undefined, createNativeAssetPort(auth.api, auth.beginSessionTask()),
                name => setNotice(t('beat.audioUnavailable', { name })));
            audioSession.current = { generation: auth.generation, engine: audio.current, recording: recordingRef.current };
            return audio.current;
        } catch { setNotice(t('beat.audioError')); return null; }
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
        if (startingRef.current) return;
        const a = engine(); if (!a) return;
        startingRef.current = true; setStarting(true);
        try {
            let failed = false;
            const outcome = await a.play(() => docRef.current as BeatDoc, n => setStep(n), undefined, 0, { onError: error => { failed = true; setPlaying(false); setStep(null); setNotice(playbackNotice(error)); }, onEffectError: () => setNotice(t('beatMix.fx.unavailable')) });
            if (!failed && outcome === 'started') { manualRun.current = false; setPlaying(true); setSaid(t('beat.playing')); }
        } catch (error) { setNotice(playbackNotice(error)); }
        finally { startingRef.current = false; setStarting(false); }
    };
    const stop = () => { startingRef.current = false; setStarting(false); audio.current?.stop(); setPlaying(false); setStep(null); setSaid(t('beat.stopped')); };
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
    const historyBusy = beatStore.saveState(doc.id) === 'busy';
    const undoable = !locked && !!history.current && canUndo(history.current) && !historyBusy;
    const redoable = !locked && !!history.current && canRedo(history.current) && !historyBusy;
    return (
        <View testID="beat-editor-shell" style={s.screen}>
            <Stack.Screen options={{ title: doc.title }} />
            <ScrollView testID="beat-editor-workspace" scrollEnabled={!held} style={s.workspaceScroll}
                contentContainerStyle={[s.content, layout === 'regular' && s.contentRegular]} keyboardShouldPersistTaps="handled">
                <View style={s.actions}>
                    <BeatSaveControls id={doc.id} apply={apply} />
                    <Button variant="secondary" icon="arrowUp" label={t('beatExport.title')} onPress={() => setExporting(true)} />
                    <BeatAiPanel doc={doc} apply={apply} />
                    <BeatLabsBar doc={doc} apply={apply} targets={PHONE_TIP_TARGETS} capabilities={PHONE_CAPABILITIES} />
                </View>
                {replacing ? <Text accessibilityLiveRegion="polite">{t('beatTakes.replacing')}</Text> : null}
                {notice ? <MusicNotice message={notice} /> : null}
                <View testID={`beat-editor-layout-${layout}`} style={[s.editor, layout === 'regular' && s.editorRegular]}>
                    <View testID="beat-editor-main" style={s.main}>
                        <BeatRecordPanel doc={doc} controller={takes.controller} view={takes.view} playing={playing} />
                        <View style={s.tempo} accessibilityLabel={t('beat.tempo')}>
                            <View style={s.stepper}>
                                <Button size="md" variant="secondary" label="−5" accessibilityLabel={t('beat.tempoDown5')} onPress={() => bump(-5)} disabled={bpm <= MIN_BPM} containerStyle={s.flex} />
                                <Button size="md" variant="secondary" label="−" accessibilityLabel={t('beat.tempoDown')} onPress={() => bump(-1)} disabled={bpm <= MIN_BPM} containerStyle={s.flex} />
                                <Button size="md" variant="secondary" label="+" accessibilityLabel={t('beat.tempoUp')} onPress={() => bump(1)} disabled={bpm >= MAX_BPM} containerStyle={s.flex} />
                                <Button size="md" variant="secondary" label="+5" accessibilityLabel={t('beat.tempoUp5')} onPress={() => bump(5)} disabled={bpm >= MAX_BPM} containerStyle={s.flex} />
                            </View>
                            <Text variant="title3" accessibilityLiveRegion="polite">{t('beat.tempoValue', { bpm })}</Text>
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
                        <BeatInstrumentsSection doc={doc} apply={apply} audio={engine} onOpen={regionId => { stop(); openPiano(doc.id, regionId); }} />
                    </View>
                    <View testID="beat-editor-inspector" style={[s.inspector, layout === 'regular' && s.inspectorRegular]}>
                        <Text variant="bodyStrong" accessibilityRole="header">{t('beat.mixer')}</Text>
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
                        <Button variant="secondary" label={t('beat.track.add')} disabled={doc.tracks.length >= MAX_TRACKS}
                            onPress={() => apply(d => addKitTrack(d, DRUM_KITS[0].id))} />
                        <Button variant="secondary" label={t('beatTakes.addTrack')} disabled={locked || doc.tracks.length >= MAX_TRACKS} onPress={() => apply(d => addAudioTrack(d))} />
                        {doc.tracks.length >= MAX_TRACKS ? <Text variant="footnote" tone="secondary">{t('beat.track.max', { max: MAX_TRACKS })}</Text> : null}
                    </View>
                </View>
            </ScrollView>
            <BeatEditorTransport playing={playing} starting={starting} locked={locked} canUndo={undoable} canRedo={redoable}
                onUndo={() => navigateHistory('undo')} onRedo={() => navigateHistory('redo')}
                onPlay={() => void (playing || starting ? stop() : play())} onMixer={() => setMixer(true)} />
            {exporting && <BeatExportSheet doc={doc} replacing={replacing} recording={['opening', 'armed', 'recording', 'finishing'].includes(takes.view.status)}
                prepare={() => releaseExportPlayback(audio, recordingRef, stop)} onClose={() => setExporting(false)} />}
            {mixer && <BeatMixerSheet doc={doc} audio={audio.current} apply={apply} playing={playing} step={step} notice={notice} onClose={() => setMixer(false)} />}
        </View>
    );
}
const sheets = themedStyles(p => ({
    screen: { flex: 1, backgroundColor: p.bg },
    workspaceScroll: { flex: 1 },
    content: { padding: ds.space.gutter, gap: ds.space.lg, paddingBottom: ds.space.xxl },
    contentRegular: { width: '100%', maxWidth: 1180, alignSelf: 'center', paddingHorizontal: ds.space.xxxl },
    actions: { gap: ds.space.md },
    editor: { gap: ds.space.xl },
    editorRegular: { flexDirection: 'row', alignItems: 'flex-start' },
    main: { flex: 1.65, minWidth: 0, gap: ds.space.lg },
    inspector: { flex: 1, minWidth: 0, gap: ds.space.lg },
    inspectorRegular: { paddingLeft: ds.space.xl, borderLeftWidth: 1, borderLeftColor: p.borderSubtle },
    tempo: { gap: ds.space.sm, alignItems: 'center', padding: ds.space.md, borderRadius: ds.radius.md, backgroundColor: p.bgElevated1, borderWidth: 1, borderColor: p.borderSubtle },
    stepper: { width: '100%', flexDirection: 'row', gap: ds.space.sm },
    flex: { flex: 1 },
}));
