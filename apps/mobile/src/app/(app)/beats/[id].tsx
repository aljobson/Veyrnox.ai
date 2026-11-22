import { BeatExportSheet } from '../../../components/beats/BeatExportSheet';
import { releaseExportPlayback } from '../../../lib/beatNative/exportPlayback';
import { BeatLabsBar } from '../../../components/beats/BeatLabsBar';
import { PHONE_CAPABILITIES } from '../../../lib/beatNative/controls';
import { PHONE_TIP_TARGETS } from '../../../lib/beatNative/coachMarks';
import { BeatRecordPanel } from '../../../components/beats/BeatRecordPanel';
import { BeatTakeLanes } from '../../../components/beats/BeatTakeLanes';
import { useTakeRecording } from '../../../lib/beatNative/useTakeRecording';
import { addAudioTrack, beatReadOnly } from '../../../lib/beatNative/takeShared';
import { replacementUnderway, subscribeReplacements } from '../../../lib/beatNative/recordingFinalizers';
import type { RecordingEdit } from '../../../lib/beatNative/takeShared';
import type { TakeRecording } from '../../../lib/beatNative/takeRecording';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type ComponentRef } from 'react';
import { AccessibilityInfo, Alert, findNodeHandle, Pressable, ScrollView, View, useWindowDimensions } from 'react-native';
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
    addHitToPattern, addKitTrack, audibleGain, clearPattern, copyPattern, cycleVelocity, DRUM_KITS, MAX_BPM, MAX_TRACKS, MIN_BPM, patternHasHits, recordTarget, removeTrack, selectPattern, setMetronome, setSteps, setSwing, setTempo, setTrackGain, setTrackKit, setTrackMute, setTrackPan, setTrackSolo, toggleStep, tryOp, setView,
    type BeatDoc, type Edit, type PadId, type PatternSlot,
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
import { BeatPatternControls } from '../../../components/beats/BeatPatternControls';
import { beatEditorLayout } from '../../../lib/beatNative/editorLayout';
import { measureAndRevealLane } from '../../../lib/beatNative/clipSearch';

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
    const workspace = useRef<ComponentRef<typeof ScrollView>>(null);
    const workspaceScrollY = useRef(0), workspaceContentHeight = useRef(0), workspaceViewportHeight = useRef(0);
    const revealGeneration = useRef(0);
    const pendingRevealLane = useRef<ComponentRef<typeof View> | null>(null);
    const revealRetryFrame = useRef<number | null>(null);
    const docRef = useRef<BeatDoc | undefined>(doc);
    docRef.current = doc;
    const [held, setHeld] = useState(false);
    const [pad, setPad] = useState<PadId>('kick');
    const [padRecord, setPadRecord] = useState(false);
    const [ordinaryPlaying, setOrdinaryPlaying] = useState(false);
    const ordinaryPlayingRef = useRef(false);
    const gapAnnouncement = useRef(-Infinity);
    const hitAnnouncement = useRef(-Infinity);
    const [editTrackId, setEditTrackId] = useState<string | undefined>(() => doc?.tracks[0]?.id);
    const resolvedEditTrackId = doc?.tracks.some(track => track.id === editTrackId) ? editTrackId : doc?.tracks[0]?.id;
    const attemptLaneReveal = useCallback(() => {
        const lane = pendingRevealLane.current;
        if (!lane) return;
        const token = ++revealGeneration.current;
        const viewport = workspace.current;
        if (!viewport) return;
        measureAndRevealLane({
            lane, workspace: viewport,
            currentScrollY: workspaceScrollY.current,
            contentHeight: workspaceContentHeight.current,
            viewportHeight: workspaceViewportHeight.current,
            inset: ds.space.gutter,
            isCurrent: () => token === revealGeneration.current,
            onReveal: y => {
                if (pendingRevealLane.current !== lane) return;
                workspaceScrollY.current = y;
                viewport.scrollTo({ y, animated: false });
                pendingRevealLane.current = null;
            },
        });
    }, []);
    const scheduleLaneRevealRetry = useCallback(() => {
        if (!pendingRevealLane.current || revealRetryFrame.current !== null) return;
        revealRetryFrame.current = requestAnimationFrame(() => {
            revealRetryFrame.current = null;
            attemptLaneReveal();
        });
    }, [attemptLaneReveal]);
    const cancelPendingLaneReveal = useCallback(() => {
        revealGeneration.current++;
        pendingRevealLane.current = null;
        if (revealRetryFrame.current !== null) {
            cancelAnimationFrame(revealRetryFrame.current);
            revealRetryFrame.current = null;
        }
    }, []);
    const revealLane = useCallback((lane: ComponentRef<typeof View> | null) => {
        cancelPendingLaneReveal();
        pendingRevealLane.current = lane;
        if (lane) attemptLaneReveal();
    }, [attemptLaneReveal, cancelPendingLaneReveal]);
    useEffect(() => () => { cancelPendingLaneReveal(); }, [cancelPendingLaneReveal]);
    const [mixer, setMixer] = useState(false);
    const [patternControls, setPatternControls] = useState(false);
    const patternControlsTrigger = useRef<ComponentRef<typeof Pressable>>(null);
    const patternControlsFocusPending = useRef(false);
    const [exporting, setExporting] = useState(false);
    const [playing, setPlaying] = useState(false);
    const [starting, setStarting] = useState(false);
    const startingRef = useRef(false);
    const [step, setStep] = useState<number | null>(null);
    const [notice, setNotice] = useState<string | null>(null);
    const [said, setSaid] = useState<string | null>(null);
    const setOrdinaryRun = useCallback((value: boolean) => {
        ordinaryPlayingRef.current = value;
        setOrdinaryPlaying(value);
    }, []);
    const restorePatternControlsFocus = useCallback(() => {
        if (!patternControlsFocusPending.current) return;
        patternControlsFocusPending.current = false;
        const node = findNodeHandle(patternControlsTrigger.current);
        if (node) AccessibilityInfo.setAccessibilityFocus(node);
    }, []);
    const openPatternControls = useCallback(() => {
        patternControlsFocusPending.current = true;
        setPatternControls(true);
    }, []);
    const closePatternControls = useCallback(() => {
        setPatternControls(false);
        requestAnimationFrame(restorePatternControlsFocus);
    }, [restorePatternControlsFocus]);
    useAnnouncement(notice ?? said, { everywhere: true });
    useLocalBeatLifecycle();
    useEffect(() => () => {
        const session = audioSession.current; audioSession.current = null; audio.current = null;
        void (session?.recording ?? recordingRef.current)?.finishAndDisarm().catch(() => undefined).finally(() => { void session?.engine.close(); });
    }, []);
    useEffect(() => {
        if (!doc) {
            setEditTrackId(undefined);
            setPadRecord(false);
            return;
        }
        if (beatReadOnly(doc)) setPadRecord(false);
        if (editTrackId !== resolvedEditTrackId) setEditTrackId(resolvedEditTrackId);
    }, [doc, editTrackId, resolvedEditTrackId]);
    useEffect(() => {
        const stale = audioSession.current;
        if (!stale || stale.generation === generation) return;
        audioSession.current = null; if (audio.current === stale.engine) audio.current = null;
        startingRef.current = false; setStarting(false); setPlaying(false); setOrdinaryRun(false); setStep(null);
        stale.engine.stop();
        void stale.recording?.finishAndDisarm().catch(() => undefined).finally(() => { void stale.engine.close(); });
    }, [generation, setOrdinaryRun]);

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
        if (active || wasRecording.current) {
            setPlaying(active);
            if (active) setOrdinaryRun(false);
        }
        wasRecording.current = active;
    }, [takes.view.status, setOrdinaryRun]);
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
    const selectCurrentPattern = (slot: PatternSlot, announcement?: string) => {
        const current = docRef.current;
        if (!current) return false;
        if (recordingRef.current?.locked() || replacementUnderway(current.id) || beatStore.saveState(current.id) === 'busy') {
            setNotice(t(replacementUnderway(current.id) ? 'beatTakes.replacing' : recordingRef.current?.locked() ? 'beatTakes.locked' : 'beat.local.busy'));
            return false;
        }
        let result;
        try { result = tryOp(current, d => selectPattern(d, slot)); }
        catch { setNotice(t('beat.refused', { reason: '' })); return false; }
        if (result.refused) { setNotice(t('beat.refused', { reason: result.refused })); return false; }
        if (result.doc !== current) {
            if (!putBeat(result.doc)) { setNotice(t('beat.local.busy')); return false; }
            docRef.current = getBeat(current.id)!;
            history.current = replacePresent(history.current ?? createHistory(current), docRef.current);
        }
        setNotice(null); setSaid(announcement ?? null); return true;
    };
    if (!doc && beatStore.hydrationState() !== 'ready') return <><Text accessibilityLiveRegion="polite">{t(beatStore.hydrationState() === 'error' ? 'beat.local.loadError' : 'beat.home.checking')}</Text><Button label={t('beat.retry')} onPress={() => void beatStore.hydrateBeats().catch(() => undefined)} /></>;
    if (!doc) return <EmptyState title={t('beat.missing')} body={t('beat.missingBody')} actionLabel={t('beat.back')} href="/beats" />;
    const play = async () => {
        if (startingRef.current) return;
        const a = engine(); if (!a) return;
        startingRef.current = true; setStarting(true);
        try {
            let failed = false;
            const outcome = await a.play(() => docRef.current as BeatDoc, n => setStep(n), undefined, 0, { onError: error => { failed = true; setPlaying(false); setOrdinaryRun(false); setStep(null); setNotice(playbackNotice(error)); }, onEffectError: () => setNotice(t('beatMix.fx.unavailable')) });
            if (!failed && outcome === 'started') { manualRun.current = false; setPlaying(true); setOrdinaryRun(true); setSaid(t('beat.playing')); }
            else setOrdinaryRun(false);
        } catch (error) { setOrdinaryRun(false); setNotice(playbackNotice(error)); }
        finally { startingRef.current = false; setStarting(false); }
    };
    const stop = () => { startingRef.current = false; setStarting(false); audio.current?.stop(); setPlaying(false); setOrdinaryRun(false); setStep(null); setSaid(t('beat.stopped')); };
    const hit = (p: PadId) => {
        setPad(p);
        const current = docRef.current;
        if (!current) return;
        const selectedTrack = current.tracks.find(track => track.id === resolvedEditTrackId);
        const auditionTrack = selectedTrack && (!selectedTrack.kind || selectedTrack.kind === 'drums')
            ? selectedTrack : current.tracks.find(track => !track.kind || track.kind === 'drums');
        const a = engine();
        if (!a) return;
        const tappedAt = a.hitPad(p, auditionTrack?.kit ?? DRUM_KITS[0].id);
        if (beatReadOnly(current)) { setPadRecord(false); return; }
        if (!padRecord || !ordinaryPlayingRef.current) return;
        const nearest = a.nearestStepAt(tappedAt);
        if (!nearest) return;
        const target = recordTarget(current, nearest.step, resolvedEditTrackId);
        if (!target) {
            const now = Date.now();
            if (now - gapAnnouncement.current >= 2000) {
                gapAnnouncement.current = now;
                setSaid(t('beat.padRecord.noTarget', { track: selectedTrack?.name ?? '' }));
            }
            return;
        }
        const next = addHitToPattern(current, target.pattern, p, target.step);
        if (next === current) return;
        const now = Date.now();
        const announce = now - hitAnnouncement.current >= 2000
            ? t('beat.padRecord.added', { pad: t(`beat.pad.${p}`), step: target.step + 1 }) : undefined;
        if (apply(d => addHitToPattern(d, target.pattern, p, target.step), announce) && announce) hitAnnouncement.current = now;
    };
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
    const readOnly = beatReadOnly(doc);
    const patternLocked = locked || historyBusy || readOnly;
    const editTrack = doc.tracks.find(track => track.id === resolvedEditTrackId);
    const padSurfaceAvailable = doc.view === 'pattern' || (!!editTrack && (!editTrack.kind || editTrack.kind === 'drums'));
    const padRecordingState = !padRecord || readOnly ? 'off' : ordinaryPlaying ? 'recording' : 'armed';
    const playheadTarget = playing && step !== null ? recordTarget(doc, step, resolvedEditTrackId) : null;
    const patternPlayhead = playheadTarget?.pattern === doc.currentPattern ? playheadTarget.step : null;
    const undoable = !locked && !!history.current && canUndo(history.current) && !historyBusy;
    const redoable = !locked && !!history.current && canRedo(history.current) && !historyBusy;
    const copyCurrentPattern = (target: PatternSlot) => {
        const current = docRef.current;
        if (!current || patternLocked) return;
        const source = current.currentPattern;
        const commit = () => apply(d => copyPattern(d, source, target), t('beat.pattern.copied', { from: source, to: target }));
        if (!patternHasHits(current, target)) { commit(); return; }
        Alert.alert(t('beat.pattern.replaceTitle', { to: target }), t('beat.pattern.replaceBody', { to: target }), [
            { text: t('beat.pattern.cancel'), style: 'cancel' },
            { text: t('beat.pattern.replaceAction'), style: 'destructive', onPress: commit },
        ]);
    };
    const clearCurrentPattern = () => {
        const current = docRef.current;
        if (!current || patternLocked || !patternHasHits(current, current.currentPattern)) return;
        const slot = current.currentPattern;
        Alert.alert(t('beat.pattern.clearTitle', { pattern: slot }), t('beat.pattern.clearBody'), [
            { text: t('beat.pattern.cancel'), style: 'cancel' },
            { text: t('beat.pattern.clearAction'), style: 'destructive', onPress: () => {
                const latest = docRef.current;
                if (!latest || latest.currentPattern !== slot) return;
                apply(d => d.currentPattern === slot ? clearPattern(d) : d, t('beat.pattern.cleared', { pattern: slot }));
            } },
        ]);
    };
    return (
        <View testID="beat-editor-shell" style={s.screen}>
            <Stack.Screen options={{ title: doc.title }} />
            <ScrollView ref={workspace} testID="beat-editor-workspace" scrollEnabled={!held} style={s.workspaceScroll}
                contentContainerStyle={[s.content, layout === 'regular' && s.contentRegular]} keyboardShouldPersistTaps="handled"
                scrollEventThrottle={16}
                onLayout={event => {
                    const height = event.nativeEvent.layout.height;
                    if (workspaceViewportHeight.current !== height) {
                        revealGeneration.current++;
                        workspaceViewportHeight.current = height;
                        scheduleLaneRevealRetry();
                        return;
                    }
                    workspaceViewportHeight.current = height;
                }}
                onContentSizeChange={(_width, height) => {
                    if (workspaceContentHeight.current !== height) {
                        revealGeneration.current++;
                        workspaceContentHeight.current = height;
                        scheduleLaneRevealRetry();
                        return;
                    }
                    workspaceContentHeight.current = height;
                }}
                onScrollBeginDrag={cancelPendingLaneReveal}
                onMomentumScrollBegin={cancelPendingLaneReveal}
                onScroll={event => {
                    const y = event.nativeEvent.contentOffset.y;
                    if (workspaceScrollY.current === y) return;
                    workspaceScrollY.current = y;
                    revealGeneration.current++;
                    scheduleLaneRevealRetry();
                }}>
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
                        {doc.view === 'song' ? <BeatArrangement manualRun={manualRun} key={doc.id} doc={doc} apply={apply} selectCurrentPattern={slot => { selectCurrentPattern(slot); }}
                            editTrackId={resolvedEditTrackId} onEditTrackChange={setEditTrackId} playing={playing} step={step} disabled={patternLocked}
                            announce={setSaid} onHold={setHeld} onRevealLane={revealLane} /> : null}
                        {padSurfaceAvailable ? <>
                            <View style={s.padHeading}>
                                <Text variant="bodyStrong" accessibilityRole="header">{t('beat.pads')}</Text>
                                <Button size="md" variant="secondary"
                                    label={t(padRecord ? 'beat.padRecord.disable' : 'beat.padRecord.enable')}
                                    accessibilityState={{ selected: padRecord }} disabled={!padRecord && patternLocked}
                                    onPress={() => setPadRecord(value => !value)} />
                            </View>
                            <Text variant="footnote" tone="secondary" accessibilityLiveRegion="polite">{t(`beat.padRecord.status.${padRecordingState}`)}</Text>
                            <PadGrid selected={pad} onHit={hit} layout={layout} recordingState={padRecordingState} disabled={patternLocked} />
                            <Text variant="bodyStrong" accessibilityRole="header">{t('beat.steps', { pad: t(`beat.pad.${pad}`) })}</Text>
                            <StepGrid doc={doc} pad={pad} current={patternPlayhead} layout={layout} disabled={patternLocked}
                                onToggle={n => apply(d => toggleStep(d, pad, n))}
                                onVelocity={(n, direction) => apply(d => cycleVelocity(d, pad, n, direction))} />
                        </> : <Text variant="footnote" tone="secondary">{t('beat.padRecord.drumOnly')}</Text>}
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
            <BeatEditorTransport playing={playing} starting={starting} locked={locked}
                pattern={doc.currentPattern} patternDisabled={patternLocked} canUndo={undoable} canRedo={redoable}
                patternControlsRef={patternControlsTrigger}
                onPattern={slot => { selectCurrentPattern(slot, t('beat.pattern.selected', { pattern: slot })); }}
                onPatternControls={openPatternControls}
                onUndo={() => navigateHistory('undo')} onRedo={() => navigateHistory('redo')}
                onPlay={() => void (playing || starting ? stop() : play())} onMixer={() => setMixer(true)} />
            {exporting && <BeatExportSheet doc={doc} replacing={replacing} recording={['opening', 'armed', 'recording', 'finishing'].includes(takes.view.status)}
                prepare={() => releaseExportPlayback(audio, recordingRef, stop)} onClose={() => setExporting(false)} />}
            {mixer && <BeatMixerSheet doc={doc} audio={audio.current} apply={apply} playing={playing} step={step} notice={notice} onClose={() => setMixer(false)} />}
            {patternControls && <BeatPatternControls pattern={doc.currentPattern}
                uses={doc.tracks.flatMap(track => track.regions).filter(region => region.pattern === doc.currentPattern).length}
                swing={doc.swing} metronome={doc.metronome} steps={doc.steps} disabled={patternLocked}
                clearDisabled={!patternHasHits(doc, doc.currentPattern)}
                onSwing={value => apply(d => setSwing(d, value), undefined, 'swing')}
                onMetronome={value => apply(d => setMetronome(d, value))}
                onSteps={value => apply(d => setSteps(d, value))}
                onCopy={copyCurrentPattern} onClear={clearCurrentPattern} onClose={closePatternControls}
                onDismiss={restorePatternControlsFocus} />}
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
    padHeading: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: ds.space.sm },
    flex: { flex: 1 },
}));
