'use client';
import { useState } from 'react';
import { Button } from '../Button';
import { alignLyricCaptions, lyricSourceCaptions } from '../../_lib/editorLyrics.mjs';
export function LyricAlignmentControls({tl, disabled, apply}) {
    const [lyrics,setLyrics] = useState(''), [source,setSource] = useState('all');
    const sources = lyricSourceCaptions(tl), sourceValid = source === 'all' || sources.some(c => c.id === source);
    return <details><summary className="cursor-pointer text-xs font-bold">Align supplied lyrics</summary><div className="mt-2 space-y-2">
        <p className="text-xs text-vx-fg-muted">Paste lyrics you have permission to use, one display line per line. Match them to existing word timestamps from imported subtitles or local automatic captions. Review recognition before aligning, especially singing. This replaces the selected timed captions and adds karaoke highlighting; Undo restores them. It makes no paid request.</p>
        <label className="block text-xs">Timed lyric source<select aria-label="Timed lyric source" value={source} disabled={disabled} onChange={e=>setSource(e.target.value)} className="w-full rounded border border-vx-border bg-vx-base p-2"><option value="all">All captions with source word timing</option>{!sourceValid && <option value={source}>Source changed — choose again</option>}{sources.map(c=><option key={c.id} value={c.id}>{c.text.slice(0,80)}</option>)}</select></label>
        <label className="block text-xs">Supplied lyrics<textarea aria-label="Supplied lyrics" value={lyrics} maxLength={16000} rows={5} disabled={disabled} onChange={e=>setLyrics(e.target.value)} className="w-full rounded border border-vx-border bg-vx-base p-2" /></label>
        <p role="status" aria-label="Lyric alignment source status" className="text-xs text-vx-fg-muted">{sources.length ? `${sources.length} timed caption ${sources.length === 1 ? 'source is' : 'sources are'} available. Missing or ambiguous matches need correction.` : 'Import word timing JSON, timestamped VTT or enhanced LRC, or create local automatic captions first. Evenly distributed word timing is an estimate.'}</p>
        <Button size="sm" disabled={disabled || !sources.length || !sourceValid || !lyrics.trim()} onClick={()=>apply(t=>alignLyricCaptions(t,lyrics,source))}>Align lyrics and replace timed captions</Button>
    </div></details>;
}
