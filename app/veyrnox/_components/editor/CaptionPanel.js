'use client';
import { useEffect, useState } from 'react';
import { Button } from '../Button';
import { NumberControl } from './EditorControls';
import { parseCaptions, insertCaptions, exportCaptions, cutSequenceRange, applyCaptionStyle } from '../../_lib/editorCaptions.mjs';
import { addSequenceText, updateSequenceClip, removeSequenceClip } from '../../_lib/editorSequence.mjs';
import { TEXT_DEFAULTS } from '../../_lib/editorSequenceValidation.mjs';
import { formatTime } from '../../_lib/editorTimeline.mjs';
import { CaptionTranslationControls } from './CaptionTranslationControls';
import { SpeechRecognitionControls } from './SpeechRecognitionControls';
import { useEditorCompletionFlags } from './CompletionFlags';
export function CaptionPanel({ tl, blobs, disabled, frame, apply, onSelect, onSeek, onError, onBusy }) {
    const {localInference}=useEditorCompletionFlags();
    const [download, setDownload] = useState(null);
    useEffect(() => () => { if (download) URL.revokeObjectURL(download.url); }, [download]);
    async function upload(e) {
        const file = e.target.files[0]; e.target.value = ''; if (!file) return;
        if (file.size > 262144) { onError('Choose subtitles under 256 KiB.'); return; }
        const result = parseCaptions(await file.text(), file.name.split('.').at(-1).toLowerCase());
        if (result.error) { onError(result.error); return; }
        apply(t => insertCaptions(t, result.cues));
    }
    const items = tl.text.filter(c => c.caption);
    const save = format => setDownload({ url: URL.createObjectURL(new Blob([exportCaptions(tl, format)], { type: 'text/plain' })), name: `captions.${format}` });
    return <section aria-label="Captions and transcript" className="space-y-3">
        <p className="text-xs text-vx-fg-muted">Import timed subtitles or write captions. Text and timing remain editable.</p>
        <label className="block cursor-pointer rounded-lg border border-dashed border-vx-border p-3 text-xs">Import SRT, VTT, ASS, LRC or word JSON<input aria-label="Import captions" data-testid="caption-import" type="file" accept=".srt,.vtt,.ass,.lrc,.json" className="sr-only" disabled={disabled} onChange={upload} /></label>
        <p className="text-[10px] text-vx-fg-muted">Timestamped VTT and enhanced LRC retain word timing. JSON accepts word/start/end in seconds. ASS retains text and cue timing; its style tags use your editor style.</p>
        <Button size="sm" disabled={disabled} onClick={() => { const next = apply(t => addSequenceText(t, { text: 'Your caption', caption: true, start: Math.min(frame, 17910), len: 90 })); if (next) onSelect({ track: 'text', id: `t${next.seq}` }); }}>Add manual caption</Button>
        <CaptionTranslationControls tl={tl} disabled={disabled} apply={apply} onError={onError} onBusy={onBusy} />
        {localInference && <SpeechRecognitionControls tl={tl} blobs={blobs} disabled={disabled} apply={apply} onError={onError} onBusy={onBusy} />}
        {!!items.length && <><div className="flex flex-wrap gap-2"><Button size="sm" disabled={disabled} onClick={() => save('srt')}>Export SRT</Button><Button size="sm" disabled={disabled} onClick={() => save('vtt')}>Export VTT</Button><Button size="sm" disabled={disabled} onClick={() => apply(t => applyCaptionStyle(t, { ...TEXT_DEFAULTS, color: '#ffe66d', backgroundOpacity: 0.7 }))}>Style all captions</Button></div>{download && <a className="text-xs text-vx-accent underline" href={download.url} download={download.name}>Download {download.name}</a>}</>}
        <fieldset disabled={disabled}><ol className="space-y-3">{items.map(c => <li key={c.id} className="space-y-2 rounded-lg border border-vx-border p-2">
            <button type="button" className="text-xs font-bold text-vx-accent" onClick={() => { onSeek(c.start); onSelect({ track: 'text', id: c.id }); }}>{formatTime(c.start)} — {formatTime(c.start + c.len)}</button>
            <textarea aria-label={`Caption ${c.id}`} key={`${c.id}:${c.text}`} defaultValue={c.text} maxLength={1000} rows={2} disabled={disabled} className="w-full rounded bg-vx-base p-2 text-xs" onBlur={e => { if (e.target.value.trim() && e.target.value !== c.text) apply(t => updateSequenceClip(t, 'text', c.id, { text: e.target.value })); }} />
            <NumberControl label={`Start of caption ${c.id}`} value={c.start / 30} min={0} max={600} onChange={n => apply(t => updateSequenceClip(t, 'text', c.id, { start: Math.round(n * 30) }))} />
            <NumberControl label={`Duration of caption ${c.id}`} value={c.len / 30} min={1 / 30} max={600} onChange={n => apply(t => updateSequenceClip(t, 'text', c.id, { len: Math.round(n * 30) }))} />
            <div className="flex flex-wrap gap-2"><Button size="sm" variant="ghost" disabled={disabled} onClick={() => apply(t => removeSequenceClip(t, 'text', c.id))}>Remove caption</Button><Button size="sm" variant="ghost" disabled={disabled} onClick={() => apply(t => cutSequenceRange(t, c.start, c.start + c.len))}>Cut this range</Button></div>
        </li>)}</ol></fieldset>
    </section>;
}
