import { useEffect, useRef, useState } from 'react';
import { Alert, AppState } from 'react-native';
import { File, FileMode } from 'expo-file-system';
import { randomUUID } from 'expo-crypto';
import { getCacheUser, subscribeCacheUser } from '../../lib/appCache';
import { formatLocale, t } from '../../lib/i18n';
import { useAnnouncement } from '../../lib/useAnnouncement';
import { isWavHeader, voiceoverLimitSeconds, voiceoverMedia } from '../../lib/editorVoiceover';
import { adoptTake, discardTake } from '../../lib/editorVoiceoverTakes';
import { probeDuration } from '../../lib/editorMediaDuration';
import { VOICEOVER_AVAILABLE, VOICEOVER_OPTIONS, useAudioRecorder, useAudioRecorderState, useAudioPlayer, getRecordingPermissionsAsync, requestRecordingPermissionsAsync, setAudioModeAsync } from '../../lib/voiceoverRecorder';
import type { Media } from '../../lib/nativeEditorModel';
import type { useFullEditorSession } from './useFullEditorSession';

type Phase = 'idle' | 'asking' | 'starting' | 'denied' | 'recording' | 'review' | 'adding';
type Add = { g: number; cancelledAt: number | null };
type Session = ReturnType<typeof useFullEditorSession>;
export type VoiceoverProps = {
    projectId: string; startFrame: number; fps: number; active: boolean;
    beginImport: Session['beginImport']; preparePicked: Session['preparePicked'];
    insert(media: Media): 'placed' | 'track' | 'full'; onAdded(): void; onClose(): void;
};
export function useVoiceoverRecorder(props: VoiceoverProps) {
    const latest = useRef(props); latest.current = props;
    const owner = useRef(getCacheUser()).current, mounted = useRef(true), op = useRef(0);
    const currentAdd = useRef<Add | null>(null), currentTake = useRef<string | null>(null);
    const [phase, setPhase] = useState<Phase>('idle'), phaseRef = useRef<Phase>('idle');
    const [take, setTake] = useState<string | null>(null), [message, setMessage] = useState<string | null>(null);
    const [playing, setPlaying] = useState(false), [stopping, setStopping] = useState(false);
    const starting = useRef(false), stopTask = useRef<Promise<void> | null>(null), prepared = useRef(false);
    const ownerClosed = useRef(false), nativeFile = useRef<string | null>(null);
    const established = useRef(false), startedAt = useRef(0), initialPoll = useRef<unknown>(null);
    const statusHandler = useRef<(status: { isFinished: boolean; hasError: boolean; mediaServicesDidReset?: boolean }) => void>(() => {});
    const recorder = useAudioRecorder(VOICEOVER_OPTIONS, status => statusHandler.current(status));
    const state = useAudioRecorderState(recorder, 100), player = useAudioPlayer(take);
    const limit = voiceoverLimitSeconds(props.startFrame, props.fps);
    useAnnouncement(message);
    const own = () => mounted.current && owner === getCacheUser();
    // The iOS permission alert can temporarily make the app inactive while asking.
    const live = (g: number) => g === op.current && own() && latest.current.active && (AppState.currentState === 'active' || (AppState.currentState === 'inactive' && phaseRef.current === 'asking'));
    const changePhase = (next: Phase) => { phaseRef.current = next; if (mounted.current) setPhase(next); };
    const changeTake = (uri: string | null) => { currentTake.current = uri; if (mounted.current) setTake(uri); };
    const say = (text: string | null) => { if (own()) setMessage(text); };
    function invalidate(settle = true) {
        op.current++;
        if (currentAdd.current) {
            currentAdd.current.cancelledAt = op.current;
            // A cancelled Add no longer blocks controls when the lifecycle event reverses.
            if (settle) changePhase(currentTake.current ? 'review' : 'idle');
        }
    }
    const pause = () => { try { player.pause(); } catch {} if (mounted.current) setPlaying(false); };
    const restoreMode = async () => { try { await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }); } catch {} };
    // expo-audio releases its shared object after synchronous unmount cleanup.
    // Retain the path so an awaited stop can still erase the file after release.
    const nativeUri = () => { try { const uri = recorder.uri; nativeFile.current = uri; return uri; } catch { return nativeFile.current; } };
    const closeForOwner = () => { if (mounted.current && !ownerClosed.current) { ownerClosed.current = true; latest.current.onClose(); } };
    const stopNative = async () => { try { await recorder.stop(); } catch {} };
    const erase = () => { discardTake(currentTake.current); changeTake(null); };
    async function cancelStart() {
        nativeUri();
        if (prepared.current) { try { await recorder.stop(); } catch {} prepared.current = false; }
        await restoreMode();
        discardTake(nativeUri());
        if (mounted.current) changePhase(currentTake.current ? 'review' : 'idle');
        if (mounted.current && owner !== getCacheUser()) { erase(); closeForOwner(); }
    }
    async function start() {
        if (!VOICEOVER_AVAILABLE || !props.active || starting.current || stopTask.current || phaseRef.current === 'adding' || phaseRef.current === 'recording') return;
        const g = ++op.current; currentAdd.current = null;
        if (!live(g)) return;
        if (limit < 1) { say(t('editorVoiceover.noRoom')); return; }
        pause(); erase(); established.current = false; starting.current = true;
        changePhase('asking'); say(t('editorVoiceover.asking'));
        try {
            let permission = await getRecordingPermissionsAsync();
            if (!live(g)) return await cancelStart();
            if (!permission.granted && permission.canAskAgain) {
                permission = await requestRecordingPermissionsAsync();
                if (!live(g)) return await cancelStart();
            }
            if (!permission.granted) { changePhase('denied'); say(t('editorVoiceover.denied')); return; }
            changePhase('starting');
            await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
            if (!live(g)) return await cancelStart();
            await recorder.prepareToRecordAsync(); prepared.current = true; nativeUri();
            if (!live(g)) return await cancelStart();
            initialPoll.current = state;
            // No asynchronous work may separate this final fence from record().
            if (!live(g)) return await cancelStart();
            recorder.record({ forDuration: limit }); startedAt.current = Date.now();
            changePhase('recording'); say(t('editorVoiceover.started'));
        } catch {
            const report = live(g);
            await cancelStart();
            if (report && live(g)) say(t('editorVoiceover.interrupted'));
        } finally { starting.current = false; }
    }
    function stop(reason: string | null = null, failedStart = false): Promise<void> {
        if (stopTask.current) return stopTask.current;
        if (phaseRef.current !== 'recording') return Promise.resolve();
        // Synchronous guard prevents the status listener from treating our stop as an interruption.
        changePhase('starting'); if (mounted.current) setStopping(true); nativeUri();
        const task = (async () => {
            try { await recorder.stop(); } catch { /* A native completion may already have stopped it. */ }
            prepared.current = false;
            await restoreMode();
            const uri = nativeUri();
            if (!own() || failedStart) {
                discardTake(uri);
                if (mounted.current) { changePhase('idle'); if (failedStart) say(reason); }
                if (mounted.current && owner !== getCacheUser()) closeForOwner();
                return;
            }
            const adopted = uri ? adoptTake(uri) : null;
            if (!adopted) discardTake(uri);
            changeTake(adopted); changePhase(adopted ? 'review' : 'idle');
            say(adopted ? reason : t('editorVoiceover.empty'));
        })().finally(() => { stopTask.current = null; if (mounted.current) setStopping(false); });
        stopTask.current = task;
        return task;
    }
    statusHandler.current = status => {
        if (phaseRef.current !== 'recording') return;
        if (status.hasError || status.mediaServicesDidReset) void stop(t('editorVoiceover.interrupted'), !established.current);
        else if (status.isFinished) void stop(t('editorVoiceover.limitReached'));
    };
    useEffect(() => {
        if (phase !== 'recording') return;
        const timer = setTimeout(() => {
            if (!established.current && phaseRef.current === 'recording') void stop(t('editorVoiceover.interrupted'), true);
        }, Math.max(0, 1500 - (Date.now() - startedAt.current)));
        return () => clearTimeout(timer);
    }, [phase]);
    useEffect(() => {
        if (phaseRef.current !== 'recording' || state === initialPoll.current) return;
        if (state.isRecording) established.current = true;
        const finishedNearLimit = established.current && !state.isRecording && state.durationMillis >= limit * 1000 - 500;
        if (state.durationMillis >= limit * 1000 || finishedNearLimit) void stop(t('editorVoiceover.limitReached'));
        else if (state.mediaServicesDidReset || (established.current && !state.isRecording)) void stop(t('editorVoiceover.interrupted'));
    }, [state, limit, phase]);
    // Playback completion must reset the button, without announcing a ticking player status.
    useEffect(() => {
        const subscription = player.addListener('playbackStatusUpdate', status => { if (mounted.current) setPlaying(status.playing); });
        return () => subscription.remove();
    }, [player]);
    const lifecycle = useRef({ leave: () => {}, ownerChanged: () => {}, dispose: () => {} });
    lifecycle.current = {
        leave: () => { invalidate(); pause(); say(null); void stop(t('editorVoiceover.backgrounded')); },
        ownerChanged: () => {
            if (owner === getCacheUser()) return;
            invalidate(); pause(); erase();
            if (phaseRef.current === 'recording') void stop();
            else if (!starting.current && !stopTask.current) { void stopNative(); void restoreMode(); discardTake(nativeUri()); }
            changePhase('idle'); closeForOwner();
        },
        dispose: () => {
            invalidate(false); mounted.current = false; nativeUri(); pause(); erase();
            if (phaseRef.current === 'recording') void stop();
            else if (!starting.current && !stopTask.current) { void stopNative(); void restoreMode(); discardTake(nativeUri()); }
        },
    };
    useEffect(() => {
        mounted.current = true;
        const app = AppState.addEventListener('change', next => { if (next === 'background' || (next === 'inactive' && phaseRef.current !== 'asking')) lifecycle.current.leave(); });
        const unsubscribe = subscribeCacheUser(() => lifecycle.current.ownerChanged());
        return () => { app.remove(); unsubscribe(); lifecycle.current.dispose(); };
    }, []);
    useEffect(() => { if (!props.active) lifecycle.current.leave(); }, [props.active]);
    async function addTake() {
        if (phaseRef.current !== 'review' || !props.active || !currentTake.current) return;
        const add: Add = { g: ++op.current, cancelledAt: null }; currentAdd.current = add;
        const uri = currentTake.current;
        let token: ReturnType<Session['beginImport']> = null, failureShown = false;
        const valid = () => live(add.g) && uri === currentTake.current && !!token?.valid();
        const failure = (text: string) => { if (live(add.g) && uri === currentTake.current) { failureShown = true; say(text); } };
        changePhase('adding'); pause(); say(t('editorVoiceover.adding'));
        try {
            token = props.beginImport();
            if (!token) { failure(t('editorSave.importDropped')); return; }
            const handle = new File(uri).open(FileMode.ReadOnly);
            let header: Uint8Array;
            try { header = await handle.readBytes(12); } finally { handle.close(); }
            if (!valid()) return;
            if (!isWavHeader(header)) { failure(t('editorVoiceover.unreadable')); return; }
            const seconds = await probeDuration(uri);
            if (!valid()) return;
            if (seconds === null) { failure(t('editorVoiceover.unreadable')); return; }
            const id = `l-${randomUUID()}`;
            const copied = await props.preparePicked({ uri, mimeType: 'audio/wav', duration: seconds * 1000 }, id, 'audio', true);
            if (!valid()) return;
            if (copied === null) { failure(t('editorVoiceover.addFailed')); return; }
            const time = new Date().toLocaleTimeString(formatLocale(), { hour: '2-digit', minute: '2-digit' });
            const media = voiceoverMedia(id, seconds, props.fps, t('editorVoiceover.name', { time }));
            if (!valid()) return;
            const result = props.insert(media);
            if (result === 'track') { failure(t('editor.unlockoraddatrackfirst', { value1: 'audio' })); return; }
            if (result === 'full') { failure(t('editorAi.projectFull')); return; }
            erase(); props.onAdded();
        } catch { failure(t('editorVoiceover.addFailed')); }
        finally {
            try { token?.end(); } finally {
                if (currentAdd.current === add) currentAdd.current = null;
                if (mounted.current && (op.current === add.g || op.current === add.cancelledAt)) {
                    changePhase(currentTake.current ? 'review' : 'idle');
                    if (!live(add.g) || !failureShown) say(null);
                }
                if (mounted.current && owner !== getCacheUser()) lifecycle.current.ownerChanged();
            }
        }
    }
    function discard() {
        if (phaseRef.current === 'adding') return;
        invalidate(); pause(); erase(); changePhase('idle'); say(null);
    }
    async function close() {
        if (phaseRef.current === 'adding') return;
        invalidate(); pause();
        const g = op.current;
        await stop();
        if (!own() || g !== op.current) return;
        if (!currentTake.current) { props.onClose(); return; }
        Alert.alert(t('editorVoiceover.discardTitle'), undefined, [
            { text: t('editorVoiceover.keep'), style: 'cancel' },
            { text: t('editorVoiceover.discard'), style: 'destructive', onPress: () => {
                if (!own() || g !== op.current || phaseRef.current === 'adding') return;
                discard(); props.onClose();
            } },
        ]);
    }
    async function togglePlayback() {
        if (phaseRef.current !== 'review' || !props.active) return;
        try {
            if (player.playing) pause();
            else {
                const g = op.current;
                if (player.currentTime >= player.duration) await player.seekTo(0);
                if (live(g) && currentTake.current === take) { player.play(); setPlaying(true); }
            }
        } catch { say(t('editorVoiceover.unreadable')); }
    }
    return { phase, take, message, playing, stopping, limit, elapsed: state.durationMillis / 1000, metering: state.metering, start, stop, add: addTake, close, discard, togglePlayback };
}
