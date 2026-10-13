'use client';
import { useEffect, useState } from 'react';
import { Button } from '../Button';
import { SpeechRecognitionControls } from './SpeechRecognitionControls';
import { useEditorCompletionFlags } from './CompletionFlags';
import { parseCaptions, insertCaptions } from '../../_lib/editorCaptions.mjs';
import { transcriptEntries, transcriptRange, cutTranscriptRange, correctTranscriptWord, transcriptText } from '../../_lib/editorTranscript.mjs';
import { formatTime } from '../../_lib/editorTimeline.mjs';
const field = 'w-full rounded border border-vx-border bg-vx-base p-2 text-xs';
export function TranscriptPanel({ tl, blobs, disabled, frame, apply, onSelect, onSeek, onError, onBusy }) {
    const { localInference } = useEditorCompletionFlags();
    const [trackId, setTrackId] = useState('all'), [query, setQuery] = useState(''), [selection, setSelection] = useState(null), [download, setDownload] = useState(null);
    useEffect(() => () => { if (download) URL.revokeObjectURL(download.url); }, [download]);
    const entries = transcriptEntries(tl, trackId), range = transcriptRange(tl, selection, trackId), single = !range.error && range.entries.length === 1 ? range.entries[0] : null;
    const cues = tl.text.filter(cue => cue.caption && (trackId === 'all' || cue.trackId === trackId)).sort((a,b) => a.start-b.start).filter(cue => !query.trim() || cue.text.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
    const select = (entry, extend = false) => { setSelection(previous => ({ first: extend && previous ? previous.first : entry.key, last: entry.key })); onSeek?.(entry.start); onSelect?.({ track:'text', id:entry.captionId }); };
    async function upload(event) {
        const file = event.target.files[0]; event.target.value = ''; if (!file) return;
        if (file.size > 262144) { onError?.('Choose subtitles under 256 KiB.'); return; }
        try { const result = parseCaptions(await file.text(), file.name.split('.').at(-1).toLowerCase()); if (result.error) throw new Error(result.error); apply(t => insertCaptions(t, result.cues)); }
        catch (error) { onError?.(error.message || 'Transcript import failed.'); }
    }
    const save = () => setDownload({ url:URL.createObjectURL(new Blob([transcriptText(tl,trackId)],{type:'text/plain;charset=utf-8'})), name:'transcript.txt' });
    return <section aria-label="Transcript editor" className="space-y-3">
        <h2 className="text-sm font-bold">Transcript</h2><p className="text-xs text-vx-fg-muted">Edit the video by selecting timed words. A range cut removes that interval from every track and closes its gap; Undo restores the edit. Review recognition and timings first.</p>
        {localInference && <SpeechRecognitionControls tl={tl} blobs={blobs} disabled={disabled} apply={apply} onError={onError} onBusy={onBusy} />}
        <label className="block cursor-pointer rounded border border-dashed border-vx-border p-2 text-xs">Import transcript captions or word timing<input aria-label="Import transcript captions" type="file" accept=".srt,.vtt,.ass,.lrc,.json" className="sr-only" disabled={disabled} onChange={upload} /></label>
        <label className="block text-xs">Caption track<select aria-label="Transcript caption track" value={trackId} disabled={disabled} className={field} onChange={event=>{setTrackId(event.target.value);setSelection(null);}}><option value="all">All caption tracks</option>{trackId!=='all'&&!tl.tracks.some(track=>track.id===trackId)&&<option value={trackId}>Track removed — choose again</option>}{tl.tracks.filter(track=>track.kind==='text').map(track=><option key={track.id} value={track.id}>{track.name}</option>)}</select></label>
        <label className="block text-xs">Find transcript text<input aria-label="Find transcript text" value={query} onChange={event=>setQuery(event.target.value)} className={field} /></label>
        {!!entries.length && <><p className="text-xs text-vx-fg-muted">Select a word to seek. Shift-click another word to extend the range, or use the range selectors below. Captions without word timing can be selected only as whole cues; estimated words cannot define a source cut.</p>
            <fieldset disabled={disabled} className="space-y-2">{['first','last'].map((key,index)=><label key={key} className="block text-xs">Range {index?'end':'start'}<select aria-label={`Transcript range ${index?'end':'start'}`} value={selection?.[key] || ''} className={field} onChange={event=>setSelection(previous=>({...{first:event.target.value,last:event.target.value},...previous,[key]:event.target.value}))}><option value="">Choose a timed word or cue</option>{entries.map(entry=><option key={entry.key} value={entry.key}>{formatTime(entry.start)} · {entry.text.slice(0,70)}{entry.estimated?' (estimated)':entry.wordIndex===null?' (whole cue)':''}</option>)}</select></label>)}</fieldset>
            {selection && <p role="status" aria-label="Transcript selection" className="text-xs">{range.error || `${range.entries.length} selected · ${formatTime(range.start)}–${formatTime(range.end)} · ${(range.end-range.start)/30} seconds will be cut from all tracks.`}</p>}
            <Button size="sm" disabled={disabled || !!range.error} onClick={()=>{const next=apply(t=>cutTranscriptRange(t,selection,trackId));if(next)setSelection(null);}}>Cut selected transcript range</Button>
            {single?.wordIndex!==null && single && <label className="block text-xs">Correct selected word<input key={`${single.key}:${single.text}`} aria-label="Correct selected transcript word" defaultValue={single.text} maxLength={100} disabled={disabled} className={field} onKeyDown={event=>{if(event.key==='Enter'){event.preventDefault();event.currentTarget.blur();}else if(event.key==='Escape'){event.currentTarget.value=single.text;event.currentTarget.blur();}}} onBlur={event=>{if(event.target.value!==single.text)apply(t=>correctTranscriptWord(t,single.key,event.target.value));}} /><span className="text-[10px] text-vx-fg-muted">Press Enter or leave the field to save. Correction keeps this word’s measured time. It changes caption text, without cutting audio.</span></label>}
            <Button size="sm" variant="ghost" disabled={disabled} onClick={save}>Export transcript TXT</Button>{download&&<a className="block text-xs underline" href={download.url} download={download.name}>Download transcript TXT</a>}
        </>}
        {!entries.length && <p role="status" className="text-xs">Create local automatic captions or import timed subtitles to build a transcript.</p>}
        {!!entries.length&&!cues.length&&<p role="status" className="text-xs">No transcript text matches this search.</p>}
        <ol aria-label="Timed transcript" className="space-y-2">{cues.map(cue=><li key={cue.id} className="rounded border border-vx-border p-2"><p className="mb-1 text-[10px] text-vx-fg-muted">{formatTime(cue.start)} · {tl.tracks.find(track=>track.id===cue.trackId)?.name}{cue.wordsEstimated?' · estimated word timing':''}</p><div className="flex flex-wrap gap-1">{entries.filter(entry=>entry.captionId===cue.id).map(entry=><button key={entry.key} type="button" aria-label={`Transcript ${entry.key}: ${entry.text}`} aria-pressed={!range.error&&range.entries.some(word=>word.key===entry.key)} disabled={disabled} className={`rounded px-1 py-0.5 text-xs ${!range.error&&range.entries.some(word=>word.key===entry.key)?'bg-vx-accent text-vx-base':frame>=entry.start&&frame<entry.start+entry.len?'bg-vx-surface text-vx-accent':'hover:bg-vx-surface'}`} onClick={event=>select(entry,event.shiftKey)}>{entry.text}</button>)}</div></li>)}</ol>
    </section>;
}
