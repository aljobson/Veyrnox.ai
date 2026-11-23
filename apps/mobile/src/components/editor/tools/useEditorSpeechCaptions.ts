import { useEffect, useRef, useState } from 'react';
import { createEditorSpeechClient, insertAutomaticCaptions, type EditorSpeechCapability, type EditorSpeechResult,
    type EditorSpeechTranscript } from '../../../lib/editorSpeechNative';
import type { Timeline } from '../../../lib/nativeEditorModel';
import { editorMediaArtifacts } from '../../../lib/editorMedia/artifacts';

export type EditorSpeechCaptionStatus = 'checking' | 'idle' | 'requesting-permission' | 'transcribing' | 'translating' | 'applying' | 'done' | 'error';
export type EditorSpeechCaptionError = Extract<EditorSpeechResult<never>, { ok: false }>['code'] | 'source-unavailable' | 'unsupported-edit' | 'stale' | 'timeline-full';
export type EditorSpeechSource = { uri: string; mediaId: string; startFrame: number; inFrame: number; lenFrames: number; fps: number;
    rate?: number; reverse?: boolean; speedCurve?: readonly unknown[]; freezeFrame?: number };
export function editorSpeechMixRequest(source: EditorSpeechSource) {
    return { clips: [{ mediaId: source.mediaId, timelineStartSeconds: 0, sourceStartSeconds: source.inFrame / source.fps,
        durationSeconds: source.lenFrames / source.fps, volume: 1, fadeInSeconds: 0, fadeOutSeconds: 0 }],
        sources: { [source.mediaId]: source.uri }, frames: source.lenFrames, fps: source.fps };
}
export function placeEditorSpeechTranscript(transcript: EditorSpeechTranscript, source: EditorSpeechSource): EditorSpeechTranscript {
    const offsetMs = Math.round(source.startFrame * 1_000 / source.fps);
    return { ...transcript, segments: transcript.segments.map(segment => ({ ...segment, startMs: segment.startMs + offsetMs })) };
}
type Options = { account: string; projectId: string; source?: EditorSpeechSource; sourceKey: string;
    currentTimeline(): Timeline; applyTimeline(timeline: Timeline): boolean };
const unavailable: EditorSpeechCapability = { platform: 'android', minimumIos: '16.4', automaticCaptions: false,
    onDeviceRecognition: false, translation: false, translationGate: 'native-speech-module-missing' };
// Speech owns a bounded editorMedia PCM artifact and wraps it in a temporary WAV internally.
export const EDITOR_SPEECH_BOUNDED_AUDIO_READY = true;

export function useEditorSpeechCaptions({ account, projectId, source, sourceKey, currentTimeline, applyTimeline }: Options) {
    const client = useRef(createEditorSpeechClient()).current;
    const latest = useRef({ account, projectId, source, sourceKey, currentTimeline, applyTimeline });
    latest.current = { account, projectId, source, sourceKey, currentTimeline, applyTimeline };
    const [sourceLocale, setSourceLocale] = useState('en-US');
    const [targetLocale, setTargetLocale] = useState('es');
    const [capability, setCapability] = useState<EditorSpeechCapability>(unavailable);
    const [status, setStatus] = useState<EditorSpeechCaptionStatus>('checking');
    const [error, setError] = useState<EditorSpeechCaptionError | null>(null);
    const [added, setAdded] = useState(0);
    const generation = useRef(0), controller = useRef<AbortController | null>(null);
    useEffect(() => {
        const token = ++generation.current; controller.current?.abort(); controller.current = null;
        setStatus('checking'); setError(null); setAdded(0);
        void client.capabilities(sourceLocale).then(value => { if (generation.current === token) { setCapability(value); setStatus('idle'); } });
        return () => { generation.current++; controller.current?.abort(); controller.current = null; };
    }, [client, sourceKey, sourceLocale]);
    useEffect(() => { if (targetLocale.split('-')[0] === sourceLocale.split('-')[0]) setTargetLocale(sourceLocale.startsWith('en') ? 'es' : 'en-US'); }, [sourceLocale, targetLocale]);
    const cancel = () => { generation.current++; controller.current?.abort(); controller.current = null; setStatus('idle'); setError(null); };
    const run = async (translate: boolean) => {
        if (controller.current) return;
        const start = latest.current;
        if (!start.source?.uri.startsWith('file:')) { setError('source-unavailable'); setStatus('error'); return; }
        if (!EDITOR_SPEECH_BOUNDED_AUDIO_READY) { setError('on-device-unavailable'); setStatus('error'); return; }
        if ((start.source.rate ?? 1) !== 1 || start.source.reverse || start.source.speedCurve?.length || start.source.freezeFrame !== undefined) {
            setError('unsupported-edit'); setStatus('error'); return;
        }
        if (!capability.automaticCaptions || !capability.onDeviceRecognition || translate && !capability.translation) {
            setError('unsupported-platform'); setStatus('error'); return;
        }
        const token = ++generation.current, abort = new AbortController(); controller.current = abort;
        setError(null); setAdded(0); setStatus('requesting-permission');
        let audioArtifactId: string | null = null;
        try {
            let permission = await client.permission(false); if (permission === 'not-determined') permission = await client.permission(true);
            if (token !== generation.current || abort.signal.aborted) return;
            if (permission !== 'authorized') { setError(permission === 'revoked' ? 'permission-revoked' : permission === 'restricted' ? 'permission-restricted' : 'permission-denied'); setStatus('error'); return; }
            setStatus('transcribing');
            await editorMediaArtifacts.setOwner(start.account);
            const mixed = await editorMediaArtifacts.mixAudio(start.projectId, editorSpeechMixRequest(start.source), undefined, abort.signal);
            if (token !== generation.current || abort.signal.aborted) return;
            if (!mixed.ok) { setError(mixed.code === 'cancelled' ? 'cancelled' : mixed.code === 'invalid-input' ? 'unsupported-edit' : 'recognition-failed');
                setStatus(mixed.code === 'cancelled' ? 'idle' : 'error'); return; }
            audioArtifactId = mixed.value.artifactId;
            const transcript = await client.transcribePcm(start.account, start.projectId, mixed.value.artifactId, sourceLocale, abort.signal);
            if (token !== generation.current || abort.signal.aborted) return;
            if (!transcript.ok) { setError(transcript.code); setStatus(transcript.code === 'cancelled' ? 'idle' : 'error'); return; }
            let value: EditorSpeechTranscript = placeEditorSpeechTranscript(transcript.value, start.source);
            if (translate) {
                setStatus('translating'); const translated = await client.translate(value, targetLocale);
                if (token !== generation.current || abort.signal.aborted) return;
                if (!translated.ok) { setError(translated.code); setStatus(translated.code === 'cancelled' ? 'idle' : 'error'); return; }
                value = translated.value;
            }
            const live = latest.current;
            if (live.account !== start.account || live.projectId !== start.projectId || live.sourceKey !== start.sourceKey || live.source?.uri !== start.source.uri) { setError('stale'); setStatus('error'); return; }
            setStatus('applying'); const before = live.currentTimeline(), next = insertAutomaticCaptions(before, value);
            if (!next || !live.applyTimeline(next)) { setError('timeline-full'); setStatus('error'); return; }
            setAdded(Math.max(0, next.text.filter(item => item.caption).length - before.text.filter(item => item.caption).length)); setStatus('done');
        } catch {
            if (token === generation.current && !abort.signal.aborted) { setError('recognition-failed'); setStatus('error'); }
        } finally {
            if (audioArtifactId) await editorMediaArtifacts.release(start.projectId, audioArtifactId).catch(() => undefined);
            if (controller.current === abort) controller.current = null;
        }
    };
    return { capability, boundedAudioReady: EDITOR_SPEECH_BOUNDED_AUDIO_READY, status, error, added, sourceLocale, setSourceLocale, targetLocale, setTargetLocale,
        generate: () => void run(false), translate: () => void run(true), cancel };
}
export type EditorSpeechCaptionActions = ReturnType<typeof useEditorSpeechCaptions>;
