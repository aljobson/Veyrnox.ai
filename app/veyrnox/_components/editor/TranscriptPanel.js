'use client';
import { useI18n } from '../../../../components/I18nProvider';
import { localeTag } from '../../../../lib/i18n/locales.mjs';
import { pluralKey } from '../../../../lib/i18n/translate.mjs';
import { useEffect, useState } from 'react';
import { Button } from '../Button';
import { SpeechRecognitionControls } from './SpeechRecognitionControls';
import { useEditorCompletionFlags } from './CompletionFlags';
import { parseCaptions, insertCaptions } from '../../_lib/editorCaptions.mjs';
import { transcriptEntries, transcriptRange, cutTranscriptRange, correctTranscriptWord, transcriptText } from '../../_lib/editorTranscript.mjs';
import { formatTime } from '../../_lib/editorTimeline.mjs';
const RANGE_KEYS = ['first', 'last'];
const field = 'w-full rounded border border-vx-border bg-vx-base p-2 text-xs';
export function TranscriptPanel({ tl, blobs, disabled, frame, apply, onSelect, onSeek, onError, onBusy }) {
  const { t, locale } = useI18n();
  const number = n => locale === 'en' ? String(n) : n.toLocaleString(localeTag(locale));
    const { localInference } = useEditorCompletionFlags();
    const [trackId, setTrackId] = useState('all'), [query, setQuery] = useState(''), [selection, setSelection] = useState(null), [download, setDownload] = useState(null);
    useEffect(() => () => { if (download) URL.revokeObjectURL(download.url); }, [download]);
    const entries = transcriptEntries(tl, trackId), range = transcriptRange(tl, selection, trackId), single = !range.error && range.entries.length === 1 ? range.entries[0] : null;
    const cues = tl.text.filter(cue => cue.caption && (trackId === 'all' || cue.trackId === trackId)).sort((a,b) => a.start-b.start).filter(cue => !query.trim() || cue.text.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
    const select = (entry, extend = false) => { setSelection(previous => ({ first: extend && previous ? previous.first : entry.key, last: entry.key })); onSeek?.(entry.start); onSelect?.({ track:'text', id:entry.captionId }); };
    async function upload(event) {
        const file = event.target.files[0]; event.target.value = ''; if (!file) return;
        if (file.size > 262144) { onError?.(t("app.editor.transcript.limit")); return; }
        try { const result = parseCaptions(await file.text(), file.name.split('.').at(-1).toLowerCase()); if (result.error) throw new Error(result.error); apply(timeline => insertCaptions(timeline, result.cues)); }
        catch (error) { onError?.(error.message || t("app.editor.transcript.failed")); }
    }
    const save = () => setDownload({ url:URL.createObjectURL(new Blob([transcriptText(tl,trackId)],{type:'text/plain;charset=utf-8'})), name:'transcript.txt' });
    return <section aria-label={t("app.editor.transcript.region")} className="space-y-3">
        <h2 className="text-sm font-bold">{t("app.editor.transcript.title")}</h2><p className="text-xs text-vx-fg-muted">{t("app.editor.transcript.help")}</p>
        {localInference && <SpeechRecognitionControls tl={tl} blobs={blobs} disabled={disabled} apply={apply} onError={onError} onBusy={onBusy} />}
        <label className="block cursor-pointer rounded border border-dashed border-vx-border p-2 text-xs">{t("app.editor.transcript.import")}<input aria-label={t("app.editor.transcript.importLabel")} type="file" accept=".srt,.vtt,.ass,.lrc,.json" className="sr-only" disabled={disabled} onChange={upload} /></label>
        <label className="block text-xs">{t("app.editor.transcript.track")}<select aria-label={t("app.editor.transcript.trackLabel")} value={trackId} disabled={disabled} className={field} onChange={event=>{setTrackId(event.target.value);setSelection(null);}}><option value="all">{t("app.editor.transcript.allTracks")}</option>{trackId!=='all'&&!tl.tracks.some(track=>track.id===trackId)&&<option value={trackId}>{t("app.editor.transcript.removed")}</option>}{tl.tracks.filter(track=>track.kind==='text').map(track=><option key={track.id} value={track.id}>{track.name}</option>)}</select></label>
        <label className="block text-xs">{t("app.editor.transcript.find")}<input aria-label={t("app.editor.transcript.find")} value={query} onChange={event=>setQuery(event.target.value)} className={field} /></label>
        {!!entries.length && <><p className="text-xs text-vx-fg-muted">{t("app.editor.transcript.selectHelp")}</p>
            <fieldset disabled={disabled} className="space-y-2">{RANGE_KEYS.map((key,index)=><label key={key} className="block text-xs">{t(index ? 'app.editor.transcript.rangeEnd' : 'app.editor.transcript.rangeStart')}<select aria-label={t(index ? 'app.editor.transcript.rangeEndLabel' : 'app.editor.transcript.rangeStartLabel')} value={selection?.[key] || ''} className={field} onChange={event=>setSelection(previous=>({...{first:event.target.value,last:event.target.value},...previous,[key]:event.target.value}))}><option value="">{t("app.editor.transcript.choose")}</option>{entries.map(entry=><option key={entry.key} value={entry.key}>{formatTime(entry.start)} · {entry.text.slice(0,70)}{entry.estimated?(' ' + t('app.editor.transcript.estimated')):entry.wordIndex===null?(' ' + t('app.editor.transcript.wholeCue')):''}</option>)}</select></label>)}</fieldset>
            {selection && <p role="status" aria-label={t("app.editor.transcript.selection")} className="text-xs">{range.error || t(pluralKey(t, locale, 'app.editor.transcript.selected', range.entries.length), { count: number(range.entries.length), start: formatTime(range.start), end: formatTime(range.end), seconds: number((range.end-range.start)/30) })}</p>}
            <Button size="sm" disabled={disabled || !!range.error} onClick={()=>{const next=apply(timeline=>cutTranscriptRange(timeline,selection,trackId));if(next)setSelection(null);}}>{t("app.editor.transcript.cut")}</Button>
            {single?.wordIndex!==null && single && <label className="block text-xs">{t("app.editor.transcript.correct")}<input key={`${single.key}:${single.text}`} aria-label={t("app.editor.transcript.correctLabel")} defaultValue={single.text} maxLength={100} disabled={disabled} className={field} onKeyDown={event=>{if(event.key==='Enter'){event.preventDefault();event.currentTarget.blur();}else if(event.key==='Escape'){event.currentTarget.value=single.text;event.currentTarget.blur();}}} onBlur={event=>{if(event.target.value!==single.text)apply(timeline=>correctTranscriptWord(timeline,single.key,event.target.value));}} /><span className="text-[10px] text-vx-fg-muted">{t("app.editor.transcript.correctHelp")}</span></label>}
            <Button size="sm" variant="ghost" disabled={disabled} onClick={save}>{t("app.editor.transcript.export")}</Button>{download&&<a className="block text-xs underline" href={download.url} download={download.name}>{t("app.editor.transcript.download")}</a>}
        </>}
        {!entries.length && <p role="status" className="text-xs">{t("app.editor.transcript.empty")}</p>}
        {!!entries.length&&!cues.length&&<p role="status" className="text-xs">{t("app.editor.transcript.noMatches")}</p>}
        <ol aria-label={t("app.editor.transcript.timed")} className="space-y-2">{cues.map(cue=><li key={cue.id} className="rounded border border-vx-border p-2"><p className="mb-1 text-[10px] text-vx-fg-muted">{formatTime(cue.start)} · {tl.tracks.find(track=>track.id===cue.trackId)?.name}{cue.wordsEstimated?(' ' + t('app.editor.transcript.estimatedTiming')):''}</p><div className="flex flex-wrap gap-1">{entries.filter(entry=>entry.captionId===cue.id).map(entry=><button key={entry.key} type="button" aria-label={t('app.editor.transcript.wordLabel', { key: entry.key, text: entry.text })} aria-pressed={!range.error&&range.entries.some(word=>word.key===entry.key)} disabled={disabled} className={`rounded px-1 py-0.5 text-xs ${!range.error&&range.entries.some(word=>word.key===entry.key)?'bg-vx-accent text-vx-base':frame>=entry.start&&frame<entry.start+entry.len?'bg-vx-surface text-vx-accent':'hover:bg-vx-surface'}`} onClick={event=>select(entry,event.shiftKey)}>{entry.text}</button>)}</div></li>)}</ol>
    </section>;
}
