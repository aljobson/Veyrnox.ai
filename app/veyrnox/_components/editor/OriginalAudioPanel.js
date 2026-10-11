'use client';
import { useEffect,useRef,useState } from 'react';
import { Button } from '../Button';
import { ORIGINAL_AUDIO,originalAudioBlob } from '../../_lib/editorOriginalAudio.mjs';
export function OriginalAudioPanel({disabled,onIngest}){
    const [search,setSearch]=useState(''),[category,setCategory]=useState('All'),[preview,setPreview]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),alive=useRef(true);
    useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
    useEffect(()=>()=>{if(preview)URL.revokeObjectURL(preview.url);},[preview]);
    const entries=ORIGINAL_AUDIO.filter(p=>(category==='All' || p.category===category) && `${p.title} ${p.tags}`.toLowerCase().includes(search.toLowerCase()));
    const open=p=>{const blob=originalAudioBlob(p.id);setPreview({url:URL.createObjectURL(blob),title:p.title,id:p.id});};
    async function insert(p){setBusy(true);setError('');try{await onIngest(new File([originalAudioBlob(p.id)],`${p.id}.wav`,{type:'audio/wav'}),p.title,undefined,undefined,{originalAudio:{version:1,presetId:p.id},sourceName:`${p.id}.wav`,folder:`Original audio/${p.category}`,attribution:{credit:'Veyrnox procedural synthesizer',usage:'Generated locally; version 1 preset.',url:''}});}catch(e){if(alive.current)setError(e.message || 'Could not insert that sound.');}finally{if(alive.current)setBusy(false);}}
    return <section aria-label="Original audio catalog" className="space-y-3"><h2 className="text-sm font-bold">Original audio</h2><p className="text-xs text-vx-fg-muted">Music loops and sound effects synthesized on this device. Saved projects regenerate these presets when reopened.</p>
        <input aria-label="Search original audio" className="w-full rounded border border-vx-border bg-vx-base p-2 text-xs" value={search} onChange={e=>setSearch(e.target.value)} /><select aria-label="Audio catalog category" className="w-full rounded bg-vx-base p-2 text-xs" value={category} onChange={e=>setCategory(e.target.value)}>{['All','Music','Sound effects'].map(c=><option key={c}>{c}</option>)}</select>
        {error && <p role="alert" className="text-xs">{error}</p>}{busy && <p role="status" className="text-xs">Inserting sound…</p>}
        {preview && <div className="rounded border border-vx-border p-2"><p className="text-xs">{preview.title}</p><audio aria-label="Original sound preview" src={preview.url} controls className="w-full" /><a className="text-xs underline" download={`${preview.id}.wav`} href={preview.url}>Download original WAV</a></div>}
        <p role="status" className="text-xs">{entries.length} original sounds</p>{entries.map(p=><div key={p.id} className="space-y-1 rounded border border-vx-border p-2"><h3 className="text-xs font-bold">{p.title}</h3><p className="text-[10px] text-vx-fg-muted">{p.category} · {p.seconds.toFixed(1)}s{p.bpm?` · ${p.bpm} BPM`:''}</p><Button size="sm" variant="ghost" aria-label={`Preview ${p.title}`} disabled={disabled || busy} onClick={()=>open(p)}>Preview</Button><Button size="sm" aria-label={`Insert ${p.title}`} disabled={disabled || busy} onClick={()=>insert(p)}>Insert</Button></div>)}
    </section>;
}
