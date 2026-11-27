import { BeatExportSheet } from '../../../components/beats/BeatExportSheet';
import { BeatRecordPanel } from '../../../components/beats/BeatRecordPanel';
import { useTakeRecording } from '../../../lib/beatNative/useTakeRecording';
import { addAudioTrack, assertBeatWritable, beatReadOnly, discardBeatTakes } from '../../../lib/beatNative/takeShared';
import { registerRecordingFinalizer, replacementUnderway, subscribeReplacements } from '../../../lib/beatNative/recordingFinalizers';
import type { RecordingEdit } from '../../../lib/beatNative/takeShared';
import type { TakeRecording } from '../../../lib/beatNative/takeRecording';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ComponentRef } from 'react';
import { AccessibilityInfo, Alert, AppState, findNodeHandle, Keyboard, Pressable, ScrollView, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppearanceContext, Button, Text, themedStyles, useAppearance, useThemedStyles } from '../../../components/ui';
import { EmptyState } from '../../../components/EmptyState';
import { MusicNotice } from '../../../components/music/MusicNotice';
import { PadGrid } from '../../../components/beats/PadGrid';
import { StepGrid } from '../../../components/beats/StepGrid';
import { BeatInstrumentsSection, openPiano } from '../../../components/beats/BeatInstrumentsSection';
import { BeatSaveControls } from '../../../components/beats/BeatSaveControls';
import { MusicAddTrackTray } from '../../../components/beats/MusicAddTrackSheet';
import { BeatSoundsTray } from '../../../components/beats/BeatSoundsSheet';
import { MusicInstrumentTray } from '../../../components/beats/MusicInstrumentTray';
import { MusicMixerTray } from '../../../components/beats/MusicMixerTray';
import { BeatArrangement } from '../../../components/beats/BeatArrangement';
import { BeatSongLibrarySheet, type BeatSongPlacement } from '../../../components/beats/BeatSongLibrarySheet';
import { createBeatAudio, type BeatAudio } from '../../../lib/beatNative/audio';
import { createNativeAssetPort } from '../../../lib/beatNative/nativeAssets';
import { createNativeHeldAssets } from '../../../lib/beatNative/nativeHeldAssets';
import { useAuth } from '../../../auth/AuthProvider';
import {
    addHitToPattern, audibleGain, clampLocator, clearPattern, copyPattern, cycleVelocity, DRUM_KITS, MAX_BPM, MAX_TRACKS, MIN_BPM, patternHasHits, recordTarget, removeTrack, selectPattern, setMetronome, setSteps, setSwing, setTempo, setTrackGain, setTrackKit, setTrackMute, setTrackPan, setTrackSolo, snapTick, songEnd, toggleStep, tryOp, setView,
    type BeatDoc, type Edit, type PadId, type PatternSlot,
} from '../../../lib/beatNative/doc';
import { beatStore, getBeat, listBeats, newId, putBeat, subscribeBeats } from '../../../lib/beatNative/store';
import { t } from '../../../lib/i18n';
import { useAnnouncement } from '../../../lib/useAnnouncement';
import { ds, TEXT_SCALE } from '../../../theme';

import { createHistory, record, replacePresent, travel, canUndo, canRedo, type History } from '../../../lib/beatNative/history';
import { useLocalBeatLifecycle } from '../../../lib/beatNative/useLocalBeatLifecycle';
import { BeatAiPanel } from '../../../components/beats/ai/BeatAiPanel';
import { BeatEditorTransport } from '../../../components/beats/BeatEditorTransport';
import { BeatMidiRecordPanel, type BeatMidiRecordPhase } from '../../../components/beats/BeatMidiRecordPanel';
import { BeatMidiRecoveryCard, type BeatMidiRecoveryMode } from '../../../components/beats/BeatMidiRecoveryCard';
import { BeatPatternControls } from '../../../components/beats/BeatPatternControls';
import { beatEditorLayout, musicEditorCompactsTimeline } from '../../../lib/beatNative/editorLayout';
import { measureAndRevealLane } from '../../../lib/beatNative/clipSearch';
import type { ApplyOptions } from '../../../lib/beatNative/regionActions';
import { createMidiRecording, type MidiRecordingController } from '../../../lib/beatNative/midiRecording';
import type { MidiSoundTrack } from '../../../lib/beatNative/midi';
import { getCacheUser } from '../../../lib/appCache';
import { KeyboardScreen } from '../../../components/KeyboardScreen';
import { KeyboardFormScrollView } from '../../../components/KeyboardFormScrollView';
import { addAudioRegion as addAudioAssetRegion, soundAsset, type AudioAsset, type BeatSound } from '../../../lib/beatNative/labs';
import { pickDeviceAudio } from '../../../lib/beatNative/deviceAudioImport';
import { position } from '../../../lib/beatNative/regionActions';
import { HeaderAction } from '../../../components/HeaderAction';

const clampBpm = (n: number) => Math.min(MAX_BPM, Math.max(MIN_BPM, n));
type BottomTool = 'tracks' | 'library' | 'instruments' | 'sounds' | 'ai' | 'mix' | 'save' | null;
const playbackNotice = (error: unknown) => t((error as Error)?.message === 'audio_playback_too_large' ? 'beat.audioTooLarge' : 'beat.audioError');
const midiErrorNotice = (error: unknown) => {
    const code = (error as { code?: string })?.code ?? (error as Error)?.message ?? '';
    if (code === 'recording_conflict') return t('beat.midiRecord.recovery.conflict');
    if (code === 'midi_track_required' || code === 'beat_unavailable' || code === 'recording_source_mismatch') return t('beat.midiRecord.targetRemoved');
    if (code === 'account_changed' || code === 'pending_take_stale') return t('beat.midiRecord.recovery.revoked');
    if (code === 'audio_unavailable') return t('beat.midiRecord.unavailable');
    return t('beat.midiRecord.status.failed');
};

export default function BeatEditor() {
    const { id, setup } = useLocalSearchParams<{ id: string; setup?: string }>();
    const { api, generation, beginSessionTask } = useAuth();
    const authRef = useRef({ api, generation, beginSessionTask });
    authRef.current = { api, generation, beginSessionTask };
    const heldAssets = useMemo(() => createNativeHeldAssets(), [generation]);
    const heldAssetsRef = useRef(heldAssets);
    heldAssetsRef.current = heldAssets;
    useSyncExternalStore(subscribeBeats, listBeats, listBeats);
    const doc = getBeat(String(id));
    const s = useThemedStyles(sheets);
    const { width, height, fontScale } = useWindowDimensions();
    const { settings } = useAppearance();
    const layout = beatEditorLayout(width, height, fontScale, TEXT_SCALE[settings.textSize]);
    const shortLandscape = width > height && height < 500;
    const history = useRef<History | null>(null);
    if (doc && history.current?.present !== doc) history.current = createHistory(doc);
    const recordingRef = useRef<TakeRecording | null>(null);
    const midiRecordingRef = useRef<MidiRecordingController | null>(null);
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
    const [tempoOpen, setTempoOpen] = useState(false);
    const [saveControlsOpen, setSaveControlsOpen] = useState(false);
    const [compactQuickOpen, setCompactQuickOpen] = useState(false);
    const [pad, setPad] = useState<PadId>('kick');
    const [padRecord, setPadRecord] = useState(false);
    const [ordinaryPlaying, setOrdinaryPlaying] = useState(false);
    const ordinaryPlayingRef = useRef(false);
    const gapAnnouncement = useRef(-Infinity);
    const hitAnnouncement = useRef(-Infinity);
    const [editTrackId, setEditTrackId] = useState<string | undefined>(() => doc?.tracks[0]?.id);
    const resolvedEditTrackId = doc?.tracks.some(track => track.id === editTrackId) ? editTrackId : doc?.tracks[0]?.id;
    const [arrangementLocator, setArrangementLocator] = useState(0);
    const [arrangementSnap, setArrangementSnap] = useState(240);
    const arrangementEnd = doc ? songEnd(doc) : 0;
    useEffect(() => { setArrangementLocator(0); setArrangementSnap(240); }, [doc?.id]);
    useEffect(() => {
        setArrangementLocator(value => clampLocator(snapTick(value, arrangementSnap), arrangementEnd));
    }, [arrangementEnd, arrangementSnap]);
    const changeArrangementSnap = useCallback((next: number) => {
        setArrangementSnap(next);
        setArrangementLocator(value => clampLocator(snapTick(value, next), arrangementEnd));
    }, [arrangementEnd]);
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
    const [bottomTool, setBottomTool] = useState<BottomTool>(null);
    const [mixerDeepOpen, setMixerDeepOpen] = useState(false);
    const [editorViewportHeight, setEditorViewportHeight] = useState<number | null>(null);
    // The measured editor viewport is the single compactness source for the
    // arrangement, inline trays and transport. This also covers portrait when
    // the keyboard leaves less than one compact workspace row available.
    const compactViewport = editorViewportHeight !== null && editorViewportHeight < 220;
    const compactTimelineForTool = musicEditorCompactsTimeline(width, height, !!bottomTool);
    const [keyboardEditing, setKeyboardEditing] = useState(false);
    useEffect(() => {
        if (!compactViewport || keyboardEditing) setCompactQuickOpen(false);
    }, [compactViewport, keyboardEditing]);
    const setupHandled = useRef<string | null>(null);
    const [deviceImportBusy, setDeviceImportBusy] = useState(false);
    const addToolTrigger = useRef<ComponentRef<typeof Pressable>>(null);
    const aiToolTrigger = useRef<ComponentRef<typeof Pressable>>(null);
    const mixToolTrigger = useRef<ComponentRef<typeof Pressable>>(null);
    const libraryToolTrigger = useRef<ComponentRef<typeof Pressable>>(null);
    const compactQuickTrigger = useRef<ComponentRef<typeof Pressable>>(null);
    const headerSaveTrigger = useRef<ComponentRef<typeof Pressable>>(null);
    const compactSaveBackTrigger = useRef<ComponentRef<typeof Pressable>>(null);
    const addInstrumentTrigger = useRef<ComponentRef<typeof Pressable>>(null);
    const bottomToolHeading = useRef<ComponentRef<typeof View>>(null);
    const focusedBottomTool = useRef<BottomTool>(null);
    const bottomToolControl = useCallback((tool: BottomTool) => tool === 'ai' ? aiToolTrigger.current : tool === 'mix' ? mixToolTrigger.current
        : tool === 'library' ? libraryToolTrigger.current : tool === 'save' ? compactQuickTrigger.current ?? headerSaveTrigger.current : addToolTrigger.current, []);
    const restoreBottomToolFocus = useCallback((tool: BottomTool) => {
        const node = findNodeHandle(bottomToolControl(tool));
        if (node) AccessibilityInfo.setAccessibilityFocus(node);
    }, [bottomToolControl]);
    const closeBottomTools = useCallback(() => {
        const closed = bottomTool;
        setMixerDeepOpen(false);
        setBottomTool(null);
        requestAnimationFrame(() => restoreBottomToolFocus(closed));
    }, [bottomTool, restoreBottomToolFocus]);
    const openAddTools = useCallback(() => setBottomTool('tracks'), []);
    const toggleAddTools = useCallback(() => setBottomTool(value => value === 'tracks' || value === 'instruments' || value === 'sounds' ? null : 'tracks'), []);
    const toggleMixTools = useCallback(() => { setMixerDeepOpen(false); setBottomTool(value => value === 'mix' ? null : 'mix'); }, []);
    const toggleLibraryTools = useCallback(() => setBottomTool(value => value === 'library' ? null : 'library'), []);
    useEffect(() => {
        if (!bottomTool) { focusedBottomTool.current = null; return; }
        if (focusedBottomTool.current === bottomTool) return;
        focusedBottomTool.current = bottomTool;
        requestAnimationFrame(() => {
            const node = findNodeHandle(bottomToolHeading.current);
            if (node) AccessibilityInfo.setAccessibilityFocus(node);
        });
    }, [bottomTool]);
    useEffect(() => {
        if (compactViewport || bottomTool !== 'save') return;
        setBottomTool(null);
        requestAnimationFrame(() => restoreBottomToolFocus('save'));
    }, [bottomTool, compactViewport, restoreBottomToolFocus]);
    const backToTrackChoices = useCallback(() => {
        focusedBottomTool.current = 'tracks';
        setBottomTool('tracks');
        requestAnimationFrame(() => {
            const node = findNodeHandle(addInstrumentTrigger.current);
            if (node) AccessibilityInfo.setAccessibilityFocus(node);
        });
    }, []);
    const [patternControls, setPatternControls] = useState(false);
    const patternControlsTrigger = useRef<ComponentRef<typeof Pressable>>(null);
    const patternControlsFocusPending = useRef(false);
    const [exporting, setExporting] = useState(false);
    const [playing, setPlaying] = useState(false);
    const [starting, setStarting] = useState(false);
    const startingRef = useRef(false);
    const [step, setStep] = useState<number | null>(null);
    const [notice, setNotice] = useState<string | null>(null);
    const [midiNotice, setMidiNotice] = useState<string | null>(null);
    const saidSequence = useRef(0);
    const [said, setSaidState] = useState<{ message: string; event: number } | null>(null);
    const setSaid = useCallback((message: string | null) => {
        setSaidState(message ? { message, event: ++saidSequence.current } : null);
    }, []);
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
    // MusicNotice owns visible errors; this channel owns editor milestones only.
    useAnnouncement(said?.message, { everywhere: true, eventKey: said?.event });
    useLocalBeatLifecycle();
    useEffect(() => {
        if (!doc || setup !== '1' || setupHandled.current === doc.id) return;
        setupHandled.current = doc.id;
        openAddTools();
    }, [doc, setup, openAddTools]);
    const normalizedProject = useRef<string | null>(null);
    useEffect(() => {
        if (!doc || normalizedProject.current === doc.id) return;
        normalizedProject.current = doc.id;
        if (doc.view !== 'pattern' || beatReadOnly(doc)) return;
        const next = setView(doc, 'song');
        if (putBeat(next)) {
            docRef.current = next;
            history.current = createHistory(next);
        }
    }, [doc]);
    useEffect(() => {
        if (!doc) {
            setEditTrackId(undefined);
            setPadRecord(false);
            return;
        }
        if (beatReadOnly(doc)) setPadRecord(false);
        if (editTrackId !== resolvedEditTrackId) setEditTrackId(resolvedEditTrackId);
    }, [doc, editTrackId, resolvedEditTrackId]);
    // The native module is touched only when the person first asks for sound.
    const engine = useCallback((): BeatAudio | null => {
        if (audio.current) return audio.current;
        try {
            const auth = authRef.current;
            audio.current = createBeatAudio(undefined, createNativeAssetPort(auth.api, auth.beginSessionTask(), { heldAssets: heldAssetsRef.current }),
                name => setNotice(t('beat.audioUnavailable', { name })));
            audioSession.current = { generation: auth.generation, engine: audio.current, recording: recordingRef.current };
            return audio.current;
        } catch { setNotice(t('beat.audioError')); return null; }
    }, []);
    // Third argument: N5's history key (a slider drag is one undo step) or N6's options; both forms are accepted.
    const apply = useCallback((operation: Edit, announce?: string, third?: string | (ApplyOptions & { recordingCommit?: boolean; liveMix?: boolean; key?: string; silentAnnouncement?: boolean })) => {
        const options = typeof third === 'string' ? { key: third } : third ?? {};
        const key = options.key;
        const refuse = (message: string) => { if (!options.silentRefusal) setNotice(message); return false; };
        const current = docRef.current;
        if (!current) return false;
        if (replacementUnderway(current.id) && !options.recordingCommit) return refuse(t('beatTakes.replacing'));
        if (recordingRef.current?.locked() && !options.recordingCommit && !options.liveMix) return refuse(t('beatTakes.locked'));
        if (midiRecordingRef.current?.locked() && !options.recordingCommit && !options.liveMix) return refuse(t('beat.midiRecord.locked'));
        let result;
        try { result = tryOp(current, operation); } catch { return refuse(t('beat.refused', { reason: '' })); }
        if (result.refused) return refuse(t('beat.refused', { reason: result.refused }));
        if (result.doc !== current) {
            if (!putBeat(result.doc)) return refuse(t('beat.local.busy'));
            docRef.current = getBeat(current.id)!;
            history.current = record(history.current ?? createHistory(current), docRef.current, { label: announce, key });
        }
        setNotice(null);
        if (!options.silentAnnouncement) setSaid(announce ?? null);
        return true;
    }, []);

    const currentDoc = useCallback(() => docRef.current!, []);
    const recordingEdit = useCallback<RecordingEdit>((edit, options) => apply(edit, options?.message ?? t('beatTakes.recordingSaved'), options), [apply]);
    const beatId = String(id);
    const takes = useTakeRecording(beatId, doc, { current: currentDoc, audio: engine, edit: recordingEdit, t }, { lifecycle: 'editor' });
    recordingRef.current = takes.controller;
    const midiController = useMemo(() => createMidiRecording({
        beatId,
        owner: getCacheUser,
        generation: () => authRef.current.generation,
        current: () => docRef.current,
        getBeat: target => beatStore.getBeat(target),
        audio: engine,
        commit: (next, noteCount) => apply(() => next, t('beat.midiRecord.recorded', { count: noteCount }), { recordingCommit: true, silentAnnouncement: true }),
        flush: target => beatStore.flushBeat(target),
        readSaved: target => beatStore.readSavedDoc(target),
        addBeatFromDocument: (next, owner) => beatStore.addBeatFromDocument(next, owner),
        newBeatId: newId,
        announce: () => setSaid(t('beat.midiRecord.status.failed')),
    }), [apply, beatId, engine, setSaid]);
    midiRecordingRef.current = midiController;
    const midiView = useSyncExternalStore(midiController.subscribe, midiController.snapshot, midiController.snapshot);
    const [midiCountIn, setMidiCountIn] = useState(true);
    const [midiQuantise, setMidiQuantise] = useState(true);
    const [midiVelocity, setMidiVelocity] = useState(100);
    const midiTargetTrack = useRef<string | null>(null);
    const editorFinalizing = useRef<Promise<void> | null>(null);
    const stoppedAudioSessions = useRef(new WeakSet<object>());
    const closingAudioSessions = useRef(new WeakMap<object, Promise<void>>());
    const stopEditorAudio = useCallback((session: NonNullable<typeof audioSession.current>) => {
        if (stoppedAudioSessions.current.has(session)) return;
        stoppedAudioSessions.current.add(session);
        session.engine.stop();
    }, []);
    const closeEditorAudio = useCallback(async (session = audioSession.current) => {
        if (audioSession.current === session) audioSession.current = null;
        if (session && audio.current === session.engine) audio.current = null;
        if (!session) return;
        let closing = closingAudioSessions.current.get(session);
        if (!closing) {
            stopEditorAudio(session);
            closing = Promise.resolve(session.engine.close());
            closingAudioSessions.current.set(session, closing);
        }
        await closing;
    }, [stopEditorAudio]);
    const settleEditorRecorders = useCallback((mode: 'finish' | 'revoke' | 'preserve' = 'finish', close = false,
        capturedSession = audioSession.current) => {
        const existing = editorFinalizing.current;
        if (existing) {
            const followups = mode === 'revoke' ? [midiController.revoke()]
                : mode === 'preserve' ? [takes.controller.beforeReplace(), midiController.beforeReplace()]
                    : [];
            const joined = Promise.allSettled([existing, ...followups]).then(results => {
                const failed = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');
                if (failed) throw failed.reason;
            });
            const completed = close ? joined.finally(() => closeEditorAudio(capturedSession)) : joined;
            const tracked = completed.finally(() => {
                if (editorFinalizing.current === tracked) editorFinalizing.current = null;
            });
            editorFinalizing.current = tracked;
            return tracked;
        }
        const session = capturedSession;
        const task = (async () => {
            const settled = await Promise.allSettled([
                mode === 'preserve'
                    ? (session?.recording ?? recordingRef.current)?.beforeReplace() ?? Promise.resolve()
                    : (session?.recording ?? recordingRef.current)?.finishAndDisarm() ?? Promise.resolve(),
                mode === 'revoke' ? midiController.revoke()
                    : mode === 'preserve' ? midiController.beforeReplace() : midiController.finish(),
            ]);
            let flushError: unknown;
            try { await beatStore.flushBeat(beatId); } catch (error) { flushError = error; }
            if (close) await closeEditorAudio(session);
            const failed = settled.find((result): result is PromiseRejectedResult => result.status === 'rejected');
            if (failed) throw failed.reason;
            if (flushError) throw flushError;
        })();
        const tracked = task.finally(() => {
            if (editorFinalizing.current === tracked) editorFinalizing.current = null;
        });
        editorFinalizing.current = tracked;
        return tracked;
    }, [beatId, closeEditorAudio, midiController, takes.controller]);
    const present = !!doc;
    useEffect(() => {
        const unregister = registerRecordingFinalizer(beatId, () => settleEditorRecorders('preserve', true));
        if (present) void midiController.refreshRecovery().catch(error => setNotice(midiErrorNotice(error)));
        return unregister;
    }, [beatId, midiController, present, settleEditorRecorders]);
    useEffect(() => {
        const sub = AppState.addEventListener('change', state => {
            if (state === 'background') void settleEditorRecorders('finish').catch(error => setNotice((error as Error).message));
        });
        return () => {
            sub.remove();
            void settleEditorRecorders('finish', true).catch(() => undefined).finally(() => {
                midiController.dispose();
                void takes.controller.dispose().catch(() => undefined);
            });
        };
    }, [midiController, settleEditorRecorders, takes.controller]);
    const lastAuthGeneration = useRef(generation);
    useEffect(() => {
        if (lastAuthGeneration.current === generation) return;
        lastAuthGeneration.current = generation;
        startingRef.current = false; setStarting(false); setPlaying(false); setOrdinaryRun(false); setStep(null);
        const stale = audioSession.current;
        if (stale) {
            audioSession.current = null;
            if (audio.current === stale.engine) audio.current = null;
            stopEditorAudio(stale);
        }
        void settleEditorRecorders('revoke', true, stale).catch(() => undefined);
    }, [generation, setOrdinaryRun, settleEditorRecorders, stopEditorAudio]);
    const wasRecording = useRef(false);
    useEffect(() => {
        const active = ['recording', 'finishing'].includes(takes.view.status);
        if (active || wasRecording.current) {
            setPlaying(active);
            if (active) setOrdinaryRun(false);
        }
        wasRecording.current = active;
    }, [takes.view.status, setOrdinaryRun]);
    const previousMidiSignal = useRef({ status: midiView.status, error: midiView.error });
    useEffect(() => {
        const previous = previousMidiSignal.current;
        previousMidiSignal.current = { status: midiView.status, error: midiView.error };
        if (previous.status === midiView.status && previous.error === midiView.error) return;
        if (midiView.status === 'countIn') setSaid(t('beat.midiRecord.status.countIn'));
        else if (midiView.status === 'recording') setSaid(t('beat.midiRecord.status.recording'));
        else if (midiView.status === 'recovery' || midiView.status === 'conflict' || midiView.status === 'error') {
            setSaid(midiErrorNotice(midiView.error));
        } else if (midiView.status === 'idle' && ['recording', 'finishing'].includes(previous.status) && midiView.noteCount) {
            setSaid(t('beat.midiRecord.recorded', { count: midiView.noteCount }));
        }
        if (midiView.status === 'idle') { midiTargetTrack.current = null; setMidiNotice(null); }
    }, [midiView.error, midiView.noteCount, midiView.status, setSaid]);
    useEffect(() => {
        const target = midiTargetTrack.current;
        if (target && ['starting', 'countIn', 'recording'].includes(midiView.status) && !doc?.tracks.some(track => track.id === target)) {
            void midiController.finish().catch(error => setMidiNotice(midiErrorNotice(error)));
        }
    }, [doc, midiController, midiView.status]);
    const replacing = useSyncExternalStore(subscribeReplacements, () => replacementUnderway(String(id)), () => false);
    const locked = takes.controller.locked() || midiController.locked() || replacing;
    useEffect(() => { if (!replacing) setNotice(message => message === t('beatTakes.replacing') ? null : message); }, [replacing]);
    const historyBusy = doc ? beatStore.saveState(doc.id) === 'busy' : false;
    const readOnly = doc ? beatReadOnly(doc) : false;
    const aiLocked = locked || historyBusy || readOnly || replacing;
    const toggleAiTools = useCallback(() => {
        if (aiLocked) return;
        setBottomTool(value => value === 'ai' ? null : 'ai');
    }, [aiLocked]);
    useEffect(() => {
        if (aiLocked && bottomTool === 'ai') {
            setBottomTool(null);
            requestAnimationFrame(() => restoreBottomToolFocus('ai'));
        }
    }, [aiLocked, bottomTool, restoreBottomToolFocus]);
    const mixLocked = historyBusy || readOnly || replacing;
    useEffect(() => {
        if (mixLocked && bottomTool === 'mix') {
            setMixerDeepOpen(false);
            setBottomTool(null);
            requestAnimationFrame(() => restoreBottomToolFocus('mix'));
        }
    }, [mixLocked, bottomTool, restoreBottomToolFocus]);

    const navigateHistory = (direction: 'undo' | 'redo') => {
        if (!history.current || locked) return;
        const next = travel(history.current, direction);
        if (next === history.current) return;
        if (!putBeat(next.present)) { setNotice(t('beat.local.busy')); return; }
        docRef.current = getBeat(next.present.id)!;
        history.current = replacePresent(next, docRef.current);
    };
    const selectCurrentPattern = (slot: PatternSlot, announcement?: string) => {
        const current = docRef.current;
        if (!current) return false;
        if (recordingRef.current?.locked() || midiRecordingRef.current?.locked() || replacementUnderway(current.id) || beatStore.saveState(current.id) === 'busy') {
            setNotice(t(replacementUnderway(current.id) ? 'beatTakes.replacing' : midiRecordingRef.current?.locked() ? 'beat.midiRecord.locked' : recordingRef.current?.locked() ? 'beatTakes.locked' : 'beat.local.busy'));
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
        const applied = apply(operation, announce, { ...(key ? { key } : {}), liveMix: true });
        if (!applied) return false;
        const next = getBeat(doc.id); if (next) { mixOf(trackId, next); next.tracks.forEach(x => mixOf(x.id, next)); }
        return true;
    };
    const nameOf = (i: number) => t('beat.track', { n: i + 1 });
    const bpm = doc.tempo.bpm;
    const bump = (by: number) => apply(d => setTempo(d, clampBpm(bpm + by)));
    const patternLocked = locked || historyBusy || readOnly;
    const addTrackDisabledReason = doc.tracks.length >= MAX_TRACKS ? t('beat.track.max', { max: MAX_TRACKS })
        : replacing ? t('beatTakes.replacing')
            : readOnly ? t('beatTakes.readOnly')
                : takes.controller.locked() ? t('beatTakes.locked')
                    : midiController.locked() ? t('beat.midiRecord.locked')
                        : historyBusy ? t('beat.local.busy') : undefined;
    const libraryDisabledReason = replacing ? t('beatTakes.replacing')
        : readOnly ? t('beatTakes.readOnly')
            : takes.controller.locked() ? t('beatTakes.locked')
                : midiController.locked() ? t('beat.midiRecord.locked')
                    : historyBusy ? t('beat.local.busy') : undefined;
    const editTrack = doc.tracks.find(track => track.id === resolvedEditTrackId);
    // Song view is the multitrack music editor. Keep drum pads and the step
    // sequencer in Pattern view so selecting a drum track never turns the song
    // timeline back into a beat-editor screen.
    const padSurfaceAvailable = doc.view === 'pattern';
    const padRecordingState = !padRecord || readOnly ? 'off' : ordinaryPlaying ? 'recording' : 'armed';
    const playheadTarget = playing && step !== null ? recordTarget(doc, step, resolvedEditTrackId) : null;
    const patternPlayhead = playheadTarget?.pattern === doc.currentPattern ? playheadTarget.step : null;
    const undoable = !locked && !!history.current && canUndo(history.current) && !historyBusy;
    const redoable = !locked && !!history.current && canRedo(history.current) && !historyBusy;
    const midiTrack = editTrack?.kind === 'midi' ? editTrack as unknown as MidiSoundTrack : null;
    const midiPhase: BeatMidiRecordPhase = ['starting', 'countIn', 'recording', 'finishing'].includes(midiView.status)
        ? midiView.status as BeatMidiRecordPhase : 'idle';
    const midiVisible = doc.view === 'song' && !!midiTrack;
    const midiTransportVisible = midiVisible || midiPhase !== 'idle';
    const midiRecoverable = midiView.status === 'recovery' || midiView.status === 'conflict';
    const midiRecoveryMode: BeatMidiRecoveryMode | null = !midiRecoverable ? null
        : readOnly || replacing ? 'discardOnly'
            : midiView.status === 'conflict' ? 'conflict'
                : midiView.error ? 'retry' : 'restore';
    const midiIdleDisabled = !midiTrack || !midiVisible || readOnly || replacing || historyBusy || midiController.locked()
        || takes.controller.locked() || !!midiView.pending;
    const midiLockReason = replacing ? t('beatTakes.replacing')
        : readOnly ? t('beatTakes.readOnly')
            : takes.controller.locked() ? t('beatTakes.locked')
                : midiView.pending ? t('beat.midiRecord.recovery.pending')
                    : historyBusy ? t('beat.local.busy') : undefined;
    const runMidiRecovery = (action: () => Promise<unknown>, success?: string) => {
        void action().then(() => {
            setMidiNotice(null);
            if (success) setSaid(success);
        }).catch(error => setMidiNotice(midiErrorNotice(error)));
    };
    const compactRecoveryCanSaveNew = !readOnly && !replacing && midiView.error !== 'recording_source_mismatch';
    const compactRecoveryCanRetryWithQuantise = !midiView.pending && midiView.status === 'recovery' && arrangementSnap > 0;
    const confirmMidiDiscard = () => Alert.alert(
        t('beat.midiRecord.recovery.discardTitle'), t('beat.midiRecord.recovery.discardBody'), [
            { text: t('beat.midiRecord.recovery.cancel'), style: 'cancel' },
            { text: t('beat.midiRecord.recovery.discard'), style: 'destructive', onPress: () => runMidiRecovery(() => midiController.discard()) },
        ],
    );
    const compactRecoveryAction = midiRecoveryMode === 'restore'
        ? { label: t('beat.midiRecord.recovery.restore'), run: () => runMidiRecovery(() => midiController.retry()) }
        : midiRecoveryMode === 'retry'
            ? { label: t('beat.midiRecord.recovery.retry'), run: () => runMidiRecovery(() => midiController.retry()) }
            : midiRecoveryMode === 'conflict' && compactRecoveryCanSaveNew
                ? { label: t('beat.midiRecord.recovery.saveNew'), run: () => runMidiRecovery(() => midiController.saveAsNewBeat(), t('beat.midiRecord.newBeatSaved')) }
                : midiRecoveryMode ? { label: t('beat.midiRecord.recovery.discard'), run: confirmMidiDiscard } : null;
    const compactStatusMessage = midiRecoveryMode ? t(midiRecoveryMode === 'restore' ? 'beat.midiRecord.recovery.pending'
        : midiRecoveryMode === 'retry' ? 'beat.midiRecord.status.failed'
            : midiRecoveryMode === 'conflict' ? 'beat.midiRecord.recovery.conflict' : 'beat.midiRecord.recovery.revoked')
        : replacing ? t('beatTakes.replacing') : midiNotice || notice;
    const compactTimelineStatus = compactViewport || compactTimelineForTool;
    const compactEditorStatus = compactTimelineStatus && compactStatusMessage ? <View testID="beat-editor-compact-status" style={s.compactStatus}>
        <Text variant="footnote" tone="secondary" numberOfLines={1} accessibilityLiveRegion="polite" style={s.compactStatusText}>{compactStatusMessage}</Text>
        {compactRecoveryAction ? <Button size="sm" variant="secondary" label={compactRecoveryAction.label}
            loading={midiView.status === 'finishing'} onPress={compactRecoveryAction.run} /> : null}
        {midiRecoveryMode === 'retry' && compactRecoveryCanRetryWithQuantise ? <Button testID="beat-midi-compact-retry-quantise"
            size="md" variant="tertiary" icon="faders" iconOnly label={t('beat.midiRecord.recovery.retryQuantise')}
            disabled={midiView.status === 'finishing'} onPress={() => runMidiRecovery(() => midiController.retry(arrangementSnap))}
            containerStyle={s.compactQuickAction} style={s.compactQuickButton} /> : null}
        {midiRecoveryMode && midiRecoveryMode !== 'discardOnly' ? <Button testID="beat-midi-compact-discard"
            size="md" variant="tertiary" tone="danger" icon="close" iconOnly label={t('beat.midiRecord.recovery.discard')}
            disabled={midiView.status === 'finishing'} onPress={confirmMidiDiscard}
            containerStyle={s.compactQuickAction} style={s.compactQuickButton} /> : null}
    </View> : null;
    const compactQuickSettings = compactViewport && !keyboardEditing && !bottomTool ? <View testID="beat-editor-compact-quick-toolbar"
        style={s.compactQuickSettings} accessibilityRole="toolbar" accessibilityLabel={t('beat.title')}>
        <Button ref={compactQuickTrigger} testID="beat-editor-compact-quick-settings" size="md" variant={compactQuickOpen ? 'secondary' : 'tertiary'}
            icon="gear" iconOnly label={t('opt.settingsShow')} accessibilityState={{ expanded: compactQuickOpen }}
            onPress={() => setCompactQuickOpen(value => !value)} containerStyle={s.compactQuickAction} style={s.compactQuickButton} />
        {compactQuickOpen ? <>
            <Button testID="beat-editor-compact-tempo-down" size="md" variant="tertiary" label="−"
                accessibilityLabel={t('beat.tempoDown')} disabled={patternLocked || bpm <= MIN_BPM} onPress={() => bump(-1)}
                containerStyle={s.compactQuickAction} style={s.compactQuickButton} />
            <Text variant="footnote" numberOfLines={1} accessibilityLiveRegion="polite" style={s.compactTempoValue}>{bpm}</Text>
            <Button testID="beat-editor-compact-tempo-up" size="md" variant="tertiary" label="+"
                accessibilityLabel={t('beat.tempoUp')} disabled={patternLocked || bpm >= MAX_BPM} onPress={() => bump(1)}
                containerStyle={s.compactQuickAction} style={s.compactQuickButton} />
            <Button testID="beat-editor-compact-save" size="md" variant="tertiary" icon="folder" iconOnly label={t('beat.versions.title')}
                accessibilityLabel={t('beat.saveNote')} accessibilityState={{ expanded: bottomTool === 'save' }} onPress={() => setBottomTool('save')}
                containerStyle={s.compactQuickAction} style={s.compactQuickButton} />
        </> : null}
    </View> : null;
    const compactHistoryControls = compactTimelineStatus ? <View testID="beat-editor-compact-history" style={s.compactHistory}>
        <Button testID="beat-editor-undo" size="md" variant="tertiary" icon="seekBack" iconOnly label={t('beat.undo')}
            disabled={!undoable} onPress={() => navigateHistory('undo')} containerStyle={s.compactQuickAction} style={s.compactQuickButton} />
        <Button testID="beat-editor-redo" size="md" variant="tertiary" icon="seekForward" iconOnly label={t('beat.redo')}
            disabled={!redoable} onPress={() => navigateHistory('redo')} containerStyle={s.compactQuickAction} style={s.compactQuickButton} />
    </View> : null;
    const compactTransportStatus = compactTimelineStatus ? <View testID="beat-editor-compact-toolbar" style={s.compactTransportToolbar}>
        {compactEditorStatus ?? compactQuickSettings}{compactHistoryControls}
    </View> : null;
    const toggleMidiRecording = () => {
        if (midiPhase === 'starting' || midiPhase === 'countIn') {
            runMidiRecovery(() => midiController.discard());
            return;
        }
        if (midiPhase === 'recording' || midiPhase === 'finishing') {
            runMidiRecovery(() => midiController.finish());
            return;
        }
        if (midiIdleDisabled || !midiTrack) return;
        Keyboard.dismiss();
        stop();
        setPadRecord(false);
        const startTick = clampLocator(snapTick(arrangementLocator, arrangementSnap), arrangementEnd);
        setArrangementLocator(startTick);
        midiTargetTrack.current = midiTrack.id;
        void takes.controller.finishAndDisarm().then(() => midiController.start({
            trackId: midiTrack.id,
            startTick,
            snap: midiQuantise ? arrangementSnap : 0,
            countInBars: midiCountIn ? 1 : 0,
        })).catch(error => {
            if (midiController.snapshot().status !== 'idle') setMidiNotice(midiErrorNotice(error));
        });
    };
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
    const addAudioTrackFromSheet = () => {
        let createdId: string | undefined;
        if (apply(current => {
            const before = new Set(current.tracks.map(track => track.id));
            const next = addAudioTrack(current);
            createdId = next.tracks.find(track => !before.has(track.id))?.id;
            return next;
        }) && createdId) setEditTrackId(createdId);
    };
    const songPlacement = (): BeatSongPlacement => ({
        start: snapTick(arrangementLocator, arrangementSnap),
        trackId: doc.tracks.find(track => track.id === resolvedEditTrackId && track.kind === 'audio')?.id ?? null,
    });
    const commitImportedAudio = (asset: AudioAsset, intent: BeatSongPlacement, message = t('beat.library.added', { name: asset.name, position: position(intent.start) })): boolean => {
        let affectedTrackId: string | null = null;
        const committed = apply(current => {
            assertBeatWritable(current);
            const before = new Set(current.tracks.map(track => track.id));
            const next = addAudioAssetRegion(current, asset, intent.trackId ?? undefined, intent.start);
            affectedTrackId = intent.trackId ?? next.tracks.find(track => track.kind === 'audio' && !before.has(track.id))?.id ?? null;
            return next;
        }, message, { silentRefusal: true });
        if (committed && affectedTrackId) setEditTrackId(affectedTrackId);
        return committed && !!affectedTrackId;
    };
    const importDeviceAudio = async () => {
        if (deviceImportBusy || patternLocked) return;
        setDeviceImportBusy(true); setNotice(null);
        try {
            const prepared = await pickDeviceAudio(doc.id);
            if (!prepared) return;
            const intent = songPlacement();
            const committed = commitImportedAudio(prepared.asset, intent,
                t('beat.track.deviceAdded', { name: prepared.asset.name, position: position(intent.start) }));
            if (!committed) await discardBeatTakes([prepared.takeId]);
        } catch (error) {
            const code = (error as Error)?.message;
            setNotice(t(code === 'device_audio_unavailable' ? 'beat.track.deviceUnavailable'
                : code === 'account_changed' ? 'beat.track.deviceAccountChanged' : 'beat.track.deviceInvalid'));
        } finally { setDeviceImportBusy(false); }
    };
    return (
        <AppearanceContext value={{ ...settings, theme: 'dark' }}>
        <SafeAreaView edges={['left', 'right']} testID="beat-editor-shell" style={s.screen}>
            <Stack.Screen options={{
                title: doc.title,
                headerStyle: { backgroundColor: '#0a0a0b' },
                headerTintColor: '#f2f2f3',
                headerTitle: () => <Text variant="title3" style={s.headerTitle}>{doc.title}</Text>,
                headerRight: () => <HeaderAction testID="beat-editor-export" label={t('beatExport.title')} icon="arrowUp" iconOnly
                    onPress={() => setExporting(true)} />,
                contentStyle: { backgroundColor: '#0a0a0b' },
            }} />
            <KeyboardScreen onViewportHeightChange={next => setEditorViewportHeight(value => value === next ? value : next)}><KeyboardFormScrollView ref={workspace} testID="beat-editor-workspace" scrollEnabled={!held} style={s.workspaceScroll}
                contentContainerStyle={[s.content, shortLandscape && s.contentShort, compactViewport && s.contentConstrained, layout === 'regular' && s.contentRegular]} keyboardShouldPersistTaps="handled"
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
                {!compactViewport && !compactTimelineForTool ? <View style={[s.actions, shortLandscape && s.actionsShort]}>
                    <View testID="beat-editor-quick-settings" style={s.quickSettings} accessibilityRole="toolbar" accessibilityLabel={t('beat.title')}>
                        <Button size="md" variant={tempoOpen ? 'secondary' : 'tertiary'} icon="gauge" label={t('beat.tempoValue', { bpm })}
                            accessibilityState={{ expanded: tempoOpen }} onPress={() => setTempoOpen(value => !value)} containerStyle={s.tempoAction} />
                        <View style={s.topGroup}>
                            <Button testID="beat-editor-undo" size="md" variant="tertiary" icon="seekBack" iconOnly label={t('beat.undo')}
                                disabled={!undoable} onPress={() => navigateHistory('undo')} containerStyle={s.iconAction} />
                            <Button testID="beat-editor-redo" size="md" variant="tertiary" icon="seekForward" iconOnly label={t('beat.redo')}
                                disabled={!redoable} onPress={() => navigateHistory('redo')} containerStyle={s.iconAction} />
                        </View>
                        <View style={s.topGroup}>
                            <Button ref={headerSaveTrigger} testID="beat-editor-save-controls" size="md" variant="tertiary" icon="folder" iconOnly label={t('beat.versions.title')}
                                accessibilityLabel={t('beat.saveNote')}
                                accessibilityState={{ expanded: saveControlsOpen }} onPress={() => setSaveControlsOpen(value => !value)} containerStyle={s.iconAction} />
                        </View>
                    </View>
                    {tempoOpen ? <View style={s.tempo} accessibilityLabel={t('beat.tempo')}>
                        <Text variant="title3" accessibilityLiveRegion="polite">{t('beat.tempoValue', { bpm })}</Text>
                        <View style={s.stepper}>
                            <Button size="md" variant="secondary" label="−5" accessibilityLabel={t('beat.tempoDown5')} onPress={() => bump(-5)} disabled={patternLocked || bpm <= MIN_BPM} containerStyle={s.flex} />
                            <Button size="md" variant="secondary" label="−" accessibilityLabel={t('beat.tempoDown')} onPress={() => bump(-1)} disabled={patternLocked || bpm <= MIN_BPM} containerStyle={s.flex} />
                            <Button size="md" variant="secondary" label="+" accessibilityLabel={t('beat.tempoUp')} onPress={() => bump(1)} disabled={patternLocked || bpm >= MAX_BPM} containerStyle={s.flex} />
                            <Button size="md" variant="secondary" label="+5" accessibilityLabel={t('beat.tempoUp5')} onPress={() => bump(5)} disabled={patternLocked || bpm >= MAX_BPM} containerStyle={s.flex} />
                        </View>
                    </View> : null}
                    {saveControlsOpen ? <View testID="beat-save-controls-panel" style={s.savePanel}>
                        <BeatSaveControls id={doc.id} apply={apply} />
                    </View> : null}
                </View> : null}
                {!compactViewport && !compactTimelineForTool && replacing ? <Text accessibilityLiveRegion="polite">{t('beatTakes.replacing')}</Text> : null}
                {!compactViewport && !compactTimelineForTool && notice ? <MusicNotice message={notice} /> : null}
                {!compactViewport && !compactTimelineForTool && midiNotice ? <MusicNotice message={midiNotice} announce={false} /> : null}
                {!compactViewport && !compactTimelineForTool && midiRecoveryMode ? <BeatMidiRecoveryCard mode={midiRecoveryMode}
                    busy={midiView.status === 'finishing'}
                    canRetryWithQuantise={!midiView.pending && midiView.status === 'recovery' && arrangementSnap > 0}
                    canSaveAsNew={!readOnly && !replacing && midiView.error !== 'recording_source_mismatch'}
                    onRestore={() => runMidiRecovery(() => midiController.retry())}
                    onRetry={() => runMidiRecovery(() => midiController.retry())}
                    onRetryWithQuantise={() => runMidiRecovery(() => midiController.retry(arrangementSnap))}
                    onSaveAsNew={() => runMidiRecovery(() => midiController.saveAsNewBeat(), t('beat.midiRecord.newBeatSaved'))}
                    onDiscard={() => runMidiRecovery(() => midiController.discard())} /> : null}
                <View testID={`beat-editor-layout-${layout}`} style={[s.editor, layout === 'regular' && s.editorRegular]}>
                    <View style={[s.composer, layout === 'regular' && s.composerRegular]}>
                        <View testID="beat-editor-main" style={s.main}>
                        <BeatArrangement manualRunRef={manualRun} key={doc.id} doc={doc} apply={apply} selectCurrentPattern={slot => { selectCurrentPattern(slot); }}
                            editTrackId={resolvedEditTrackId} onEditTrackChange={setEditTrackId}
                            locator={arrangementLocator} onLocatorChange={setArrangementLocator} snap={arrangementSnap} onSnapChange={changeArrangementSnap}
                            playing={playing} step={step} disabled={patternLocked} navigationDisabled={locked || historyBusy}
                            announce={setSaid} onHold={setHeld} onRevealLane={revealLane} layout={layout} compactHeight={compactViewport || compactTimelineForTool} />
                        <BeatRecordPanel doc={doc} controller={takes.controller} view={takes.view} playing={playing}
                            externalLocked={midiController.locked()} />
                        {midiVisible && midiTrack ? <BeatMidiRecordPanel track={midiTrack}
                            phase={midiPhase} noteCount={midiView.noteCount} countIn={midiCountIn} quantise={midiQuantise}
                            onCountInChange={setMidiCountIn} onQuantiseChange={setMidiQuantise} countInStep={midiView.countInBeat || undefined}
                            velocity={midiVelocity} setVelocity={setMidiVelocity} audio={() => null}
                            clock={() => engine()?.now?.() ?? 0} onError={() => setNotice(t('beat.audioError'))}
                            onNoteOn={event => { midiController.noteOn(event.keyId, midiTrack, event.pitch, event.velocity, event.contextTime); }}
                            onNoteOff={event => { midiController.noteOff(event.keyId, event.contextTime); }}
                            accessibilityNoteDurationMs={Math.max(30, arrangementSnap) * 60_000 / (bpm * 960)}
                            settingsDisabled={midiPhase !== 'idle' || midiIdleDisabled}
                            keyboardDisabled={!!midiRecoveryMode || midiPhase === 'finishing' || readOnly || replacing || takes.controller.locked()}
                            recordDisabled={midiIdleDisabled} recordHint={midiLockReason} onRecord={toggleMidiRecording}
                            lockReason={midiPhase !== 'idle' ? t('beat.midiRecord.locked') : midiLockReason}
                            layout={layout} /> : null}
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
                        </> : null}
                        {doc.view === 'pattern' ? <BeatInstrumentsSection doc={doc} apply={apply} disabled={locked} notice={notice}
                            onOpen={regionId => { stop(); openPiano(doc.id, regionId); }} /> : null}
                        </View>
                    </View>
                </View>
            </KeyboardFormScrollView>
            <BeatEditorTransport playing={playing} starting={starting} locked={locked} availableHeight={editorViewportHeight ?? undefined}
                compactViewport={compactViewport}
                showPatterns={false} showHistory={false}
                pattern={doc.currentPattern} patternDisabled={patternLocked} canUndo={undoable} canRedo={redoable}
                patternControlsRef={patternControlsTrigger}
                addControlRef={addToolTrigger} aiControlRef={aiToolTrigger} mixerControlRef={mixToolTrigger} libraryControlRef={libraryToolTrigger}
                midiRecordPhase={midiTransportVisible ? midiPhase : undefined} midiRecordDisabled={midiIdleDisabled}
                midiRecordHint={midiLockReason} onMidiRecord={toggleMidiRecording}
                onPattern={slot => { selectCurrentPattern(slot, t('beat.pattern.selected', { pattern: slot })); }}
                onPatternControls={openPatternControls}
                onUndo={() => navigateHistory('undo')} onRedo={() => navigateHistory('redo')}
                onPlay={() => void (playing || starting ? stop() : play())}
                addDisabled={false}
                addOpen={bottomTool === 'tracks' || bottomTool === 'instruments' || bottomTool === 'sounds'} aiOpen={bottomTool === 'ai'} aiDisabled={aiLocked}
                aiHint={libraryDisabledReason}
                mixerOpen={bottomTool === 'mix'} libraryOpen={bottomTool === 'library'} libraryDisabled={false}
                onAdd={toggleAddTools} onAi={toggleAiTools}
                mixerDisabled={mixLocked && bottomTool !== 'mix'}
                onMixer={() => { if (!mixLocked || bottomTool === 'mix') toggleMixTools(); }}
                onLibrary={toggleLibraryTools}
                onKeyboardEditingChange={setKeyboardEditing}
                subMenuFocusRef={bottomToolHeading}
                compactStatus={compactTransportStatus}
                subMenuFillsBudget={bottomTool === 'library' || bottomTool === 'sounds'}
                subMenuEditing={bottomTool === 'mix' && mixerDeepOpen}
                subMenuLabel={bottomTool === 'library' ? t('beat.library.open') : bottomTool === 'ai' ? t('beatAi.title')
                    : bottomTool === 'mix' ? t('beatMix.title') : bottomTool === 'instruments' ? t('beatPiano.library.title')
                    : bottomTool === 'sounds' ? undefined
                    : bottomTool === 'tracks' ? t('beat.track.add') : bottomTool === 'save' ? t('beat.versions.title') : undefined}
                subMenu={bottomTool === 'tracks' || bottomTool === 'instruments' || bottomTool === 'sounds' ? (bottomTool === 'instruments'
                        ? <MusicInstrumentTray apply={apply} disabled={patternLocked || doc.tracks.length >= MAX_TRACKS} reason={addTrackDisabledReason} refusal={notice} compact={compactViewport}
                        onBack={backToTrackChoices} onAdded={closeBottomTools} />
                        : bottomTool === 'sounds' ? <BeatSoundsTray bpm={doc.tempo.bpm} onClose={backToTrackChoices}
                            onAdd={(sound: BeatSound) => apply(current => addAudioAssetRegion(current, soundAsset(sound, current.tempo.bpm), undefined, arrangementLocator), t('beatLabs.added'))} />
                        : <MusicAddTrackTray disabled={patternLocked || doc.tracks.length >= MAX_TRACKS} reason={addTrackDisabledReason} busy={deviceImportBusy} compact={compactViewport}
                        instrumentControlRef={addInstrumentTrigger}
                        onDevice={() => { closeBottomTools(); void importDeviceAudio(); }}
                        onRecord={() => { closeBottomTools(); addAudioTrackFromSheet(); }}
                        onInstrument={() => setBottomTool('instruments')} onSounds={() => setBottomTool('sounds')} />)
                    : bottomTool === 'library' ? <BeatSongLibrarySheet inline compact={compactViewport} layout={layout} disabled={patternLocked}
                        disabledReason={patternLocked ? libraryDisabledReason : undefined} placement={songPlacement}
                        onCommit={commitImportedAudio} onClose={closeBottomTools} onAdded={closeBottomTools} />
                    : bottomTool === 'ai' ? <BeatAiPanel doc={doc} apply={apply} disabled={aiLocked} visible compact={compactViewport}
                        composerFirst={compactViewport && keyboardEditing} onClose={closeBottomTools} />
                    : bottomTool === 'save' ? <View testID="beat-compact-save-tray" style={s.compactSaveTray}>
                        <Button ref={compactSaveBackTrigger} testID="beat-compact-save-back" size="md" variant="tertiary" icon="arrowLeft" iconOnly
                            label={t('beat.back')} onPress={closeBottomTools} containerStyle={s.compactSaveBack} style={s.compactQuickButton} />
                        <BeatSaveControls id={doc.id} apply={apply} compact />
                    </View>
                    : bottomTool === 'mix' ? <MusicMixerTray doc={doc} selectedTrackId={resolvedEditTrackId}
                        audio={audio.current} playing={playing} step={step} notice={notice} layout={layout}
                        compact={compactViewport}
                        mixDisabled={mixLocked} structuralDisabled={patternLocked}
                        lockReason={libraryDisabledReason ?? t('beat.local.busy')}
                        selectionDisabled={mixLocked}
                        onExpansionChange={setMixerDeepOpen}
                        apply={apply}
                        onGain={(trackId, value) => { mix(trackId, d => setTrackGain(d, trackId, Math.round(value * 100) / 100), undefined, `${trackId}:gain`); }}
                        onPan={(trackId, value) => { mix(trackId, d => setTrackPan(d, trackId, value), undefined, `${trackId}:pan`); }}
                        onMute={(trackId, value) => { const index = doc.tracks.findIndex(track => track.id === trackId); mix(trackId, d => setTrackMute(d, trackId, value), t(value ? 'beat.muted' : 'beat.unmuted', { track: doc.tracks[index]?.name ?? nameOf(index) })); }}
                        onSolo={(trackId, value) => { const index = doc.tracks.findIndex(track => track.id === trackId); mix(trackId, d => setTrackSolo(d, trackId, value), t(value ? 'beat.soloOn' : 'beat.soloOff', { track: doc.tracks[index]?.name ?? nameOf(index) })); }}
                        onKit={(trackId, kit) => { apply(d => setTrackKit(d, trackId, kit)); }}
                        onRemove={trackId => { apply(d => removeTrack(d, trackId)); }} /> : null} />
            </KeyboardScreen>
            {exporting && <BeatExportSheet doc={doc} replacing={replacing}
                recording={['opening', 'armed', 'recording', 'finishing'].includes(takes.view.status) || midiPhase !== 'idle'}
                prepare={async () => { await settleEditorRecorders('preserve'); stop(); await closeEditorAudio(); }}
                heldAssets={heldAssets}
                onClose={() => setExporting(false)} />}
            {patternControls && <BeatPatternControls pattern={doc.currentPattern}
                uses={doc.tracks.flatMap(track => track.regions).filter(region => region.pattern === doc.currentPattern).length}
                swing={doc.swing} metronome={doc.metronome} steps={doc.steps} disabled={patternLocked}
                clearDisabled={!patternHasHits(doc, doc.currentPattern)}
                onSwing={value => apply(d => setSwing(d, value), undefined, 'swing')}
                onMetronome={value => apply(d => setMetronome(d, value))}
                onSteps={value => apply(d => setSteps(d, value))}
                onCopy={copyCurrentPattern} onClear={clearCurrentPattern} onClose={closePatternControls}
                onDismiss={restorePatternControlsFocus} />}
        </SafeAreaView>
        </AppearanceContext>
    );
}
const sheets = themedStyles(p => ({
    screen: { flex: 1, backgroundColor: '#0a0a0b' },
    headerTitle: { color: '#f2f2f3' },
    workspaceScroll: { flex: 1 },
    content: { flexGrow: 1, gap: 0, paddingBottom: 0 },
    contentShort: { paddingVertical: ds.space.xs, gap: ds.space.xs, paddingBottom: ds.space.lg },
    contentConstrained: { paddingVertical: 0, paddingBottom: 0, gap: 0 },
    contentRegular: { width: '100%', maxWidth: 1180, alignSelf: 'center', paddingHorizontal: ds.space.xxxl },
    actions: { gap: 0, borderBottomWidth: 1, borderBottomColor: '#26262a' },
    actionsShort: { gap: ds.space.xs },
    quickSettings: { width: '100%', maxWidth: 820, minHeight: 48, alignSelf: 'center', flexDirection: 'row', alignItems: 'center',
        justifyContent: 'space-between', gap: ds.space.xs, paddingHorizontal: ds.space.xs },
    topGroup: { flexDirection: 'row', alignItems: 'center', gap: 0, borderRadius: ds.radius.pill, backgroundColor: '#141416' },
    iconAction: { width: 48, flexGrow: 0 },
    tempoAction: { minWidth: 112, flexGrow: 0 },
    editor: { flexGrow: 1, gap: 0 },
    editorRegular: { flexDirection: 'row', alignItems: 'flex-start' },
    composer: { alignItems: 'stretch', gap: ds.space.md },
    composerRegular: { flex: 1.65, minWidth: 0 },
    main: { flex: 1, minWidth: 0, gap: 0 },
    inspector: { flex: 1, minWidth: 0, gap: ds.space.lg },
    inspectorRegular: { paddingLeft: ds.space.xl, borderLeftWidth: 1, borderLeftColor: p.borderSubtle },
    tempo: { gap: ds.space.sm, alignItems: 'center', padding: ds.space.md, borderRadius: ds.radius.lg, backgroundColor: '#141416', borderWidth: 1, borderColor: '#26262a' },
    savePanel: { gap: ds.space.sm, padding: ds.space.md, backgroundColor: '#141416', borderTopWidth: 1, borderTopColor: '#26262a' },
    stepper: { width: '100%', flexDirection: 'row', gap: ds.space.sm },
    padHeading: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: ds.space.sm },
    compactStatus: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: ds.space.xs, paddingHorizontal: ds.space.xs },
    compactStatusText: { flex: 1, minWidth: 0 },
    compactTransportToolbar: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 0 },
    compactHistory: { flexDirection: 'row', alignItems: 'center', gap: 0 },
    compactQuickSettings: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 0 },
    compactQuickAction: { width: 44, flexGrow: 0 },
    compactQuickButton: { width: 44, minHeight: 44, paddingVertical: 0, paddingHorizontal: 0 },
    compactTempoValue: { minWidth: 44, textAlign: 'center' },
    compactSaveTray: { height: 44, minHeight: 44, flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center' },
    compactSaveBack: { width: 44, flexGrow: 0 },
    flex: { flex: 1 },
}));
