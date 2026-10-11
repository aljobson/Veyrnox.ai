'use client';
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Button } from '../Button';
import { insertCaptions } from '../../_lib/editorCaptions.mjs';
import { localSpeechAvailable, recognizeTimelineSpeech, SPEECH_LANGUAGES } from '../../_lib/editorSpeechRecognition.mjs';
const subscribeCapability = () => () => {};
const unavailableOnServer = () => false;
export function SpeechRecognitionControls({ tl, blobs, disabled, apply, onError, onBusy }) {
    const [language,setLanguage] = useState('english'), [progress,setProgress] = useState(null), [status,setStatus] = useState('');
    const controller = useRef(null), current = useRef(tl), alive = useRef(true);
    const available = useSyncExternalStore(subscribeCapability, localSpeechAvailable, unavailableOnServer);
    useLayoutEffect(() => { current.current = tl; controller.current?.abort(); }, [tl]);
    useEffect(() => { alive.current = true; return () => { alive.current = false; controller.current?.abort(); onBusy?.(false); }; }, [onBusy]);
    async function transcribe() {
        const snapshot = current.current, job = new AbortController(); controller.current = job;
        setStatus(''); setProgress({stage:'audio',fraction:0}); onBusy?.(true);
        try {
            const cues = await recognizeTimelineSpeech(snapshot, blobs?.current || blobs, { language, signal:job.signal, onProgress:value => alive.current && !job.signal.aborted && setProgress(value) });
            if (job.signal.aborted || !alive.current || current.current !== snapshot) return;
            const next = apply(t => t !== snapshot ? {error:'The edit changed. Retry local captions.'} : insertCaptions(t,cues));
            if (next && alive.current) setStatus(`Created ${cues.length} editable caption ${cues.length === 1 ? 'cue' : 'cues'}. Review the words and timings.`);
        } catch (error) {
            if (!alive.current) return;
            if (error.name === 'AbortError') setStatus('Local automatic captions cancelled.');
            else onError(error.message || 'Local automatic captions failed.');
        } finally {
            if (controller.current === job) { controller.current = null; if (alive.current) { setProgress(null); onBusy?.(false); } }
        }
    }
    const locked = disabled || !!progress;
    return <details><summary className="cursor-pointer text-xs font-bold">Local automatic captions</summary><div className="mt-2 space-y-2">
        <p className="text-xs text-vx-fg-muted">Create editable words and timings from the audible edit, including its mute, solo and audio adjustments. Supports edits up to two minutes. This action downloads a speech model of about 65 MiB; CPU processing can take several minutes. Audio stays on this device. Review results, especially music, singing, accents and background noise.</p>
        <label className="block text-xs">Spoken language<select aria-label="Local captions spoken language" value={language} disabled={locked} onChange={event=>setLanguage(event.target.value)} className="w-full rounded border border-vx-border bg-vx-base p-2">{SPEECH_LANGUAGES.map(([code,name])=><option key={code} value={code}>{name}</option>)}</select></label>
        {!available && <p role="status" className="text-xs">Local automatic captions are unavailable in this browser. Use manual captions or import subtitles.</p>}
        <Button size="sm" disabled={locked || !available || (!tl.video.length && !tl.audio.length)} onClick={transcribe}>Create local automatic captions</Button>
        {progress && <><progress aria-label="Local automatic caption progress" max={1} value={progress.stage === 'audio' ? progress.fraction : undefined} className="w-full" /><p role="status" aria-label="Local automatic caption status" className="text-xs">{progress.stage === 'audio' ? 'Preparing the audible edit' : progress.stage === 'model' ? 'Downloading and preparing the local speech model' : 'Recognizing speech on this device'}</p><Button size="sm" onClick={()=>controller.current?.abort()}>Cancel local automatic captions</Button></>}
        {status && <p role="status" aria-label="Local automatic caption result" className="text-xs">{status}</p>}
    </div></details>;
}
