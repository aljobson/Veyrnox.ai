'use client';
import { localeTag } from '../../../../lib/i18n/locales.mjs';
import { pluralKey } from '../../../../lib/i18n/translate.mjs';
import { useI18n } from '../../../../components/I18nProvider';
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Button } from '../Button';
import { insertCaptions } from '../../_lib/editorCaptions.mjs';
import { localSpeechAvailable, recognizeTimelineSpeech, SPEECH_LANGUAGES } from '../../_lib/editorSpeechRecognition.mjs';
import { sequenceEnd } from '../../_lib/editorSequence.mjs';
import { NumberControl } from './EditorFields';
const languageCodes = { english: 'en', spanish: 'es', french: 'fr', german: 'de', italian: 'it', portuguese: 'pt', japanese: 'ja', korean: 'ko', chinese: 'zh', hindi: 'hi', arabic: 'ar' };
const subscribeCapability = () => () => {};
const unavailableOnServer = () => false;
export function SpeechRecognitionControls({ tl, blobs, disabled, apply, onError, onBusy }) {
  const { t, locale } = useI18n();
  const languageLabel = (code, name) => locale === 'en' || !languageCodes[code] ? name : new Intl.DisplayNames([localeTag(locale)], { type: 'language' }).of(languageCodes[code]);
  const number = new Intl.NumberFormat(localeTag(locale), { useGrouping: false });
  const seconds = value => locale === 'en' ? value.toFixed(2) : new Intl.NumberFormat(localeTag(locale), { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: false }).format(value);
    const [trackId,setTrackId] = useState('mix'), [rangeStart,setRangeStart] = useState(0), [rangeEnd,setRangeEnd] = useState(null);
    const end = sequenceEnd(tl), selectedEnd = rangeEnd === null ? Math.min(end / 30, 120) : rangeEnd;
    const [language,setLanguage] = useState('english'), [progress,setProgress] = useState(null), [status,setStatus] = useState('');
    const controller = useRef(null), current = useRef(tl), alive = useRef(true);
    const available = useSyncExternalStore(subscribeCapability, localSpeechAvailable, unavailableOnServer);
    useLayoutEffect(() => { current.current = tl; controller.current?.abort(); }, [tl]);
    useEffect(() => { alive.current = true; return () => { alive.current = false; controller.current?.abort(); onBusy?.(false); }; }, [onBusy]);
    async function transcribe() {
        const snapshot = current.current, job = new AbortController(); controller.current = job;
        setStatus(''); setProgress({stage:'audio',fraction:0}); onBusy?.(true);
        try {
            const cues = await recognizeTimelineSpeech(snapshot, blobs?.current || blobs, { language, trackId, startFrame:Math.round(rangeStart * 30), endFrame:Math.round(selectedEnd * 30), signal:job.signal, onProgress:value => alive.current && !job.signal.aborted && setProgress(value) });
            if (job.signal.aborted || !alive.current || current.current !== snapshot) return;
            const next = apply(timeline => timeline !== snapshot ? {error:t("app.editor.speech.changed")} : insertCaptions(timeline,cues));
            if (next && alive.current) setStatus(t(pluralKey(t, locale, 'app.editor.speech.created', cues.length), { count: number.format(cues.length) }));
        } catch (error) {
            if (!alive.current) return;
            if (error.name === 'AbortError') setStatus(t("app.editor.speech.cancelled"));
            else onError(error.message || t("app.editor.speech.failed"));
        } finally {
            if (controller.current === job) { controller.current = null; if (alive.current) { setProgress(null); onBusy?.(false); } }
        }
    }
    const locked = disabled || !!progress;
    return <details><summary className="cursor-pointer text-xs font-bold">{t("app.editor.speech.title")}</summary><div className="mt-2 space-y-2">
        <p className="text-xs text-vx-fg-muted">{t("app.editor.speech.help")}</p>
        <label className="block text-xs">{t("app.editor.speech.language")}<select aria-label={t("app.editor.speech.languageLabel")} value={language} disabled={locked} onChange={event=>setLanguage(event.target.value)} className="w-full rounded border border-vx-border bg-vx-base p-2">{SPEECH_LANGUAGES.map(([code,name])=><option key={code} value={code}>{languageLabel(code, name)}</option>)}</select></label>
        <label className="block text-xs">{t("app.editor.speech.track")}<select aria-label={t("app.editor.speech.track")} value={trackId} disabled={locked} onChange={event=>setTrackId(event.target.value)} className="w-full rounded border border-vx-border bg-vx-base p-2"><option value="mix">{t("app.editor.speech.mix")}</option>{trackId!=='mix'&&!tl.tracks.some(track=>track.id===trackId)&&<option value={trackId}>{t("app.editor.transcript.removed")}</option>}{tl.tracks.filter(track=>['video','audio'].includes(track.kind)).map(track=><option key={track.id} value={track.id}>{track.name}{track.muted?t('app.editor.speech.muted'):''}</option>)}</select></label>
        <fieldset disabled={locked} className="space-y-2"><NumberControl label={t("app.editor.speech.start")} value={rangeStart} min={0} max={end/30} step={1/30} onChange={setRangeStart} /><NumberControl label={t("app.editor.speech.end")} value={selectedEnd} min={0} max={end/30} step={1/30} onChange={setRangeEnd} /></fieldset>
        <p className="text-xs text-vx-fg-muted">{t('app.editor.speech.range', { start: seconds(rangeStart), end: seconds(selectedEnd) })}</p>
        {!available && <p role="status" className="text-xs">{t("app.editor.speech.unavailable")}</p>}
        <Button size="sm" disabled={locked || !available || (!tl.video.length && !tl.audio.length) || selectedEnd<=rangeStart || selectedEnd-rangeStart>120 || selectedEnd>end/30 || (trackId!=='mix'&&!tl.tracks.some(track=>track.id===trackId))} onClick={transcribe}>{t("app.editor.speech.create")}</Button>
        {progress && <><progress aria-label={t("app.editor.speech.progress")} max={1} value={progress.stage === 'audio' ? progress.fraction : undefined} className="w-full" /><p role="status" aria-label={t("app.editor.speech.status")} className="text-xs">{progress.stage === 'audio' ? t("app.editor.speech.preparing") : progress.stage === 'model' ? t("app.editor.speech.downloading") : t("app.editor.speech.recognizing")}</p><Button size="sm" onClick={()=>controller.current?.abort()}>{t("app.editor.speech.cancel")}</Button></>}
        {status && <p role="status" aria-label={t("app.editor.speech.result")} className="text-xs">{status}</p>}
    </div></details>;
}
